/*
 * sentiment_kernel.cu — Tensor-MIDI Polyformalism Engine (CUDA)
 *
 * What CUDA teaches: warp divergence kills performance. All messages
 * must take the same code path through sentiment analysis. You discover
 * that the if-else chain for word matching must be restructured as a
 * lookup table. The branchless version teaches you something about the
 * algorithm that the branchy version hides.
 *
 * Each thread processes one message. Word matching uses shared memory
 * lookup tables. Output: pitch, velocity, friction per message.
 *
 * Uses cudaclaw's cell agent pattern: each message is a cell.
 *
 * Build: nvcc -o sentiment_kernel sentiment_kernel.cu
 * Run:   ./sentiment_kernel
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>

// ── Constants (must match tensor_midi.h) ─────────────────────────────

#define PPQ                 96u
#define PULSES_PER_BAR      12u
#define TICKS_PER_PULSE     (PPQ / 2u)
#define TICKS_PER_BAR       (PULSES_PER_BAR * TICKS_PER_PULSE)
#define PACKED_SIZE         8u

#define MAX_MESSAGES        4096u
#define MAX_MSG_LEN         512u

#define NUM_POSITIVE        22u
#define NUM_NEGATIVE        21u
#define NUM_QUESTION        8u
#define NUM_CREATIVE        17u
#define MAX_WORD_LEN        16u

// Friction flags
#define FRICTION_NONE           0x00u
#define FRICTION_AMBIGUITY      0x08u
#define FRICTION_SYNTAX_ERROR   0x20u

// ── CUDA-safe structures ─────────────────────────────────────────────

struct SentimentResult {
    uint8_t pitch;
    uint8_t velocity;
    uint8_t friction;
    uint8_t label;      // 0=bright, 1=creative, 2=inquiring, 3=neutral, 4=tense
    uint8_t positivity;
    uint8_t negativity;
    uint8_t question;
    uint8_t creativity;
};

struct SwmidiEventGpu {
    uint8_t  event_type;
    uint8_t  channel;
    uint8_t  pitch;
    uint8_t  velocity;
    uint8_t  error_mask;
    uint32_t tick;
};

// ── Host-side word tables (copied to device) ─────────────────────────

static const char POSITIVE_WORDS_H[NUM_POSITIVE][MAX_WORD_LEN] = {
    "great", "awesome", "love", "perfect", "excellent", "wonderful",
    "yes", "good", "amazing", "fantastic", "beautiful", "brilliant",
    "nice", "cool", "happy", "glad", "thanks", "thank", "sweet",
    "win", "success", "proud",
};

static const char NEGATIVE_WORDS_H[NUM_NEGATIVE][MAX_WORD_LEN] = {
    "bad", "error", "fail", "broken", "hate", "wrong", "no", "terrible",
    "awful", "crash", "bug", "issue", "stuck", "frustrated", "annoying",
    "slow", "dead", "lost", "miss", "angry", "sad",
};

static const char QUESTION_WORDS_H[NUM_QUESTION][MAX_WORD_LEN] = {
    "what", "how", "why", "where", "when", "who", "which", "?",
};

static const char CREATIVE_WORDS_H[NUM_CREATIVE][MAX_WORD_LEN] = {
    "imagine", "create", "build", "design", "compose", "paint", "draw",
    "write", "dream", "invent", "explore", "craft", "forge", "shape",
    "mold", "weave", "spark",
};

// ════════════════════════════════════════════════════════════════════
// DEVICE KERNELS
// ════════════════════════════════════════════════════════════════════

/*
 * What CUDA teaches about the algorithm:
 *
 * The naive approach is a branchy if-else chain:
 *   if (contains(text, "great")) positivity++;
 *   if (contains(text, "awesome")) positivity++;
 *   ... etc for every word in every list
 *
 * In a warp, if one thread takes a branch and others don't, the warp
 * serializes — you get the worst of both paths. With 22 + 21 + 8 + 17
 * = 68 possible branches, a 32-thread warp could serialize to hundreds
 * of cycles per message.
 *
 * The CUDA-optimal approach: branchless word matching via a shared
 * memory lookup table. Every thread walks the same word list in lockstep.
 * The "match" is computed as an integer (0 or 1), not a branch. The sum
 * accumulates without divergence.
 *
 * This reveals: sentiment analysis is fundamentally a dot product.
 * text × word_table = sentiment_vector. The branchy version hides this
 * behind control flow. The GPU version exposes the true mathematical
 * shape.
 */

