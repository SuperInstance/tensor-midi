/*
 * tensor_midi.c — Tensor-MIDI Polyformalism Engine (C99)
 *
 * What C teaches: no hidden allocations, no constructors, manual memory
 * management. You discover the minimum viable data structure. The ring
 * buffer size becomes a compile-time constant. Everything is statically
 * sized. No malloc on the hot path. No free() to forget.
 *
 * Portable C99. Compiles on ESP32, Arduino, or anything with a C compiler.
 *
 * Build: cc -std=c99 -Wall -Wextra -O2 -c tensor_midi.c
 * Test:  cc -std=c99 -Wall -DTM_TEST -o test_tensor_midi tensor_midi.c && ./test_tensor_midi
 */

#include "tensor_midi.h"

/* ════════════════════════════════════════════════════════════════════
 * SWMIDI Encode / Decode
 * ════════════════════════════════════════════════════════════════════ */

void tm_encode(const tm_event_t *event, uint8_t *dst) {
    /* byte 0: status = type(4 bits) | channel(4 bits) */
    dst[0] = (uint8_t)((event->event_type << 4) | (event->channel & 0x0F));
    /* byte 1: pitch */
    dst[1] = event->pitch & 0x7F;
    /* byte 2: velocity */
    dst[2] = event->velocity & 0x7F;
    /* byte 3: error_mask */
    dst[3] = event->error_mask;
    /* bytes 4-7: tick (little-endian uint32) */
    dst[4] = (uint8_t)(event->tick & 0xFF);
    dst[5] = (uint8_t)((event->tick >> 8) & 0xFF);
    dst[6] = (uint8_t)((event->tick >> 16) & 0xFF);
    dst[7] = (uint8_t)((event->tick >> 24) & 0xFF);
}

int tm_decode(const uint8_t *src, tm_event_t *out) {
    uint8_t type_nibble = (src[0] >> 4) & 0x0F;
    if (type_nibble > 4) {
        return -1; /* invalid event type */
    }
    out->event_type = type_nibble;
    out->channel    = src[0] & 0x0F;
    out->pitch      = src[1] & 0x7F;
    out->velocity   = src[2] & 0x7F;
    out->error_mask = src[3];
    out->tick       = (uint32_t)src[4]
                    | ((uint32_t)src[5] << 8)
                    | ((uint32_t)src[6] << 16)
                    | ((uint32_t)src[7] << 24);
    return 0;
}

/* ════════════════════════════════════════════════════════════════════
 * Ring Buffer
 * ════════════════════════════════════════════════════════════════════ */

void tm_ring_init(tm_ring_buffer_t *rb) {
    rb->capacity = TM_DEFAULT_RING_CAP;
    rb->head     = 0;
    rb->len      = 0;
    /* buffer is statically sized — no memset needed, we track len */
}

void tm_ring_push(tm_ring_buffer_t *rb, tm_event_t event) {
    if (rb->len < rb->capacity) {
        rb->buffer[rb->head] = event;
        rb->head = (rb->head + 1) % rb->capacity;
        rb->len++;
    } else {
        /* Overwrite oldest */
        rb->buffer[rb->head] = event;
        rb->head = (rb->head + 1) % rb->capacity;
    }
}

const tm_event_t *tm_ring_last(const tm_ring_buffer_t *rb) {
    if (rb->len == 0) return NULL;
    uint32_t idx = (rb->head == 0) ? (rb->capacity - 1) : (rb->head - 1);
    return &rb->buffer[idx];
}

uint32_t tm_ring_len(const tm_ring_buffer_t *rb) {
    return rb->len;
}

bool tm_ring_is_empty(const tm_ring_buffer_t *rb) {
    return rb->len == 0;
}

bool tm_ring_is_full(const tm_ring_buffer_t *rb) {
    return rb->len == rb->capacity;
}

const tm_event_t *tm_ring_get(const tm_ring_buffer_t *rb, uint32_t logical_index) {
    if (logical_index >= rb->len) return NULL;
    uint32_t start;
    if (rb->len < rb->capacity) {
        start = 0;
    } else {
        start = rb->head; /* oldest is at head when full */
    }
    uint32_t physical = (start + logical_index) % rb->capacity;
    return &rb->buffer[physical];
}

/* ════════════════════════════════════════════════════════════════════
 * Sentiment Analysis
 * ════════════════════════════════════════════════════════════════════
 *
 * What C teaches: the word tables are const arrays in static storage.
 * No heap allocation. The analyzer scans the string once, lowercase-
 * matching against fixed tables. You discover that strstr() or memcmp()
 * is the right primitive — no regex, no dynamic splitting.
 */

