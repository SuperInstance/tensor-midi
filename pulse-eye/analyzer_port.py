"""Faithful Python port of the tensor-midi heritage jazz analyzer.

SOURCE OF RECORD (read-only, heritage code):
  /home/eileen/projects/tensor-midi/src/analyzer.js   — JazzAnalyzer,
      JazzMode, ChordQuality, detectConvergence, description engine
  /home/eileen/projects/tensor-midi/src/engine.js     — PulseGrid,
      tickToPosition, TICKS_PER_BAR / TICKS_PER_PULSE / PULSES_PER_BAR
  /home/eileen/projects/tensor-midi/src/swmidi.js     — Friction bitfield,
      hasFriction / isFlow

Ported for THE PULSE EYE experiment (2026-08-25): fuse this 2026-08-08
conversation-pulse reader with the plainsong growth stack, and test whether
its convergence detector predicts pocket-lock / coalescence.

Fidelity notes (JS -> Python):
  * Every threshold, formula, and branch order is preserved verbatim.
    analyze_bar() computes energy/complexity/tension exactly as analyzeBar().
  * `Math.round` JS semantics: round-half-UP (Math.round(0.5)=1). Python's
    round() is banker's rounding, so _js_round() replicates JS behavior.
  * detectConvergence groups events into bars by tick // 576 (12/8 bar),
    strong = >=3 distinct channels in a bar, weak = exactly 2. Preserved.
  * The heritage system consumed SWMIDI *conversation* events; this port
    keeps the same shape (channel, pitch, velocity, errorMask, tick).

Run `python3 analyzer_port.py` to execute the ported unit checks
(mirroring tests/analyzer.test.js assertions).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# ── engine.js constants ──────────────────────────────────────────────

PPQ = 96
PULSES_PER_BAR = 12
TICKS_PER_PULSE = PPQ // 2          # 48
TICKS_PER_BAR = PULSES_PER_BAR * TICKS_PER_PULSE  # 576
DEFAULT_US_PER_QUARTER = 500_000


def tick_to_position(tick: int) -> tuple[int, int, int]:
    """Port of engine.js tickToPosition."""
    bar = tick // TICKS_PER_BAR
    within_bar = tick % TICKS_PER_BAR
    pulse = within_bar // TICKS_PER_PULSE
    sub_tick = within_bar % TICKS_PER_PULSE
    return bar, pulse, sub_tick


class PulseGrid:
    """Port of engine.js PulseGrid — the 12-pulse circle."""

    def __init__(self) -> None:
        self.bars: dict[int, list[list[dict]]] = {}

    def add_event(self, event: dict) -> None:
        bar, pulse, _ = tick_to_position(int(event["tick"]))
        if bar not in self.bars:
            self.bars[bar] = [[] for _ in range(PULSES_PER_BAR)]
        self.bars[bar][pulse].append(event)

    def get_pulse(self, bar: int, pulse: int) -> list[dict]:
        bar_data = self.bars.get(bar)
        if not bar_data:
            return []
        return bar_data[pulse]

    def get_bar_pattern(self, bar: int) -> list[bool]:
        bar_data = self.bars.get(bar)
        if bar_data is None:
            return [False] * PULSES_PER_BAR
        return [len(pulse) > 0 for pulse in bar_data]

    def get_bar_density(self, bar: int) -> float:
        """filled pulses / 12 — port of engine.js getBarDensity."""
        pattern = self.get_bar_pattern(bar)
        return sum(1 for p in pattern if p) / PULSES_PER_BAR

    @property
    def active_bars(self) -> list[int]:
        return sorted(self.bars.keys())

    @property
    def total_events(self) -> int:
        return sum(len(pulse) for bar in self.bars.values() for pulse in bar)


# ── swmidi.js friction bitfield ──────────────────────────────────────

class Friction:
    None_ = 0x00
    Timeout = 0x01
    Conflict = 0x02
    RateLimit = 0x04
    Ambiguity = 0x08
    ImportError = 0x10
    SyntaxError = 0x20
    TypeMismatch = 0x40
    NetworkError = 0x80


def has_friction(event: dict) -> bool:
    return bool(event.get("errorMask", 0) & 0xFF)


def is_flow(event: dict) -> bool:
    return not has_friction(event)


# ── analyzer.js enums ────────────────────────────────────────────────

class JazzMode:
    Groove = "groove"        # everyone's in the pocket
    Building = "building"    # energy rising, creating
    Tension = "tension"      # conflict, friction
    Release = "release"      # tension resolving
    Solo = "solo"            # one voice dominating
    Comping = "comping"      # supporting each other
    Free = "free"            # open, exploratory
    Ballad = "ballad"        # slow, contemplative


class ChordQuality:
    Major7 = "major7"
    Minor7 = "minor7"
    Dominant7 = "dom7"
    Diminished = "dim"
    Augmented = "aug"
    Sus4 = "sus4"


# ── analyzer.js JazzAnalyzer ─────────────────────────────────────────

def _js_round(x: float) -> int:
    """JavaScript Math.round: half away from zero (for the positives here)."""
    return int(math.floor(x + 0.5))


@dataclass
class JazzAnalyzer:
    """Port of src/analyzer.js class JazzAnalyzer — bar-by-bar pulse reader."""

    history: list[dict] = field(default_factory=list)
    currentMode: str = JazzMode.Groove
    currentChord: str = ChordQuality.Major7
    tensionLevel: int = 0
    energyLevel: int = 50
    complexityLevel: int = 0

    def analyze_bar(self, events: list[dict], pulse_grid: PulseGrid, bar_number: int) -> dict:
        flow_count = sum(1 for e in events if is_flow(e))
        friction_count = sum(1 for e in events if has_friction(e))
        total = len(events)

        channel_counts: dict[int, int] = {}
        for e in events:
            channel_counts[e["channel"]] = channel_counts.get(e["channel"], 0) + 1

        channels = len(channel_counts)
        max_channel = max(channel_counts.items(), key=lambda kv: kv[1]) if channel_counts else None

        density = pulse_grid.get_bar_density(bar_number)

        pitches = [e["pitch"] for e in events]
        pitch_range = (max(pitches) - min(pitches)) if pitches else 0
        avg_pitch = (sum(pitches) / len(pitches)) if pitches else 60

        friction_ratio = (friction_count / total) if total > 0 else 0
        self.tensionLevel = _js_round(friction_ratio * 100)
        self.energyLevel = _js_round(density * 70 + (pitch_range / 127) * 30)
        self.complexityLevel = _js_round((channels / 8) * 50 + (pitch_range / 127) * 50)

        self.currentMode = self._determine_mode(total, channels, friction_ratio, density, max_channel)
        self.currentChord = self._determine_chord(avg_pitch, friction_ratio, density)

        self.history.append({
            "bar": bar_number,
            "mode": self.currentMode,
            "chord": self.currentChord,
            "tension": self.tensionLevel,
            "energy": self.energyLevel,
            "complexity": self.complexityLevel,
            "channels": channels,
            "density": density,
        })

        return {
            "mode": self.currentMode,
            "chord": self.currentChord,
            "tension": self.tensionLevel,
            "energy": self.energyLevel,
            "complexity": self.complexityLevel,
            "dominantChannel": max_channel[0] if max_channel else None,
            "density": density,
            "pitchRange": pitch_range,
            "avgPitch": avg_pitch,
            "total": total,
            "flowCount": flow_count,
            "frictionCount": friction_count,
        }

    def _determine_mode(self, total, channels, friction_ratio, density, max_channel):
        # branch order preserved exactly from analyzer.js _determineMode
        if friction_ratio > 0.4:
            return JazzMode.Tension
        if total == 0:
            return JazzMode.Ballad
        if max_channel is not None and total > 0:
            dominance = max_channel[1] / total
            if dominance > 0.6 and channels > 1:
                return JazzMode.Solo
        if channels >= 3 and density > 0.5:
            return JazzMode.Building
        if channels >= 3 and friction_ratio < 0.1:
            return JazzMode.Comping
        if density < 0.2:
            return JazzMode.Free
        if density < 0.4:
            return JazzMode.Ballad
        return JazzMode.Groove

    def _determine_chord(self, avg_pitch, friction_ratio, density):
        # branch order preserved exactly from analyzer.js _determineChord
        if friction_ratio > 0.3:
            return ChordQuality.Dominant7
        if friction_ratio > 0.1:
            return ChordQuality.Minor7
        if density < 0.2:
            return ChordQuality.Augmented
        if avg_pitch > 80:
            return ChordQuality.Major7
        if avg_pitch < 50:
            return ChordQuality.Minor7
        return ChordQuality.Major7

    @property
    def description(self) -> str:
        mode_desc = {
            JazzMode.Groove: "The ensemble is in the pocket",
            JazzMode.Building: "Energy is building, voices layering",
            JazzMode.Tension: "There's tension in the room",
            JazzMode.Release: "Tension releasing, settling back",
            JazzMode.Solo: "One voice is soloing",
            JazzMode.Comping: "Everyone's comping for each other",
            JazzMode.Free: "Open, free, exploratory",
            JazzMode.Ballad: "Slow, contemplative, a ballad",
        }
        chord_desc = {
            ChordQuality.Major7: "warm major 7ths",
            ChordQuality.Minor7: "cool minor 7ths",
            ChordQuality.Dominant7: "tense dominant 7ths",
            ChordQuality.Diminished: "dark diminished colors",
            ChordQuality.Augmented: "floating augmented sound",
            ChordQuality.Sus4: "suspended, waiting to resolve",
        }
        return (f"{mode_desc[self.currentMode]}. The harmony lives in "
                f"{chord_desc[self.currentChord]}. Tension: {self.tensionLevel}%. "
                f"Energy: {self.energyLevel}%. Complexity: {self.complexityLevel}%.")

    def detect_convergence(self, events: list[dict]) -> list[dict]:
        """Port of analyzer.js detectConvergence — the coalescence detector.

        Groups events by 12/8 bar; a bar with >=3 distinct channels is a
        'strong' convergence, exactly 2 channels is 'weak'.
        """
        by_bar: dict[int, set] = {}
        for e in events:
            bar = int(e["tick"]) // TICKS_PER_BAR
            by_bar.setdefault(bar, set()).add(e["channel"])

        convergences = []
        for bar in sorted(by_bar):
            n = len(by_bar[bar])
            if n >= 3:
                convergences.append({"bar": bar, "channels": n, "type": "strong"})
            elif n == 2:
                convergences.append({"bar": bar, "channels": n, "type": "weak"})
        return convergences

    def get_report(self) -> dict:
        recent = self.history[-32:]
        mode_changes = sum(
            1 for i in range(1, len(recent))
            if recent[i]["mode"] != recent[i - 1]["mode"]
        )
        avg_tension = _js_round(sum(h["tension"] for h in recent) / len(recent)) if recent else 0
        avg_energy = _js_round(sum(h["energy"] for h in recent) / len(recent)) if recent else 0
        return {
            "currentMode": self.currentMode,
            "currentChord": self.currentChord,
            "description": self.description,
            "tension": self.tensionLevel,
            "energy": self.energyLevel,
            "complexity": self.complexityLevel,
            "avgTension": avg_tension,
            "avgEnergy": avg_energy,
            "modeChanges": mode_changes,
            "history": recent,
        }


# ── ported unit checks (mirrors tests/analyzer.test.js) ─────────────

def _selftest() -> None:
    assert JazzMode.Groove == "groove"
    assert len({JazzMode.__dict__[k] for k in
                ["Groove", "Building", "Tension", "Release", "Solo", "Comping", "Free", "Ballad"]}) == 8

    ja = JazzAnalyzer()
    assert ja.currentMode == JazzMode.Groove
    assert ja.currentChord == ChordQuality.Major7
    assert ja.tensionLevel == 0
    assert ja.energyLevel == 50
    assert ja.complexityLevel == 0
    assert len(ja.history) == 0

    # empty bar -> Ballad
    ja = JazzAnalyzer()
    pg = PulseGrid()
    assert ja.analyze_bar([], pg, 0)["mode"] == JazzMode.Ballad

    # high friction -> Tension
    ja = JazzAnalyzer()
    events = [
        {"channel": 0, "pitch": 60, "velocity": 80, "errorMask": Friction.Timeout, "tick": 0},
        {"channel": 0, "pitch": 62, "velocity": 80, "errorMask": Friction.Conflict, "tick": 48},
        {"channel": 0, "pitch": 64, "velocity": 80, "errorMask": Friction.None_, "tick": 96},
        {"channel": 0, "pitch": 65, "velocity": 80, "errorMask": Friction.RateLimit, "tick": 144},
        {"channel": 0, "pitch": 67, "velocity": 80, "errorMask": Friction.None_, "tick": 192},
    ]
    r = ja.analyze_bar(events, pg, 0)
    assert r["mode"] == JazzMode.Tension and r["tension"] > 40

    # single-channel dominance (>60%, channels>1) -> Solo
    ja = JazzAnalyzer()
    pg = PulseGrid()
    evs = ([{"channel": 0, "pitch": 60, "velocity": 80, "errorMask": 0, "tick": t * 48}
            for t in range(5)] +
           [{"channel": 1, "pitch": 64, "velocity": 80, "errorMask": 0, "tick": 240}])
    for e in evs:
        pg.add_event(e)
    assert ja.analyze_bar(evs, pg, 0)["mode"] == JazzMode.Solo

    # JS rounding check: Math.round(0.5) === 1
    assert _js_round(0.5) == 1 and _js_round(1.5) == 2 and _js_round(2.5) == 3

    # convergence: 3 channels in bar 0 -> strong
    conv = JazzAnalyzer().detect_convergence([
        {"channel": 0, "tick": 0, "pitch": 60, "velocity": 80, "errorMask": 0},
        {"channel": 1, "tick": 48, "pitch": 64, "velocity": 80, "errorMask": 0},
        {"channel": 2, "tick": 96, "pitch": 67, "velocity": 80, "errorMask": 0},
        {"channel": 0, "tick": 576, "pitch": 60, "velocity": 80, "errorMask": 0},  # bar 1
        {"channel": 1, "tick": 624, "pitch": 64, "velocity": 80, "errorMask": 0},  # bar 1
    ])
    assert conv[0] == {"bar": 0, "channels": 3, "type": "strong"}
    assert conv[1]["type"] == "weak"

    print("analyzer_port: all ported unit checks passed "
          "(mirrors tests/analyzer.test.js)")


if __name__ == "__main__":
    _selftest()
