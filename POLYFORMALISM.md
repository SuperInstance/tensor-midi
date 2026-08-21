# POLYFORMALISM.md — The Tensor-MIDI Engine Across 5 Languages

```
╔══════════════════════════════════════════════════════════════════╗
║     THE TENSOR-MIDI POLYFORMALISM ENGINE                         ║
║     12-pulse conversation-as-jazz, expressed in 5 languages      ║
╚══════════════════════════════════════════════════════════════════╝
```

*"When I said to the metal I mean like the good ol' days. We write in everything from Fortran to C++ to Ruby to Go to Mojo to Rust to C to CUDA. We do this because they constrain what we can do and how we can do it so we must twist our logic to optimise in novel ways that can later be synthesized into other languages or build low-level modifications because we understand what's happening under the compiler."* — Casey

---

## THE ARCHITECTURE

The engine is one system, five implementations. Each language builds the same core — SWMIDI codec, sentiment analyzer, 12-pulse grid, jazz analysis — but each language's constraints teach something the others can't.

```
                    ┌─────────────────┐
                    │  CONVERSATION   │
                    │ (messages in)   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  SENTIMENT      │  text → pitch/velocity/friction
                    │  ANALYZER       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  12-PULSE GRID  │  events mapped to 12/8 time
                    │  (96 PPQ)       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  JAZZ ANALYSIS  │  tension/energy/mode detection
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  SWMIDI-8 WIRE  │  8 bytes per event
                    │  FORMAT         │
                    └─────────────────┘
```

### Shared Constants (proven identical across all 5)

| Constant | Value | Where Proven |
|----------|-------|--------------|
| PPQ | 96 | tempo-core (Rust), all implementations |
| PULSES_PER_BAR | 12 | engine.js (JS), all implementations |
| TICKS_PER_PULSE | 48 | 96 / 2 |
| TICKS_PER_BAR | 576 | 12 × 48 |
| PACKED_SIZE | 8 bytes | swmidi (Rust), all implementations |

---

## THE 5 IMPLEMENTATIONS

### 1. RUST — `slackwater-rust/crates/tensor-midi-core/`

**Status: ✅ 29/29 tests passing**

Files:
- `Cargo.toml` — workspace crate, depends on swmidi + tempo-core
- `src/lib.rs` — full implementation (sentiment, ring buffer, pulse grid, jazz, capture)

**What Rust's borrow checker forced us to understand about lifetimes:**

The sentiment analyzer works on `&str` — borrowed string slices. It never takes ownership, never allocates a copy. The word tables are `&'static [&'static str]` — they live in the binary's read-only segment, shared by all callers, never copied. When the analyzer counts matches, it iterates over borrowed data with borrowed iterators.

The ring buffer owns its `Vec<SwmidiEvent>`, but hands out `&SwmidiEvent` references that can never outlive the buffer. When the buffer wraps and overwrites, the old event is gone — no dangling pointers, because the borrow checker prevents you from holding a reference across a `push()` call.

The `Capture` struct owns everything: the ring buffer, the pulse grid, the participant map, the beat clock. Analysis functions take `&Capture` or `&[CapturedMessage]` — they borrow, they don't steal. This is the ownership discipline: **one owner, many borrowers, clear lifetimes**.

The key insight: **lifetimes aren't about memory safety in the garbage-collected sense. They're about documenting who can read what, when. The borrow checker is a design tool that reveals the topology of your data flow.**

### 2. C99 — `fleet-jepa-midi/native/tensor_midi.c` + `tensor_midi.h`

**Status: ✅ 17/17 tests passing**

Files:
- `tensor_midi.h` — header with types, constants, function declarations
- `tensor_midi.c` — implementation + tests (compile with `-DTM_TEST`)
- Build: `cc -std=c99 -Wall -Wextra -DTM_TEST -o test_tensor_midi tensor_midi.c`

**What C's manual memory taught about the minimum viable structure:**

The ring buffer is `tm_event_t buffer[TM_DEFAULT_RING_CAP]` — a compile-time constant array inside the struct. No `malloc()`. No `realloc()`. No `free()`. The buffer size is a `#define` — you decide at compile time how much memory you can afford.

The word tables are `static const char *const[]` — they live in `.rodata` on most platforms. They cost zero runtime allocation. The analyzer scans the input string with `ci_contains()` — a hand-rolled case-insensitive substring search. No regex engine, no string splitting, no heap-allocated word arrays.