/* Static word tables — const, in .rodata on most platforms */
static const char *const POSITIVE_WORDS[] = {
    "great", "awesome", "love", "perfect", "excellent", "wonderful",
    "yes", "good", "amazing", "fantastic", "beautiful", "brilliant",
    "nice", "cool", "happy", "glad", "thanks", "thank", "sweet",
    "win", "success", "proud",
};
static const uint32_t POSITIVE_COUNT =
    sizeof(POSITIVE_WORDS) / sizeof(POSITIVE_WORDS[0]);

static const char *const NEGATIVE_WORDS[] = {
    "bad", "error", "fail", "broken", "hate", "wrong", "no", "terrible",
    "awful", "crash", "bug", "issue", "stuck", "frustrated", "annoying",
    "slow", "dead", "lost", "miss", "angry", "sad",
};
static const uint32_t NEGATIVE_COUNT =
    sizeof(NEGATIVE_WORDS) / sizeof(NEGATIVE_WORDS[0]);

static const char *const QUESTION_WORDS[] = {
    "what", "how", "why", "where", "when", "who", "which", "?",
};
static const uint32_t QUESTION_COUNT =
    sizeof(QUESTION_WORDS) / sizeof(QUESTION_WORDS[0]);

static const char *const CREATIVE_WORDS[] = {
    "imagine", "create", "build", "design", "compose", "paint", "draw",
    "write", "dream", "invent", "explore", "craft", "forge", "shape",
    "mold", "weave", "spark",
};
static const uint32_t CREATIVE_COUNT =
    sizeof(CREATIVE_WORDS) / sizeof(CREATIVE_WORDS[0]);

/* Case-insensitive substring search */
static bool ci_contains(const char *haystack, const char *needle) {
    if (*needle == '\0') return true;

    for (const char *h = haystack; *h; h++) {
        const char *hi = h;
        const char *ni = needle;
        while (*hi && *ni) {
            char hc = *hi;
            char nc = *ni;
            /* lowercase both */
            if (hc >= 'A' && hc <= 'Z') hc += 32;
            if (nc >= 'A' && nc <= 'Z') nc += 32;
            if (hc != nc) break;
            hi++;
            ni++;
        }
        if (*ni == '\0') return true;
    }
    return false;
}

static uint8_t count_word_matches(const char *text, const char *const *words, uint32_t count) {
    uint8_t matches = 0;
    for (uint32_t i = 0; i < count; i++) {
        if (ci_contains(text, words[i])) {
            matches++;
        }
    }
    return matches;
}

tm_sentiment_t tm_analyze_sentiment(const char *text) {
    tm_sentiment_t s = {0};
    s.pitch = 60; /* middle C default */

    s.positivity = count_word_matches(text, POSITIVE_WORDS, POSITIVE_COUNT);
    s.negativity = count_word_matches(text, NEGATIVE_WORDS, NEGATIVE_COUNT);
    s.question   = count_word_matches(text, QUESTION_WORDS, QUESTION_COUNT);
    s.creativity = count_word_matches(text, CREATIVE_WORDS, CREATIVE_COUNT);

    /* Pitch mapping */
    int32_t pitch = 60;
    pitch += (int32_t)s.creativity * 8;
    pitch += (int32_t)s.positivity * 5;
    pitch -= (int32_t)s.negativity * 10;
    if (s.question > 0) {
        pitch = 72 + (int32_t)s.question * 3;
    }
    if (pitch < 0) pitch = 0;
    if (pitch > 127) pitch = 127;
    s.pitch = (uint8_t)pitch;

    /* Friction */
    s.friction = TM_FRICTION_NONE;
    if (s.negativity > 0) {
        s.friction |= TM_FRICTION_AMBIGUITY;
    }
    if (ci_contains(text, "error") || ci_contains(text, "fail") || ci_contains(text, "crash")) {
        s.friction |= TM_FRICTION_SYNTAX_ERROR;
    }

    /* Velocity from text length */
    size_t len = strlen(text);
    if (len > 500) len = 500;
    s.velocity = (uint8_t)(((float)len / 500.0f) * 127.0f);
    if (s.velocity < 1) s.velocity = 1;

    /* Label */
    if (s.negativity > s.positivity) {
        s.label = TM_SENT_TENSE;
    } else if (s.creativity > 0) {
        s.label = TM_SENT_CREATIVE;
    } else if (s.question > 0) {
        s.label = TM_SENT_INQUIRING;
    } else if (s.positivity > 0) {
        s.label = TM_SENT_BRIGHT;
    } else {
        s.label = TM_SENT_NEUTRAL;
    }

    return s;
}

