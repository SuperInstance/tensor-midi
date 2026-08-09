"""
tensor_midi.py — Tensor-MIDI Polyformalism Engine (Python)

What Python teaches: the GIL forces you to think about batch processing
versus real-time. You discover the natural batch boundaries. Lists of
messages in, lists of events out. There's no point trying to do fine-
grained locking — the GIL means you either batch or you multiprocessing.

This module provides:
    - Capture: conversation capture → SWMIDI events
    - analyze_sentiment: word-list sentiment analysis
    - analyze_jazz: tension/energy/complexity analysis
    - SWMIDI encode/decode (pure Python, matching the Rust/C/Zig wire format)

Wesley and the fleet can import:
    from tensor_midi import Capture, analyze_sentiment

This works as a standalone pure-Python implementation, OR as a PyO3
wrapper if the Rust extension is built. The pure-Python path is the
fallback — it's fast enough for batch processing.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Optional

# Try to import PyO3 extension (optional — falls back to pure Python)
try:
    import tensor_midi_core as _rust

    _HAS_RUST = True
except ImportError:
    _HAS_RUST = False


# ══════════════════════════════════════════════════════════════════════
# CONSTANTS
# ══════════════════════════════════════════════════════════════════════

PPQ = 96
PULSES_PER_BAR = 12
TICKS_PER_PULSE = PPQ // 2  # 48
TICKS_PER_BAR = PULSES_PER_BAR * TICKS_PER_PULSE  # 576
PACKED_SIZE = 8


# ══════════════════════════════════════════════════════════════════════
# ENUMS
# ══════════════════════════════════════════════════════════════════════


class EventType(IntEnum):
    NOTE_ON = 0
    NOTE_OFF = 1
    CONTROL_CHANGE = 2
    PROGRAM_CHANGE = 3
    META = 4


class SentimentLabel(IntEnum):
    BRIGHT = 0
    CREATIVE = 1
    INQUIRING = 2
    NEUTRAL = 3
    TENSE = 4
    RESOLVED = 5


class JazzMode(IntEnum):
    GROOVE = 0
    BUILDING = 1
    TENSION = 2
    RELEASE = 3
    SOLO = 4
    COMPING = 5
    FREE = 6
    BALLAD = 7


class ChordQuality(IntEnum):
    MAJOR7 = 0
    MINOR7 = 1
    DOMINANT7 = 2
    DIMINISHED = 3
    AUGMENTED = 4
    SUS4 = 5


# ══════════════════════════════════════════════════════════════════════
# FRICTION
# ══════════════════════════════════════════════════════════════════════


class Friction:
    NONE = 0x00
    TIMEOUT = 0x01
    CONFLICT = 0x02
    RATE_LIMIT = 0x04
    AMBIGUITY = 0x08
    IMPORT_ERROR = 0x10
    SYNTAX_ERROR = 0x20
    TYPE_MISMATCH = 0x40
    NETWORK_ERROR = 0x80


# ══════════════════════════════════════════════════════════════════════
# CHANNELS
# ══════════════════════════════════════════════════════════════════════


class Channel:
    HUMAN = 0
    ASSISTANT = 1
    SUBAGENT_1 = 2
    SUBAGENT_2 = 3
    SUBAGENT_3 = 4
    SYSTEM = 8
    TOOL = 9
    ERROR = 15


# ══════════════════════════════════════════════════════════════════════
# SWMIDI EVENT
# ══════════════════════════════════════════════════════════════════════


@dataclass
class SwmidiEvent:
    """A single SWMIDI event — 8 bytes on the wire."""

    event_type: EventType
    channel: int  # 0-15
    pitch: int  # 0-127
    velocity: int  # 0-127
    error_mask: int  # friction bitfield
    tick: int  # 96 PPQ

    def __post_init__(self):
        self.channel &= 0x0F
        self.pitch &= 0x7F
        self.velocity &= 0x7F

    def encode(self) -> bytes:
        """Encode to 8 bytes (little-endian)."""
        status = (int(self.event_type) << 4) | (self.channel & 0x0F)
        return struct.pack(
            "<BBBB I",
            status,
            self.pitch & 0x7F,
            self.velocity & 0x7F,
            self.error_mask & 0xFF,
            self.tick & 0xFFFFFFFF,
        )

    @classmethod
    def decode(cls, data: bytes) -> Optional["SwmidiEvent"]:
        """Decode 8 bytes. Returns None if invalid."""
        if len(data) < PACKED_SIZE:
            return None
        status, pitch, velocity, error_mask, tick = struct.unpack_from(
            "<BBBB I", data
        )
        type_nibble = (status >> 4) & 0x0F
        try:
            event_type = EventType(type_nibble)
        except ValueError:
            return None
        channel = status & 0x0F
        return cls(
            event_type=event_type,
            channel=channel,
            pitch=pitch & 0x7F,
            velocity=velocity & 0x7F,
            error_mask=error_mask,
            tick=tick,
        )

    def is_flow(self) -> bool:
        return self.error_mask == 0

    def has_friction(self) -> bool:
        return self.error_mask != 0


# ══════════════════════════════════════════════════════════════════════
# SENTIMENT ANALYSIS
# ══════════════════════════════════════════════════════════════════════
#
# What Python teaches: list comprehensions are the natural idiom.
# The GIL means we don't need locks for this — but we also can't
# parallelize it easily. The natural boundary is: batch a list of
# messages, analyze them all, return a list of sentiments.

_POSITIVE_WORDS = frozenset({
    "great", "awesome", "love", "perfect", "excellent", "wonderful",
    "yes", "good", "amazing", "fantastic", "beautiful", "brilliant",
    "nice", "cool", "happy", "glad", "thanks", "thank", "sweet",
    "win", "success", "proud",
})

_NEGATIVE_WORDS = frozenset({
    "bad", "error", "fail", "broken", "hate", "wrong", "no", "terrible",
    "awful", "crash", "bug", "issue", "stuck", "frustrated", "annoying",
    "slow", "dead", "lost", "miss", "angry", "sad",
})

_QUESTION_WORDS = frozenset({
    "what", "how", "why", "where", "when", "who", "which",
})

_CREATIVE_WORDS = frozenset({
    "imagine", "create", "build", "design", "compose", "paint", "draw",
    "write", "dream", "invent", "explore", "craft", "forge", "shape",
    "mold", "weave", "spark",
})


@dataclass
class Sentiment:
    """Result of analyzing a message's sentiment."""

    pitch: int
    friction: int
    velocity: int
    label: SentimentLabel
    positivity: int
    negativity: int
    question: int
    creativity: int