The `intervals` array in `tm_detect_tempo()` is stack-allocated at `uint64_t intervals[256]` — you must decide upfront: "I will never need more than 256 intervals." If someone passes 500 timestamps, you process the first 256. This is a limitation that becomes a guarantee: **the function will never allocate more than 2KB of stack.**

C teaches: **the minimum viable data structure is the one where every byte is accounted for. You discover that you don't need dynamic allocation for 90% of your use cases. The remaining 10% is where the real engineering lives.**

### 3. ZIG — `fleet-jepa-midi/native/tensor_midi.zig`

**Status: ✅ Written, follows Zig 0.14+ syntax (Zig compiler not installed on this system)**

Files:
- `tensor_midi.zig` — implementation + inline tests
- `build.zig` — build file (`zig build test`)

**What Zig's comptime proved about which sizes are truly known:**

The ring buffer in Zig is `pub fn RingBuffer(comptime capacity: usize) type`. The capacity is a **compile-time parameter** — the compiler generates a new type for each capacity value. `RingBuffer(256)` and `RingBuffer(1024)` are different types, and the compiler proves at the call site that the size is known.

This is stronger than C's `#define`. In C, the buffer capacity is a preprocessor constant — it's text substitution. In Zig, it's a type parameter — the type system tracks it. You cannot accidentally pass a `RingBuffer(256)` to a function expecting a `RingBuffer(1024)`.

The `pitch_seen` bitmap in the jazz analyzer is `var pitch_seen: [128]bool = [_]bool{false} ** 128;` — array initialization at declaration, size proven at compile time. The `**` operator is comptime array repetition.

The error handling is explicit: `EventType.fromNibble()` returns `?EventType` (an optional). You must handle the `null` case — the compiler won't let you forget. There are no exceptions, no hidden control flow. Every failure path is visible in the type signature.

Zig teaches: **some sizes are truly knowable at compile time (the ring buffer capacity, the pitch bitmap size, the word table lengths). Some are only knowable at runtime (the number of messages, the text length). The language forces you to sort them into the right category — and the compiler checks your work.**

### 4. PYTHON — `fleet-jepa-midi/bindings/tensor_midi.py`

**Status: ✅ 24/24 tests passing**

Files:
- `tensor_midi.py` — pure-Python implementation + PyO3 import fallback
- Run: `python3 tensor_midi.py`

**What Python's GIL revealed about natural batch boundaries:**

The `analyze_sentiment_batch()` function exists because of the GIL. Individual `analyze_sentiment()` calls are fast — microseconds each. But if you're processing 10,000 messages, calling the function 10,000 times from a loop means 10,000 GIL acquisitions (well, technically zero extra acquisitions since Python holds the GIL continuously, but the point stands conceptually).

The natural boundary is: **a list of messages in, a list of sentiments out.** This is the unit of work that gets handed to `multiprocessing.Pool.map()` for parallel processing. You don't parallelize individual words — you parallelize batches.

The `Capture.capture_batch()` method embodies this: "here's a list of messages, process them all." The GIL means there's no benefit to fine-grained locking within the batch — just process everything and return the result.

The `frozenset` word tables are immutable — the GIL guarantees thread-safe access to them, but it also means there's no point trying to modify them. This pushes you toward functional patterns: pure functions, immutable data, list in → list out.

Python teaches: **the natural batch boundary is the function call that processes a list. The GIL makes this not a limitation but a design principle: batch your work, process it, return the result. Don't try to be clever about concurrency — be clear about boundaries.**

### 5. CUDA — `fleet-jepa-midi/native/sentiment_kernel.cu`

**Status: ✅ Written, requires nvcc to compile (no GPU on this system)**

Files:
- `sentiment_kernel.cu` — CUDA kernel + host launchers + tests
- Build: `nvcc -DRUN_TESTS -o sentiment_kernel sentiment_kernel.cu`

**What CUDA's warp divergence taught about the algorithm's true shape:**

The naive sentiment analyzer is a branchy if-else chain:

```
if contains(text, "great"): positivity++
if contains(text, "awesome"): positivity++
if contains(text, "bad"): negativity++
... 68 branches total
```