/* ════════════════════════════════════════════════════════════════════
 * Pulse Position
 * ════════════════════════════════════════════════════════════════════ */

tm_pulse_pos_t tm_tick_to_pulse(uint32_t tick) {
    tm_pulse_pos_t pos;
    pos.bar      = tick / TM_TICKS_PER_BAR;
    uint32_t within = tick % TM_TICKS_PER_BAR;
    pos.pulse    = (uint8_t)(within / TM_TICKS_PER_PULSE);
    pos.sub_tick = (uint8_t)(within % TM_TICKS_PER_PULSE);
    return pos;
}

uint32_t tm_pulse_to_tick(tm_pulse_pos_t pos) {
    return pos.bar * TM_TICKS_PER_BAR
         + (uint32_t)pos.pulse * TM_TICKS_PER_PULSE
         + (uint32_t)pos.sub_tick;
}

/* ════════════════════════════════════════════════════════════════════
 * Jazz Analysis
 * ════════════════════════════════════════════════════════════════════ */

tm_jazz_analysis_t tm_analyze_jazz(const tm_sentiment_t *sentiments, uint32_t count) {
    tm_jazz_analysis_t ja = {0};

    if (count == 0) {
        ja.mode = TM_JAZZ_BALLAD;
        return ja;
    }

    uint32_t tense_count   = 0;
    uint32_t creative_count = 0;
    uint32_t friction_count = 0;
    uint32_t flow_count     = 0;
    uint32_t total_pitch    = 0;
    uint32_t total_velocity = 0;

    /* Track unique pitches with a simple 128-element bitmap (static!) */
    bool pitch_seen[128] = {false};
    uint32_t unique_pitches = 0;

    for (uint32_t i = 0; i < count; i++) {
        const tm_sentiment_t *s = &sentiments[i];
        total_pitch    += s->pitch;
        total_velocity += s->velocity;

        if (s->label == TM_SENT_TENSE) tense_count++;
        if (s->label == TM_SENT_CREATIVE) creative_count++;
        if (s->friction != 0) friction_count++;
        else flow_count++;

        if (s->pitch < 128 && !pitch_seen[s->pitch]) {
            pitch_seen[s->pitch] = true;
            unique_pitches++;
        }
    }

    ja.event_count    = count;
    ja.tension        = (float)tense_count / (float)count;
    ja.avg_pitch      = (float)total_pitch / (float)count;
    ja.energy         = ((float)total_velocity / (float)count) / 127.0f;
    ja.complexity     = ((float)unique_pitches / 12.0f) *
                        ((float)count / 20.0f < 1.0f ? (float)count / 20.0f : 1.0f);
    ja.flow_ratio     = (float)flow_count / (float)count;
    ja.friction_ratio = (float)friction_count / (float)count;

    /* Mode detection */
    if (ja.tension > 0.5f) {
        ja.mode = TM_JAZZ_TENSION;
    } else if (creative_count > 0 && ja.energy > 0.5f) {
        ja.mode = TM_JAZZ_BUILDING;
    } else if (ja.friction_ratio > 0.3f) {
        ja.mode = TM_JAZZ_FREE;
    } else if (ja.tension > 0.2f) {
        ja.mode = TM_JAZZ_RELEASE;
    } else if (ja.flow_ratio > 0.7f && count >= 5) {
        ja.mode = TM_JAZZ_GROOVE;
    } else if (count < 10 && ja.energy < 0.4f) {
        ja.mode = TM_JAZZ_COMPING;
    } else if (ja.flow_ratio > 0.8f) {
        ja.mode = TM_JAZZ_BALLAD;
    } else {
        ja.mode = TM_JAZZ_GROOVE;
    }

    return ja;
}

/* ════════════════════════════════════════════════════════════════════
 * Tempo Detection
 * ════════════════════════════════════════════════════════════════════ */