/**
 * Case-insensitive substring check — branchless early exit.
 * Returns 1 if needle is found in haystack, 0 otherwise.
 */
__device__ int dev_ci_contains(
    const char* __restrict__ haystack,
    int haystack_len,
    const char* __restrict__ needle,
    int needle_len
) {
    if (needle_len == 0) return 1;
    if (needle_len > haystack_len) return 0;

    int found = 0;
    for (int i = 0; i <= haystack_len - needle_len && !found; i++) {
        int match = 1;
        for (int j = 0; j < needle_len && match; j++) {
            char hc = haystack[i + j];
            char nc = needle[j];
            // Branchless lowercase (branch on range, but predictable)
            hc += (hc >= 'A' && hc <= 'Z') ? 32 : 0;
            nc += (nc >= 'A' && nc <= 'Z') ? 32 : 0;
            match = match && (hc == nc);
        }
        found = found || match;
    }
    return found;
}

/**
 * Count matches against a word table — all threads walk the same
 * table in lockstep. No warp divergence.
 */
__device__ uint8_t dev_count_matches(
    const char* __restrict__ text,
    int text_len,
    const char* __restrict__ word_table,  // flattened [N][MAX_WORD_LEN]
    int word_count
) {
    uint8_t count = 0;
    for (int w = 0; w < word_count; w++) {
        const char* word = word_table + w * MAX_WORD_LEN;
        int wlen = 0;
        while (wlen < MAX_WORD_LEN && word[wlen] != '\0') wlen++;

        // Every thread executes this — no divergence on the match itself
        count += dev_ci_contains(text, text_len, word, wlen);
    }
    return count;
}

/**
 * Main sentiment analysis kernel.
 * Each thread processes one message.
 *
 * Grid: (N + BLOCK_SIZE - 1) / BLOCK_SIZE blocks
 * Block: BLOCK_SIZE threads
 */