def analyze_sentiment(text: str) -> Sentiment:
    """
    Analyze the sentiment of a text string.

    Uses word-list matching. No ML, no API calls — just fast lexical
    analysis that maps to MIDI pitch/velocity/friction.

    The GIL means this function is inherently thread-safe, but also
    that it can't be parallelized across threads. The natural batch
    boundary is: call this in a loop over messages, then analyze the
    batch.
    """
    lower = text.lower()
    words = set(lower.split())
    # Also check for substrings (handles punctuation)
    for w in list(words):
        if len(w) > 2:
            words.update(_extract_subwords(lower, w))

    positivity = sum(1 for w in _POSITIVE_WORDS if w in lower)
    negativity = sum(1 for w in _NEGATIVE_WORDS if w in lower)
    question = sum(1 for w in _QUESTION_WORDS if w in lower) + (1 if "?" in lower else 0)
    creativity = sum(1 for w in _CREATIVE_WORDS if w in lower)

    # Pitch mapping
    pitch = 60
    pitch += creativity * 8
    pitch += positivity * 5
    pitch -= negativity * 10
    if question > 0:
        pitch = 72 + question * 3
    pitch = max(0, min(127, pitch))

    # Friction
    friction = Friction.NONE
    if negativity > 0:
        friction |= Friction.AMBIGUITY
    if "error" in lower or "fail" in lower or "crash" in lower:
        friction |= Friction.SYNTAX_ERROR

    # Velocity from text length
    text_len = min(len(text), 500)
    velocity = max(1, min(127, round((text_len / 500.0) * 127)))

    # Label
    if negativity > positivity:
        label = SentimentLabel.TENSE
    elif creativity > 0:
        label = SentimentLabel.CREATIVE
    elif question > 0:
        label = SentimentLabel.INQUIRING
    elif positivity > 0:
        label = SentimentLabel.BRIGHT
    else:
        label = SentimentLabel.NEUTRAL

    return Sentiment(
        pitch=pitch,
        friction=friction,
        velocity=velocity,
        label=label,
        positivity=positivity,
        negativity=negativity,
        question=question,
        creativity=creativity,
    )


def _extract_subwords(lower_text: str, word: str) -> set[str]:
    """Extract known sentiment words that appear as substrings."""
    result = set()
    for w in _POSITIVE_WORDS | _NEGATIVE_WORDS | _QUESTION_WORDS | _CREATIVE_WORDS:
        if w in lower_text:
            result.add(w)
    return result