float tm_detect_tempo(const uint64_t *timestamps_ms, uint32_t count) {
    if (count < 2) return 120.0f;

    /* Compute intervals on stack (C teaches: you must size your stack) */
    /* We use a simple sort + median approach */
    uint64_t intervals[256]; /* max 256 intervals — statically bounded */
    uint32_t interval_count = 0;

    /* Assuming timestamps are already sorted; if not, sort first */
    /* For simplicity, assume sorted input */
    for (uint32_t i = 1; i < count && interval_count < 256; i++) {
        if (timestamps_ms[i] > timestamps_ms[i - 1]) {
            intervals[interval_count++] = timestamps_ms[i] - timestamps_ms[i - 1];
        }
    }

    if (interval_count == 0) return 120.0f;

    /* Simple sort (insertion sort — small arrays, no qsort dependency) */
    for (uint32_t i = 1; i < interval_count; i++) {
        uint64_t key = intervals[i];
        int32_t j = (int32_t)i - 1;
        while (j >= 0 && intervals[j] > key) {
            intervals[j + 1] = intervals[j];
            j--;
        }
        intervals[j + 1] = key;
    }

    uint64_t median = intervals[interval_count / 2];

    if (median < 100) return 240.0f;
    if (median < 250) return 180.0f;
    if (median < 500) return 140.0f;
    if (median < 1000) return 120.0f;
    if (median < 2000) return 90.0f;
    if (median < 5000) return 60.0f;
    return 40.0f;
}

/* ════════════════════════════════════════════════════════════════════
 * TESTS (compile with -DTM_TEST)
 * ════════════════════════════════════════════════════════════════════ */

#ifdef TM_TEST
#include <stdio.h>
#include <assert.h>

static int tests_run = 0;
static int tests_passed = 0;