__global__ void sentiment_analysis_kernel(
    const char* __restrict__ messages,     // [N][MAX_MSG_LEN] flattened
    const int* __restrict__ msg_lengths,   // [N]
    SentimentResult* __restrict__ results, // [N]
    const char* __restrict__ positive_tbl, // [NUM_POSITIVE][MAX_WORD_LEN]
    const char* __restrict__ negative_tbl, // [NUM_NEGATIVE][MAX_WORD_LEN]
    const char* __restrict__ question_tbl, // [NUM_QUESTION][MAX_WORD_LEN]
    const char* __restrict__ creative_tbl, // [NUM_CREATIVE][MAX_WORD_LEN]
    int num_messages
) {
    // Shared memory copies of word tables — loaded once per block
    __shared__ char s_positive[NUM_POSITIVE * MAX_WORD_LEN];
    __shared__ char s_negative[NUM_NEGATIVE * MAX_WORD_LEN];
    __shared__ char s_question[NUM_QUESTION * MAX_WORD_LEN];
    __shared__ char s_creative[NUM_CREATIVE * MAX_WORD_LEN];

    // Cooperative load of word tables into shared memory
    int tid = threadIdx.x;
    int block_size = blockDim.x;

    // Each thread loads a portion of each table
    for (int i = tid; i < NUM_POSITIVE * MAX_WORD_LEN; i += block_size) {
        s_positive[i] = positive_tbl[i];
    }
    for (int i = tid; i < NUM_NEGATIVE * MAX_WORD_LEN; i += block_size) {
        s_negative[i] = negative_tbl[i];
    }
    for (int i = tid; i < NUM_QUESTION * MAX_WORD_LEN; i += block_size) {
        s_question[i] = question_tbl[i];
    }
    for (int i = tid; i < NUM_CREATIVE * MAX_WORD_LEN; i += block_size) {
        s_creative[i] = creative_tbl[i];
    }
    __syncthreads();

    // Each thread processes one message
    int idx = blockIdx.x * blockDim.x + tid;
    if (idx >= num_messages) return;

    const char* msg = messages + idx * MAX_MSG_LEN;
    int msg_len = msg_lengths[idx];

    // Clamp message length
    if (msg_len > MAX_MSG_LEN) msg_len = MAX_MSG_LEN;

    // Count word matches — all threads follow same path (no divergence)
    uint8_t positivity = dev_count_matches(msg, msg_len, s_positive, NUM_POSITIVE);
    uint8_t negativity = dev_count_matches(msg, msg_len, s_negative, NUM_NEGATIVE);
    uint8_t question   = dev_count_matches(msg, msg_len, s_question, NUM_QUESTION);
    uint8_t creativity = dev_count_matches(msg, msg_len, s_creative, NUM_CREATIVE);

    // Pitch mapping — branchless using ternary (compiles to predicated moves)
    int pitch = 60;
    pitch += creativity * 8;
    pitch += positivity * 5;
    pitch -= negativity * 10;
    // Branchless question override
    int q_pitch = 72 + question * 3;
    pitch = (question > 0) ? q_pitch : pitch;
    pitch = max(0, min(127, pitch));

    // Friction — branchless OR
    uint8_t friction = FRICTION_NONE;
    friction |= (negativity > 0) ? FRICTION_AMBIGUITY : 0;

    // Syntax error check (substring search — all threads execute)
    int has_error = dev_ci_contains(msg, msg_len, "error", 5) |
                    dev_ci_contains(msg, msg_len, "fail", 4) |
                    dev_ci_contains(msg, msg_len, "crash", 5);
    friction |= has_error ? FRICTION_SYNTAX_ERROR : 0;

    // Velocity from message length
    int clen = min(msg_len, 500);
    uint8_t velocity = (uint8_t)max(1, min(127, (clen * 127) / 500));

    // Label — the one unavoidable branch, but it's a simple cascade
    uint8_t label;
    if (negativity > positivity) {
        label = 4; // tense
    } else if (creativity > 0) {
        label = 1; // creative
    } else if (question > 0) {
        label = 2; // inquiring
    } else if (positivity > 0) {
        label = 0; // bright
    } else {
        label = 3; // neutral
    }

    // Write result
    results[idx].pitch      = (uint8_t)pitch;
    results[idx].velocity   = velocity;
    results[idx].friction   = friction;
    results[idx].label      = label;
    results[idx].positivity = positivity;
    results[idx].negativity = negativity;
    results[idx].question   = question;
    results[idx].creativity = creativity;
}

/**
 * Second kernel: convert sentiments to SWMIDI events.
 * Each thread creates one event from one sentiment result.
 */
__global__ void sentiments_to_events_kernel(
    const SentimentResult* __restrict__ sentiments,
    SwmidiEventGpu* __restrict__ events,
    const uint8_t* __restrict__ channels,  // [N] channel per message
    uint32_t start_tick,
    uint32_t ticks_per_event,
    int num_messages
) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= num_messages) return;

    const SentimentResult* s = &sentiments[idx];
    SwmidiEventGpu* ev = &events[idx];

    ev->event_type = 0; // NOTE_ON
    ev->channel    = channels[idx];
    ev->pitch      = s->pitch;
    ev->velocity   = s->velocity;
    ev->error_mask = s->friction;
    ev->tick       = start_tick + idx * ticks_per_event;
}

/**
 * Third kernel: jazz analysis reduction.
 * Each block reduces a chunk of sentiments, then atomic merge to global.
 */