def analyze_sentiment_batch(texts: list[str]) -> list[Sentiment]:
    """
    Batch sentiment analysis — the natural Python boundary.

    What the GIL teaches: instead of trying to lock individual words,
    we process an entire batch of messages in one function call.
    This is the unit of work that gets handed off to other processes
    via multiprocessing.Pool if needed.
    """
    return [analyze_sentiment(t) for t in texts]


# ══════════════════════════════════════════════════════════════════════
# PULSE POSITION
# ══════════════════════════════════════════════════════════════════════


@dataclass
class PulsePosition:
    bar: int
    pulse: int  # 0-11
    sub_tick: int  # 0-47


def tick_to_pulse(tick: int) -> PulsePosition:
    bar = tick // TICKS_PER_BAR
    within = tick % TICKS_PER_BAR
    return PulsePosition(
        bar=bar,
        pulse=within // TICKS_PER_PULSE,
        sub_tick=within % TICKS_PER_PULSE,
    )


def pulse_to_tick(pos: PulsePosition) -> int:
    return pos.bar * TICKS_PER_BAR + pos.pulse * TICKS_PER_PULSE + pos.sub_tick


# ══════════════════════════════════════════════════════════════════════
# JAZZ ANALYSIS
# ══════════════════════════════════════════════════════════════════════


@dataclass
class JazzAnalysis:
    mode: JazzMode
    tension: float
    energy: float
    complexity: float
    avg_pitch: float
    flow_ratio: float
    friction_ratio: float
    event_count: int
    participant_count: int = 0
    description: str = ""


def analyze_jazz(sentiments: list[Sentiment], participant_count: int = 1) -> JazzAnalysis:
    """
    Analyze a batch of sentiments for jazz dynamics.

    Returns tension (0-1), energy (0-1), complexity (0-1), and mode.
    """
    n = len(sentiments)
    if n == 0:
        return JazzAnalysis(
            mode=JazzMode.BALLAD,
            tension=0.0,
            energy=0.0,
            complexity=0.0,
            avg_pitch=60.0,
            flow_ratio=1.0,
            friction_ratio=0.0,
            event_count=0,
            description="Silence. No messages to analyze.",
        )

    tense_count = sum(1 for s in sentiments if s.label == SentimentLabel.TENSE)
    creative_count = sum(1 for s in sentiments if s.label == SentimentLabel.CREATIVE)
    friction_events = sum(1 for s in sentiments if s.friction != 0)
    flow_events = n - friction_events
    total_pitch = sum(s.pitch for s in sentiments)
    total_velocity = sum(s.velocity for s in sentiments)
    unique_pitches = len({s.pitch for s in sentiments})

    tension = tense_count / n
    energy = (total_velocity / n) / 127.0
    complexity = (unique_pitches / 12.0) * min(n / 20.0, 1.0)
    flow_ratio = flow_events / n
    friction_ratio = friction_events / n
    avg_pitch = total_pitch / n

    # Mode detection
    if tension > 0.5:
        mode = JazzMode.TENSION
    elif creative_count > 0 and energy > 0.5:
        mode = JazzMode.BUILDING
    elif friction_ratio > 0.3:
        mode = JazzMode.FREE
    elif tension > 0.2:
        mode = JazzMode.RELEASE
    elif flow_ratio > 0.7 and n >= 5:
        mode = JazzMode.GROOVE
    elif n < 10 and energy < 0.4:
        mode = JazzMode.COMPING
    elif flow_ratio > 0.8:
        mode = JazzMode.BALLAD
    else:
        mode = JazzMode.GROOVE

    mode_names = {
        JazzMode.GROOVE: "in the pocket",
        JazzMode.BUILDING: "building energy",
        JazzMode.TENSION: "in the tension",
        JazzMode.RELEASE: "finding release",
        JazzMode.SOLO: "in solo flight",
        JazzMode.COMPING: "comping softly",
        JazzMode.FREE: "in free improvisation",
        JazzMode.BALLAD: "in ballad territory",
    }

    description = (
        f"The ensemble is {mode_names[mode]}. "
        f"Tension: {tension * 100:.0f}%. Energy: {energy * 100:.0f}%."
    )

    return JazzAnalysis(
        mode=mode,
        tension=tension,
        energy=energy,
        complexity=complexity,
        avg_pitch=avg_pitch,
        flow_ratio=flow_ratio,
        friction_ratio=friction_ratio,
        event_count=n,
        participant_count=participant_count,
        description=description,
    )


# ══════════════════════════════════════════════════════════════════════
# TEMPO DETECTION
# ══════════════════════════════════════════════════════════════════════