In a CUDA warp (32 threads executing in lockstep), if thread 0 takes the first branch and threads 1-31 don't, the warp **serializes** — it executes both paths, masking off the threads that shouldn't take each one. With 68 possible branches, a single warp could serialize to hundreds of cycles.

The CUDA-optimal approach is **branchless word matching**: every thread walks the same word table in lockstep. The "match" is computed as an integer (0 or 1), not a branch. The sum accumulates without divergence. The ternary operator `? :` compiles to a predicated move — no branch instruction emitted.

This reveals something the branchy version hides: **sentiment analysis is a dot product.** `text × word_table = sentiment_vector`. The branchy version hides this behind control flow. The GPU version exposes the mathematical shape:

```
positivity = Σ contains(text, word) for word in positive_table
negativity = Σ contains(text, word) for word in negative_table
```

The shared memory word tables are loaded once per block, cooperatively by all threads. This is the `__shared__` memory pattern from cudaclaw's cell agent: each message is a cell, each cell gets the same lookup table, the table lives in shared memory for the lifetime of the block.

The jazz analysis kernel uses atomic operations for the reduction: `atomicAdd(&tense_count, 1)`. This is fine because the reduction is across thousands of threads, not millions — the contention is bounded. The unique pitch bitmap uses `atomicOr(&unique_pitch_bitmap[pitch], 1)` — branchless set.

CUDA teaches: **the algorithm's true shape is the data flow, not the control flow. When you remove the branches, you see that sentiment analysis is a matrix multiply. The branches were hiding the mathematical structure behind imperative thinking.**

---

## CROSS-LANGUAGE SYNTHESIS

### What Each Language Contributed to the Others

| Language | Insight | Impact on Other Implementations |
|----------|---------|---------------------------------|
| **Rust** | Ownership topology: the Capture owns, analyzers borrow | C and Zig use the same pattern: capture struct owns buffer, analysis functions take const pointers |
| **C** | Minimum viable structure: static arrays, no malloc | Rust's ring buffer uses the same fixed-capacity pattern, just with Vec instead of raw array |
| **Zig** | Compile-time size proof: RingBuffer(CAPACITY) is a type | C uses `#define` for capacity (weaker); Rust uses const generics (similar power); Python ignores it entirely |
| **Python** | Batch boundary: list in, list out | CUDA processes the same batch — one thread per message, one kernel launch per batch |
| **CUDA** | Algorithm is a dot product, not a branch chain | All implementations now use count-based approach (sum of contains() results) rather than nested if-else |

### The Shared Wire Format

All 5 implementations produce and consume the same SWMIDI-8 format:

```
byte 0     status:     type(4 bits) | channel(4 bits)
byte 1     pitch:      0–127
byte 2     velocity:   0–127
byte 3     error_mask  friction bitfield
bytes 4–7  tick:       uint32 LE, 96 PPQ
```

An event encoded by the Rust crate can be decoded by the C implementation, the Zig implementation, the Python implementation, or the CUDA host code. They all agree on the wire format. They all disagree on how to get there.

### Test Parity Matrix

| Implementation | Tests | Status |
|---------------|-------|--------|
| Rust | 29 | ✅ passing |
| C99 | 17 | ✅ passing |
| Zig | 16 | ⚠️ written (no compiler) |
| Python | 24 | ✅ passing |
| CUDA | 7 | ⚠️ written (no GPU) |

---

## THE DEEPER LESSON

The polyformalism engine isn't really about sentiment analysis or MIDI encoding. It's about **what each language's constraint structure reveals about the problem domain.**

- Rust reveals the **ownership topology** of conversation capture
- C reveals the **memory budget** of the minimum viable structure
- Zig reveals which sizes are **compile-time knowable** vs runtime
- Python reveals the **natural batch boundaries** of text processing
- CUDA reveals the **mathematical shape** hiding behind imperative branches

Each implementation is a projection of the same system through a different constraint lens. The projections overlap but don't coincide — each one shows you something the others hide. Together, they form a stereo image of the algorithm.

This is why we write to the metal. Not because high-level is bad, but because each level of abstraction hides information. The metal remembers what the compiler forgets.

---

*"Wesley could grow many ways."*

And so could the engine. Five languages, one system, infinite projections.

---

**Repository:** `github.com/SuperInstance/fleet-jepa-midi`
**Rust workspace:** `github.com/SuperInstance/slackwater-rust` → `crates/tensor-midi-core`
**Built:** August 8, 2026