#define TEST(name) \
    do { \
        tests_run++; \
        printf("  test %-40s ", #name); \
        test_##name(); \
        tests_passed++; \
        printf("PASS\n"); \
    } while(0)

static void test_encode_decode_roundtrip(void) {
    tm_event_t ev = {TM_EVENT_NOTE_ON, 3, 60, 100, 0, 192};
    uint8_t buf[8];
    tm_encode(&ev, buf);
    tm_event_t decoded;
    assert(tm_decode(buf, &decoded) == 0);
    assert(decoded.event_type == ev.event_type);
    assert(decoded.channel == ev.channel);
    assert(decoded.pitch == ev.pitch);
    assert(decoded.velocity == ev.velocity);
    assert(decoded.error_mask == ev.error_mask);
    assert(decoded.tick == ev.tick);
}

static void test_decode_invalid_type(void) {
    uint8_t buf[8] = {0x50, 0, 0, 0, 0, 0, 0, 0}; /* type = 5 */
    tm_event_t out;
    assert(tm_decode(buf, &out) == -1);
}

static void test_tick_little_endian(void) {
    tm_event_t ev = {TM_EVENT_META, 0, 0, 0, 0, 0x01020304};
    uint8_t buf[8];
    tm_encode(&ev, buf);
    assert(buf[4] == 0x04);
    assert(buf[5] == 0x03);
    assert(buf[6] == 0x02);
    assert(buf[7] == 0x01);
}

static void test_ring_basic(void) {
    tm_ring_buffer_t rb;
    tm_ring_init(&rb);
    assert(tm_ring_is_empty(&rb));
    assert(!tm_ring_is_full(&rb));

    tm_event_t ev = {TM_EVENT_NOTE_ON, 0, 60, 100, 0, 0};
    tm_ring_push(&rb, ev);
    assert(tm_ring_len(&rb) == 1);
    assert(!tm_ring_is_empty(&rb));
    assert(tm_ring_last(&rb)->pitch == 60);
}

static void test_ring_overflow(void) {
    /* Create a small buffer by reinitializing with known capacity */
    tm_ring_buffer_t rb;
    tm_ring_init(&rb);
    /* Fill past capacity — we use default cap */
    for (uint32_t i = 0; i < TM_DEFAULT_RING_CAP + 10; i++) {
        tm_event_t ev = {TM_EVENT_NOTE_ON, 0, (uint8_t)(i % 127), 100, 0, i};
        tm_ring_push(&rb, ev);
    }
    assert(tm_ring_len(&rb) == TM_DEFAULT_RING_CAP);
    assert(tm_ring_is_full(&rb));
}

static void test_ring_get(void) {
    tm_ring_buffer_t rb;
    tm_ring_init(&rb);
    tm_event_t ev1 = {TM_EVENT_NOTE_ON, 0, 60, 100, 0, 0};
    tm_event_t ev2 = {TM_EVENT_NOTE_ON, 0, 64, 100, 0, 48};
    tm_ring_push(&rb, ev1);
    tm_ring_push(&rb, ev2);
    assert(tm_ring_get(&rb, 0)->pitch == 60);
    assert(tm_ring_get(&rb, 1)->pitch == 64);
    assert(tm_ring_get(&rb, 2) == NULL);
}

static void test_sentiment_positive(void) {
    tm_sentiment_t s = tm_analyze_sentiment("This is great and wonderful!");
    assert(s.positivity >= 2);
    assert(s.label == TM_SENT_BRIGHT);
    assert(s.pitch > 60);
}

static void test_sentiment_negative(void) {
    tm_sentiment_t s = tm_analyze_sentiment("This is terrible and broken");
    assert(s.negativity >= 2);
    assert(s.label == TM_SENT_TENSE);
    assert(s.pitch < 60);
    assert(s.friction & TM_FRICTION_AMBIGUITY);
}

static void test_sentiment_creative(void) {
    tm_sentiment_t s = tm_analyze_sentiment("Let's build and design something");
    assert(s.creativity >= 2);
    assert(s.label == TM_SENT_CREATIVE);
}

static void test_sentiment_question(void) {
    tm_sentiment_t s = tm_analyze_sentiment("What is this? How does it work?");
    assert(s.question >= 2);
    assert(s.label == TM_SENT_INQUIRING);
    assert(s.pitch >= 72);
}

static void test_sentiment_error_friction(void) {
    tm_sentiment_t s = tm_analyze_sentiment("The build failed with an error");
    assert(s.friction & TM_FRICTION_SYNTAX_ERROR);
}

static void test_pulse_position(void) {
    tm_pulse_pos_t pos = tm_tick_to_pulse(0);
    assert(pos.bar == 0 && pos.pulse == 0);

    pos = tm_tick_to_pulse(TM_TICKS_PER_BAR);
    assert(pos.bar == 1 && pos.pulse == 0);

    pos = tm_tick_to_pulse(6 * TM_TICKS_PER_PULSE);
    assert(pos.bar == 0 && pos.pulse == 6);

    /* Round trip */
    uint32_t tick = 1234;
    pos = tm_tick_to_pulse(tick);
    assert(tm_pulse_to_tick(pos) == tick);
}

static void test_jazz_empty(void) {
    tm_jazz_analysis_t ja = tm_analyze_jazz(NULL, 0);
    assert(ja.mode == TM_JAZZ_BALLAD);
    assert(ja.event_count == 0);
}

static void test_jazz_positive(void) {
    tm_sentiment_t sentiments[5];
    for (int i = 0; i < 5; i++) {
        sentiments[i] = tm_analyze_sentiment("Great job on the build!");
    }
    tm_jazz_analysis_t ja = tm_analyze_jazz(sentiments, 5);
    assert(ja.tension < 0.3f);
    assert(ja.flow_ratio > 0.5f);
    assert(ja.mode == TM_JAZZ_GROOVE);
}

static void test_jazz_tense(void) {
    tm_sentiment_t sentiments[5];
    for (int i = 0; i < 5; i++) {
        sentiments[i] = tm_analyze_sentiment("Error: build failed badly");
    }
    tm_jazz_analysis_t ja = tm_analyze_jazz(sentiments, 5);
    assert(ja.tension > 0.5f);
    assert(ja.friction_ratio > 0.3f);
}

static void test_tempo_detection(void) {
    uint64_t ts[] = {0, 100, 200, 300, 400};
    float bpm = tm_detect_tempo(ts, 5);
    assert(bpm > 120.0f);

    uint64_t slow[] = {0, 5000, 10000, 15000};
    bpm = tm_detect_tempo(slow, 4);
    assert(bpm < 100.0f);

    assert(tm_detect_tempo(NULL, 0) == 120.0f);
}

static void test_constants(void) {
    assert(TM_PPQ == 96);
    assert(TM_PULSES_PER_BAR == 12);
    assert(TM_TICKS_PER_PULSE == 48);
    assert(TM_TICKS_PER_BAR == 576);
}

int main(void) {
    printf("╔═══════════════════════════════════════════════════════════╗\n");
    printf("║     TENSOR-MIDI C99 — RUNNING TESTS                      ║\n");
    printf("╚═══════════════════════════════════════════════════════════╝\n\n");

    TEST(encode_decode_roundtrip);
    TEST(decode_invalid_type);
    TEST(tick_little_endian);
    TEST(ring_basic);
    TEST(ring_overflow);
    TEST(ring_get);
    TEST(sentiment_positive);
    TEST(sentiment_negative);
    TEST(sentiment_creative);
    TEST(sentiment_question);
    TEST(sentiment_error_friction);
    TEST(pulse_position);
    TEST(jazz_empty);
    TEST(jazz_positive);
    TEST(jazz_tense);
    TEST(tempo_detection);
    TEST(constants);

    printf("\n%d/%d tests passed.\n", tests_passed, tests_run);
    return tests_passed == tests_run ? 0 : 1;
}

#endif /* TM_TEST */