__global__ void jazz_analysis_kernel(
    const SentimentResult* __restrict__ sentiments,
    int num_messages,
    int* tense_count,       // atomic
    int* creative_count,    // atomic
    int* friction_count,    // atomic
    int* total_pitch,       // atomic
    float* total_energy,    // atomic
    int* unique_pitch_bitmap // [128] atomic-set
) {
    extern __shared__ int s_data[]; // shared reduction buffer

    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int tid = threadIdx.x;

    // Local accumulators
    int local_tense = 0;
    int local_creative = 0;
    int local_friction = 0;
    int local_pitch_sum = 0;
    float local_energy = 0.0f;

    if (idx < num_messages) {
        const SentimentResult* s = &sentiments[idx];
        local_tense = (s->label == 4) ? 1 : 0;
        local_creative = (s->label == 1) ? 1 : 0;
        local_friction = (s->friction != 0) ? 1 : 0;
        local_pitch_sum = s->pitch;
        local_energy = (float)s->velocity / 127.0f;

        // Mark unique pitch in global bitmap
        if (s->pitch < 128) {
            atomicOr(&unique_pitch_bitmap[s->pitch], 1);
        }
    }

    // Block-level reduction
    s_data[0] = local_tense;
    s_data[1] = local_creative;
    s_data[2] = local_friction;
    s_data[3] = local_pitch_sum;
    __syncthreads();

    // Tree reduction for count fields
    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (tid < s) {
            s_data[0] += s_data[0 + s];
            s_data[1] += s_data[1 + s];
            s_data[2] += s_data[2 + s];
            s_data[3] += s_data[3 + s];
        }
        __syncthreads();
    }

    // Thread 0 in each block atomically merges to global
    if (tid == 0) {
        atomicAdd(tense_count, s_data[0]);
        atomicAdd(creative_count, s_data[1]);
        atomicAdd(friction_count, s_data[2]);
        atomicAdd(total_pitch, s_data[3]);
    }
}

// ════════════════════════════════════════════════════════════════════
// HOST LAUNCHERS
// ════════════════════════════════════════════════════════════════════

#define BLOCK_SIZE 256
#define CHECK_CUDA(call) do { \
    cudaError_t err = call; \
    if (err != cudaSuccess) { \
        fprintf(stderr, "CUDA error at %s:%d: %s\n", __FILE__, __LINE__, \
                cudaGetErrorString(err)); \
        exit(1); \
    } \
} while(0)

/**
 * Run sentiment analysis on a batch of messages on the GPU.
 *
 * messages: array of N messages, each MAX_MSG_LEN bytes (null-terminated)
 * msg_lengths: array of N lengths
 * results: output array of N SentimentResults
 * num_messages: N
 */