def detect_tempo(timestamps_ms: list[int]) -> float:
    """Detect BPM from message timestamps (median interval mapping)."""
    if len(timestamps_ms) < 2:
        return 120.0

    sorted_ts = sorted(timestamps_ms)
    intervals = [
        sorted_ts[i] - sorted_ts[i - 1]
        for i in range(1, len(sorted_ts))
        if sorted_ts[i] > sorted_ts[i - 1]
    ]

    if not intervals:
        return 120.0

    intervals.sort()
    median = intervals[len(intervals) // 2]

    if median < 100:
        return 240.0
    elif median < 250:
        return 180.0
    elif median < 500:
        return 140.0
    elif median < 1000:
        return 120.0
    elif median < 2000:
        return 90.0
    elif median < 5000:
        return 60.0
    else:
        return 40.0


# ══════════════════════════════════════════════════════════════════════
# CAPTURE
# ══════════════════════════════════════════════════════════════════════


@dataclass
class Message:
    text: str
    sender: str
    timestamp_ms: int


@dataclass
class CapturedMessage:
    text: str
    sender: str
    timestamp_ms: int
    sentiment: Sentiment
    channel: int
    tick: int


class Capture:
    """
    Conversation capture system — listens to conversation and produces
    SWMIDI events.

    This is the "microphone" of the jazz ensemble.

    Usage:
        cap = Capture()
        sentiment, event = cap.capture(Message("Hello!", "human", 1000))
        binary = cap.encode_binary()
    """

    def __init__(self, ring_capacity: int = 1024):
        self._events: list[SwmidiEvent] = []
        self._ring_capacity = ring_capacity
        self._participants: dict[str, int] = {}
        self._next_channel = 5
        self._tick = 0
        self._messages: list[CapturedMessage] = []

    def register(self, name: str) -> int:
        """Register a participant and assign a channel."""
        if name in self._participants:
            return self._participants[name]

        predefined = {
            "human": Channel.HUMAN,
            "assistant": Channel.ASSISTANT,
            "system": Channel.SYSTEM,
            "tool": Channel.TOOL,
        }

        if name in predefined:
            ch = predefined[name]
        else:
            ch = min(14, self._next_channel)
            self._next_channel = min(self._next_channel + 1, 15)

        self._participants[name] = ch
        return ch

    def capture(self, msg: Message) -> tuple[Sentiment, SwmidiEvent]:
        """Capture a single message."""
        channel = self.register(msg.sender)
        sentiment = analyze_sentiment(msg.text)

        tick = self._tick
        self._tick += TICKS_PER_PULSE

        event = SwmidiEvent(
            event_type=EventType.NOTE_ON,
            channel=channel,
            pitch=sentiment.pitch,
            velocity=sentiment.velocity,
            error_mask=sentiment.friction,
            tick=tick,
        )

        self._events.append(event)
        # Maintain ring buffer semantics (drop oldest)
        if len(self._events) > self._ring_capacity:
            self._events.pop(0)

        self._messages.append(
            CapturedMessage(
                text=msg.text,
                sender=msg.sender,
                timestamp_ms=msg.timestamp_ms,
                sentiment=sentiment,
                channel=channel,
                tick=tick,
            )
        )

        return sentiment, event

    def capture_batch(self, messages: list[Message]) -> list[tuple[Sentiment, SwmidiEvent]]:
        """
        Capture a batch of messages at once.

        What Python teaches: batching is the natural unit. The GIL
        means we might as well process the whole list in one call,
        rather than acquiring/releasing per message.
        """
        return [self.capture(msg) for msg in messages]

    @property
    def events(self) -> list[SwmidiEvent]:
        return self._events

    @property
    def messages(self) -> list[CapturedMessage]:
        return self._messages

    def encode_binary(self) -> bytes:
        """Encode all events to SWMIDI binary."""
        return b"".join(e.encode() for e in self._events)

    def jazz_analysis(self) -> JazzAnalysis:
        """Analyze the captured conversation."""
        return analyze_jazz(
            [m.sentiment for m in self._messages],
            participant_count=len(self._participants),
        )

    def clear(self):
        """Clear all captured data."""
        self._events.clear()
        self._messages.clear()
        self._participants.clear()
        self._next_channel = 5
        self._tick = 0


# ══════════════════════════════════════════════════════════════════════
# TESTS
# ══════════════════════════════════════════════════════════════════════


def _run_tests() -> int:
    import sys

    tests_run = 0
    tests_passed = 0

    def check(name: str, condition: bool):
        nonlocal tests_run, tests_passed
        tests_run += 1
        status = "PASS" if condition else "FAIL"
        if condition:
            tests_passed += 1
        print(f"  test {name:<40s} {status}")

    print("╔═══════════════════════════════════════════════════════════╗")
    print("║     TENSOR-MIDI PYTHON — RUNNING TESTS                   ║")
    print("╚═══════════════════════════════════════════════════════════╝")
    print()

    # SWMIDI encode/decode
    ev = SwmidiEvent(EventType.NOTE_ON, 3, 60, 100, 0, 192)
    encoded = ev.encode()
    decoded = SwmidiEvent.decode(encoded)
    check("encode_decode_roundtrip", decoded is not None and decoded == ev)

    # Decode invalid
    invalid = SwmidiEvent.decode(bytes([0x50, 0, 0, 0, 0, 0, 0, 0]))
    check("decode_invalid_type", invalid is None)

    # Little-endian tick
    ev2 = SwmidiEvent(EventType.META, 0, 0, 0, 0, 0x01020304)
    enc2 = ev2.encode()
    check("tick_little_endian", enc2[4:8] == bytes([0x04, 0x03, 0x02, 0x01]))

    # Sentiment
    s = analyze_sentiment("This is great and wonderful!")
    check("sentiment_positive", s.positivity >= 2 and s.label == SentimentLabel.BRIGHT)

    s = analyze_sentiment("This is terrible and broken")
    check("sentiment_negative", s.negativity >= 2 and s.label == SentimentLabel.TENSE)
    check("sentiment_friction", bool(s.friction & Friction.AMBIGUITY))

    s = analyze_sentiment("Let's build and design something")
    check("sentiment_creative", s.creativity >= 2 and s.label == SentimentLabel.CREATIVE)

    s = analyze_sentiment("What is this? How does it work?")
    check("sentiment_question", s.question >= 2 and s.label == SentimentLabel.INQUIRING)

    s = analyze_sentiment("The build failed with an error")
    check("sentiment_error_friction", bool(s.friction & Friction.SYNTAX_ERROR))

    # Pulse position
    pos = tick_to_pulse(0)
    check("pulse_bar_zero", pos.bar == 0 and pos.pulse == 0)

    pos = tick_to_pulse(TICKS_PER_BAR)
    check("pulse_bar_one", pos.bar == 1 and pos.pulse == 0)

    tick = 1234
    check("pulse_round_trip", pulse_to_tick(tick_to_pulse(tick)) == tick)

    # Jazz analysis
    ja = analyze_jazz([])
    check("jazz_empty", ja.mode == JazzMode.BALLAD and ja.event_count == 0)

    positive = [analyze_sentiment(f"Great job on build {i}!") for i in range(5)]
    ja = analyze_jazz(positive)
    check("jazz_positive", ja.tension < 0.3 and ja.flow_ratio > 0.5)

    tense = [analyze_sentiment(f"Error: build {i} failed badly") for i in range(5)]
    ja = analyze_jazz(tense)
    check("jazz_tense", ja.tension > 0.5 and ja.friction_ratio > 0.3)

    # Capture
    cap = Capture()
    sent, event = cap.capture(Message("Hello world", "human", 1000))
    check("capture_basic", event.channel == Channel.HUMAN and len(cap.messages) == 1)

    cap2 = Capture()
    for i in range(3):
        cap2.capture(Message(f"Great build {i}!", "human", i * 1000))
        cap2.capture(Message(f"Thanks! Building now", "assistant", i * 1000 + 500))
    check("capture_multiple", len(cap2.messages) == 6 and len(cap2.events) == 6)

    # Encode binary
    cap3 = Capture()
    cap3.capture(Message("Test", "human", 0))
    binary = cap3.encode_binary()
    check("encode_binary_size", len(binary) == PACKED_SIZE)
    decoded_event = SwmidiEvent.decode(binary)
    check("encode_binary_decode", decoded_event is not None)

    # Tempo detection
    check("tempo_default", detect_tempo([]) == 120.0)
    check("tempo_fast", detect_tempo([0, 100, 200, 300, 400]) > 120.0)
    check("tempo_slow", detect_tempo([0, 5000, 10000, 15000]) < 100.0)

    # Constants
    check("constants", PPQ == 96 and PULSES_PER_BAR == 12 and TICKS_PER_BAR == 576)

    # Batch sentiment
    texts = ["Great!", "Oh no, error", "What?", "Build it"]
    results = analyze_sentiment_batch(texts)
    check("batch_sentiment", len(results) == 4)

    print()
    print(f"{tests_passed}/{tests_run} tests passed.")
    return 0 if tests_passed == tests_run else 1


if __name__ == "__main__":
    import sys

    sys.exit(_run_tests())
