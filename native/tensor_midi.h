/*
 * tensor_midi.h — Tensor-MIDI Polyformalism Engine (C99)
 *
 * What C teaches: no hidden allocations, no constructors, manual memory
 * management. You discover the minimum viable data structure. The ring
 * buffer size is a compile-time constant. Everything is statically sized.
 *
 * This is portable C99 — no dependencies beyond stdint.h and string.h.
 * Could compile for ESP32 alongside engine-ensign firmware.
 *
 * SWMIDI-8 wire format: 8 bytes per event, little-endian
 *   byte 0     status:     type(4 bits) | channel(4 bits)
 *   byte 1     pitch:      0-127
 *   byte 2     velocity:   0-127
 *   byte 3     error_mask  friction bitfield
 *   bytes 4-7  tick:       uint32, 96 PPQ
 */

#ifndef TENSOR_MIDI_H
#define TENSOR_MIDI_H

#include <stdint.h>
#include <string.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── Constants ─────────────────────────────────────────────────────── */

#define TM_PPQ                 96u
#define TM_PULSES_PER_BAR      12u
#define TM_TICKS_PER_PULSE     (TM_PPQ / 2u)   /* 48 */
#define TM_TICKS_PER_BAR       (TM_PULSES_PER_BAR * TM_TICKS_PER_PULSE)  /* 576 */

#define TM_PACKED_SIZE         8u
#define TM_DEFAULT_RING_CAP    256u
#define TM_MAX_WORD_LEN        32

/* Event types */
typedef enum {
    TM_EVENT_NOTE_ON       = 0,
    TM_EVENT_NOTE_OFF      = 1,
    TM_EVENT_CONTROL_CHANGE = 2,
    TM_EVENT_PROGRAM_CHANGE = 3,
    TM_EVENT_META          = 4,
} tm_event_type_t;

/* Friction bitfield */
#define TM_FRICTION_NONE          0x00u
#define TM_FRICTION_TIMEOUT       0x01u
#define TM_FRICTION_CONFLICT      0x02u
#define TM_FRICTION_RATE_LIMIT    0x04u
#define TM_FRICTION_AMBIGUITY     0x08u
#define TM_FRICTION_IMPORT_ERROR  0x10u
#define TM_FRICTION_SYNTAX_ERROR  0x20u
#define TM_FRICTION_TYPE_MISMATCH 0x40u
#define TM_FRICTION_NETWORK_ERROR 0x80u

/* Sentiment labels */
typedef enum {
    TM_SENT_BRIGHT    = 0,
    TM_SENT_CREATIVE  = 1,
    TM_SENT_INQUIRING = 2,
    TM_SENT_NEUTRAL   = 3,
    TM_SENT_TENSE     = 4,
    TM_SENT_RESOLVED  = 5,
} tm_sentiment_label_t;

/* Channel assignments */
#define TM_CH_HUMAN      0u
#define TM_CH_ASSISTANT  1u
#define TM_CH_SUBAGENT_1 2u
#define TM_CH_SUBAGENT_2 3u
#define TM_CH_SUBAGENT_3 4u
#define TM_CH_SYSTEM     8u
#define TM_CH_TOOL       9u
#define TM_CH_ERROR      15u

/* ── SWMIDI Event ──────────────────────────────────────────────────── */

typedef struct {
    uint8_t  event_type;   /* tm_event_type_t */
    uint8_t  channel;      /* 0-15 */
    uint8_t  pitch;        /* 0-127 */
    uint8_t  velocity;     /* 0-127 */
    uint8_t  error_mask;   /* friction bitfield */
    uint32_t tick;         /* 96 PPQ */
} tm_event_t;

/* Encode an event to 8 bytes. dst must be >= 8 bytes. */
void tm_encode(const tm_event_t *event, uint8_t *dst);

/* Decode 8 bytes to an event. Returns 0 on success, -1 on invalid type. */
int tm_decode(const uint8_t *src, tm_event_t *out);

/* ── Ring Buffer (compile-time sized, no malloc) ───────────────────── */
/*
 * What C teaches: the ring buffer is a fixed-size array. You cannot
 * grow it at runtime. You must decide upfront how many events you
 * can afford to store. This forces you to think about memory budget.
 */

typedef struct {
    tm_event_t buffer[TM_DEFAULT_RING_CAP];
    uint32_t   capacity;
    uint32_t   head;
    uint32_t   len;
} tm_ring_buffer_t;

void tm_ring_init(tm_ring_buffer_t *rb);
void tm_ring_push(tm_ring_buffer_t *rb, tm_event_t event);
const tm_event_t *tm_ring_last(const tm_ring_buffer_t *rb);
uint32_t tm_ring_len(const tm_ring_buffer_t *rb);
bool tm_ring_is_empty(const tm_ring_buffer_t *rb);
bool tm_ring_is_full(const tm_ring_buffer_t *rb);

/* Iterate: returns pointer to event at logical index, or NULL */
const tm_event_t *tm_ring_get(const tm_ring_buffer_t *rb, uint32_t logical_index);

/* ── Sentiment Analysis ────────────────────────────────────────────── */
/*
 * Word tables are statically allocated const arrays. No heap usage.
 * The analyzer scans the input string character by character, checking
 * against fixed-size word tables.
 */

typedef struct {
    uint8_t pitch;         /* 0-127 */
    uint8_t friction;      /* bitfield */
    uint8_t velocity;      /* 0-127 */
    uint8_t label;         /* tm_sentiment_label_t */
    uint8_t positivity;
    uint8_t negativity;
    uint8_t question;
    uint8_t creativity;
} tm_sentiment_t;

/*
 * Analyze sentiment of a text string.
 * text: NUL-terminated string. Must not be NULL.
 * Returns a tm_sentiment_t by value (small struct, fits in registers).
 */
tm_sentiment_t tm_analyze_sentiment(const char *text);

/* ── Pulse Position ────────────────────────────────────────────────── */

typedef struct {
    uint32_t bar;
    uint8_t  pulse;      /* 0-11 */
    uint8_t  sub_tick;   /* 0-47 */
} tm_pulse_pos_t;

tm_pulse_pos_t tm_tick_to_pulse(uint32_t tick);
uint32_t tm_pulse_to_tick(tm_pulse_pos_t pos);

/* ── Jazz Mode ─────────────────────────────────────────────────────── */

typedef enum {
    TM_JAZZ_GROOVE   = 0,
    TM_JAZZ_BUILDING = 1,
    TM_JAZZ_TENSION  = 2,
    TM_JAZZ_RELEASE  = 3,
    TM_JAZZ_SOLO     = 4,
    TM_JAZZ_COMPING  = 5,
    TM_JAZZ_FREE     = 6,
    TM_JAZZ_BALLAD   = 7,
} tm_jazz_mode_t;

typedef struct {
    tm_jazz_mode_t mode;
    float tension;
    float energy;
    float complexity;
    float avg_pitch;
    float flow_ratio;
    float friction_ratio;
    uint32_t event_count;
} tm_jazz_analysis_t;

/*
 * Analyze a batch of sentiments (array of tm_sentiment_t).
 * This is the natural batch boundary C discovers: you pass an array
 * and its length, the function processes them all in one call.
 */
tm_jazz_analysis_t tm_analyze_jazz(const tm_sentiment_t *sentiments, uint32_t count);

/* ── Tempo Detection ───────────────────────────────────────────────── */

float tm_detect_tempo(const uint64_t *timestamps_ms, uint32_t count);

#ifdef __cplusplus
}
#endif

#endif /* TENSOR_MIDI_H */