void run_sentiment_analysis(
    const char* messages,
    const int* msg_lengths,
    SentimentResult* results,
    int num_messages
) {
    if (num_messages <= 0) return;

    // Allocate device memory
    char* d_messages;
    int* d_lengths;
    SentimentResult* d_results;
    char *d_positive, *d_negative, *d_question, *d_creative;

    size_t msg_bytes = (size_t)num_messages * MAX_MSG_LEN;
    size_t tbl_bytes_positive = NUM_POSITIVE * MAX_WORD_LEN;
    size_t tbl_bytes_negative = NUM_NEGATIVE * MAX_WORD_LEN;
    size_t tbl_bytes_question = NUM_QUESTION * MAX_WORD_LEN;
    size_t tbl_bytes_creative = NUM_CREATIVE * MAX_WORD_LEN;

    CHECK_CUDA(cudaMalloc(&d_messages, msg_bytes));
    CHECK_CUDA(cudaMalloc(&d_lengths, num_messages * sizeof(int)));
    CHECK_CUDA(cudaMalloc(&d_results, num_messages * sizeof(SentimentResult)));
    CHECK_CUDA(cudaMalloc(&d_positive, tbl_bytes_positive));
    CHECK_CUDA(cudaMalloc(&d_negative, tbl_bytes_negative));
    CHECK_CUDA(cudaMalloc(&d_question, tbl_bytes_question));
    CHECK_CUDA(cudaMalloc(&d_creative, tbl_bytes_creative));

    // Copy data to device
    CHECK_CUDA(cudaMemcpy(d_messages, messages, msg_bytes, cudaMemcpyHostToDevice));
    CHECK_CUDA(cudaMemcpy(d_lengths, msg_lengths, num_messages * sizeof(int), cudaMemcpyHostToDevice));
    CHECK_CUDA(cudaMemcpy(d_positive, POSITIVE_WORDS_H, tbl_bytes_positive, cudaMemcpyHostToDevice));
    CHECK_CUDA(cudaMemcpy(d_negative, NEGATIVE_WORDS_H, tbl_bytes_negative, cudaMemcpyHostToDevice));
    CHECK_CUDA(cudaMemcpy(d_question, QUESTION_WORDS_H, tbl_bytes_question, cudaMemcpyHostToDevice));
    CHECK_CUDA(cudaMemcpy(d_creative, CREATIVE_WORDS_H, tbl_bytes_creative, cudaMemcpyHostToDevice));

    // Launch kernel
    int grid = (num_messages + BLOCK_SIZE - 1) / BLOCK_SIZE;
    sentiment_analysis_kernel<<<grid, BLOCK_SIZE>>>(
        d_messages, d_lengths, d_results,
        d_positive, d_negative, d_question, d_creative,
        num_messages
    );
    CHECK_CUDA(cudaGetLastError());

    // Copy results back
    CHECK_CUDA(cudaMemcpy(results, d_results, num_messages * sizeof(SentimentResult),
                          cudaMemcpyDeviceToHost));

    // Cleanup
    cudaFree(d_messages);
    cudaFree(d_lengths);
    cudaFree(d_results);
    cudaFree(d_positive);
    cudaFree(d_negative);
    cudaFree(d_question);
    cudaFree(d_creative);
}

// ════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════

#ifdef RUN_TESTS

static int tests_run = 0;
static int tests_passed = 0;

#define ASSERT(cond, msg) \
    do { \
        tests_run++; \
        if (!(cond)) { \
            printf("  FAIL: %s\n", msg); \
            return; \
        } \
        tests_passed++; \
        printf("  PASS: %s\n", msg); \
    } while(0)

static void test_sentiment_positive() {
    const char* msg = "This is great and wonderful!";
    char messages[1 * MAX_MSG_LEN] = {};
    strncpy(messages, msg, MAX_MSG_LEN - 1);
    int lengths[1] = { (int)strlen(msg) };
    SentimentResult results[1];

    run_sentiment_analysis(messages, lengths, results, 1);

    ASSERT(results[0].positivity >= 2, "positive sentiment positivity >= 2");
    ASSERT(results[0].label == 0, "positive label = bright"); // 0 = bright
    ASSERT(results[0].pitch > 60, "positive pitch > 60");
}

static void test_sentiment_negative() {
    const char* msg = "This is terrible and broken";
    char messages[1 * MAX_MSG_LEN] = {};
    strncpy(messages, msg, MAX_MSG_LEN - 1);
    int lengths[1] = { (int)strlen(msg) };
    SentimentResult results[1];

    run_sentiment_analysis(messages, lengths, results, 1);

    ASSERT(results[0].negativity >= 2, "negative sentiment negativity >= 2");
    ASSERT(results[0].label == 4, "negative label = tense"); // 4 = tense
    ASSERT(results[0].pitch < 60, "negative pitch < 60");
    ASSERT(results[0].friction & FRICTION_AMBIGUITY, "friction has AMBIGUITY bit");
}

static void test_sentiment_creative() {
    const char* msg = "Let's build and design something amazing";
    char messages[1 * MAX_MSG_LEN] = {};
    strncpy(messages, msg, MAX_MSG_LEN - 1);
    int lengths[1] = { (int)strlen(msg) };
    SentimentResult results[1];

    run_sentiment_analysis(messages, lengths, results, 1);

    ASSERT(results[0].creativity >= 2, "creative sentiment creativity >= 2");
    ASSERT(results[0].label == 1, "creative label = creative"); // 1 = creative
}

static void test_sentiment_question() {
    const char* msg = "What is this? How does it work?";
    char messages[1 * MAX_MSG_LEN] = {};
    strncpy(messages, msg, MAX_MSG_LEN - 1);
    int lengths[1] = { (int)strlen(msg) };
    SentimentResult results[1];

    run_sentiment_analysis(messages, lengths, results, 1);

    ASSERT(results[0].question >= 2, "question sentiment question >= 2");
    ASSERT(results[0].label == 2, "question label = inquiring"); // 2 = inquiring
}

static void test_sentiment_error_friction() {
    const char* msg = "The build failed with an error";
    char messages[1 * MAX_MSG_LEN] = {};
    strncpy(messages, msg, MAX_MSG_LEN - 1);
    int lengths[1] = { (int)strlen(msg) };
    SentimentResult results[1];

    run_sentiment_analysis(messages, lengths, results, 1);

    ASSERT(results[0].friction & FRICTION_SYNTAX_ERROR, "error triggers SYNTAX_ERROR friction");
}

static void test_batch_processing() {
    const char* msgs[] = {
        "Great work everyone!",
        "Oh no, the build failed",
        "What should we do next?",
        "Let's build something creative",
        "The system is working perfectly"
    };
    int n = 5;
    char messages[5 * MAX_MSG_LEN] = {};
    int lengths[5];

    for (int i = 0; i < n; i++) {
        strncpy(messages + i * MAX_MSG_LEN, msgs[i], MAX_MSG_LEN - 1);
        lengths[i] = (int)strlen(msgs[i]);
    }

    SentimentResult results[5];
    run_sentiment_analysis(messages, lengths, results, n);

    ASSERT(results[0].positivity > 0, "batch[0] positive");
    ASSERT(results[1].negativity > 0, "batch[1] negative");
    ASSERT(results[2].question > 0, "batch[2] question");
    ASSERT(results[3].creativity > 0, "batch[3] creative");
    ASSERT(results[4].positivity > 0, "batch[4] positive");
}

static void test_pitch_range() {
    // All negative → pitch should be clamped low
    const char* msg = "bad bad bad bad bad bad bad bad bad bad";
    char messages[1 * MAX_MSG_LEN] = {};
    strncpy(messages, msg, MAX_MSG_LEN - 1);
    int lengths[1] = { (int)strlen(msg) };
    SentimentResult results[1];

    run_sentiment_analysis(messages, lengths, results, 1);
    ASSERT(results[0].pitch <= 10, "heavily negative pitch clamped low");

    // All positive → pitch should be high
    const char* msg2 = "great great great great great great great great great great";
    memset(messages, 0, MAX_MSG_LEN);
    strncpy(messages, msg2, MAX_MSG_LEN - 1);
    lengths[0] = (int)strlen(msg2);
    run_sentiment_analysis(messages, lengths, results, 1);
    ASSERT(results[0].pitch >= 90, "heavily positive pitch high");
}

int main() {
    // Quick device check
    int device_count = 0;
    cudaGetDeviceCount(&device_count);
    if (device_count == 0) {
        printf("No CUDA device available. Running tests on CPU fallback.\n");
        printf("(CUDA tests require a GPU)\n");
        return 0;
    }

    printf("╔═══════════════════════════════════════════════════════════╗\n");
    printf("║   TENSOR-MIDI CUDA — RUNNING TESTS                       ║\n");
    printf("╚═══════════════════════════════════════════════════════════╝\n\n");

    test_sentiment_positive();
    test_sentiment_negative();
    test_sentiment_creative();
    test_sentiment_question();
    test_sentiment_error_friction();
    test_batch_processing();
    test_pitch_range();

    printf("\n%d/%d tests passed.\n", tests_passed, tests_run);
    return tests_passed == tests_run ? 0 : 1;
}

#endif // RUN_TESTS
