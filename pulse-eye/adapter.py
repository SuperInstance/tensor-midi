"""PULSE EYE — the fusion adapter.

plainsong (.song) ──compile──> .mid artifact ──parse──> pulse events
     │                                              │
     │ (in-process arrangement)                     ▼
     ▼                                    heritage jazz analyzer
modern perception layer                 (analyzer_port.py, 2026-08-08)
(analyze_features 16-vector,
 annotation_stats)

THE PULSE MAP (the one new idea, everything else is heritage):
A plainsong 4/4 bar (any subdivision — the bar divides itself) is mapped
onto ONE 12-pulse tensor-midi bar, preserving relative position exactly:

    pulse = floor((tick % bar_ticks) / bar_ticks * 12)
    tensor_tick = bar * 576 + pulse * 48

A 4/4 quarter-note onset (slot 0/2/4/6 of 8) lands on pulses 0/3/6/9 —
the four dotted-quarters of 12/8. Co-presence, density, and channel
geometry are preserved; nothing is invented.

FRICTION, honestly: the heritage errorMask bitfield carries conversation
errors (timeouts, conflicts). Compiled notation from a clean plainsong
session has none — errorMask = 0 for every event. The analyzer's tension
ear is therefore INERT on music-only input by construction (see REPORT).
Session-level friction (the failed Lyrics-chair write, the numpy venv
fix) lives in ensemble log.jsonl, not on the note wire, and is not
ingested here.
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from analyzer_port import (  # noqa: E402
    JazzAnalyzer, PulseGrid, TICKS_PER_BAR, TICKS_PER_PULSE, PULSES_PER_BAR,
)

PLAINSONG_PYTHON = sys.executable          # zero-dependency: repo import works
PLAINSONG_REPO = "/home/eileen/projects/plainsong"   # branch dynamics-and-swing


def song_to_events(song_path: str, mid_path: str | None = None) -> dict:
    """Compile a .song to a real .mid artifact, parse it back, and map
    every note-on into the tensor-midi 12-pulse tick domain."""
    mid_path = mid_path or (os.path.splitext(song_path)[0] + ".mid")
    code = (
        "from plainsong.pipeline import compile_file;"
        f"compile_file({song_path!r}, midi={mid_path!r})"
    )
    import subprocess
    env = dict(os.environ, PYTHONPATH=PLAINSONG_REPO)
    out = subprocess.run([PLAINSONG_PYTHON, "-c", code], capture_output=True, text=True, env=env)
    if out.returncode:
        raise RuntimeError(f"plainsong compile failed for {song_path}:\n{out.stderr[-800:]}")

    from smf import parse_smf
    smf = parse_smf(mid_path)
    ppq = smf["ppq"]
    num, den = smf["timesig"]
    # ticks per plainsong bar (assume quarter = ppq; denominator 4 => 4*ppq)
    bar_ticks = num * ppq * (4 // den) if den <= 4 else num * ppq

    events = []
    for n in smf["notes"]:
        bar = n["tick"] // bar_ticks
        within = (n["tick"] % bar_ticks) / bar_ticks
        pulse = int(within * PULSES_PER_BAR)
        events.append({
            "channel": n["channel"],
            "pitch": n["pitch"],
            "velocity": n["velocity"],
            "errorMask": 0,          # clean notation -> no friction (see module doc)
            "tick": bar * TICKS_PER_BAR + pulse * TICKS_PER_PULSE,
            "_bar": bar,
            "_pulse": pulse,
        })
    return {"events": events, "mid_path": mid_path, "n_notes": len(events),
            "n_bars": (max((e["tick"] for e in events), default=0) // TICKS_PER_BAR) + 1,
            "ppq": ppq, "bar_ticks": bar_ticks}


def run_eye(events: list[dict], n_bars: int) -> dict:
    """Feed the heritage analyzer bar by bar (as the mixer did)."""
    grid = PulseGrid()
    for e in events:
        grid.add_event(e)

    analyzer = JazzAnalyzer()
    per_bar = []
    for bar in range(n_bars):
        bar_events = [e for e in events if e["tick"] // TICKS_PER_BAR == bar]
        reading = analyzer.analyze_bar(bar_events, grid, bar)
        per_bar.append(reading)

    convergences = analyzer.detect_convergence(events)
    strong = [c for c in convergences if c["type"] == "strong"]
    weak = [c for c in convergences if c["type"] == "weak"]

    # ONE diagnostic extension (clearly labeled, NOT heritage): pulse-level
    # coalescence — fraction of active bars where >=2 channels strike the
    # SAME pulse together (attack alignment), and mean distinct-channel
    # occupancy per pulse. Heritage detectConvergence only counts whether
    # channels co-occur somewhere in a bar; it cannot see simultaneity.
    by_bar_pulse: dict[tuple[int, int], set] = {}
    for e in events:
        by_bar_pulse.setdefault((e["_bar"], e["_pulse"]), set()).add(e["channel"])
    active_bars = sorted({b for (b, _) in by_bar_pulse})
    shared_bars = sum(
        1 for b in active_bars
        if any(len(chs) >= 2 for (bb, _), chs in by_bar_pulse.items() if bb == b)
    )
    shared_pulses = sum(1 for chs in by_bar_pulse.values() if len(chs) >= 2)
    coalescence = {
        "extension": "pulse-alignment coalescence (NOT heritage analyzer.js)",
        "shared_pulse_fraction_of_active_bars": (
            shared_bars / len(active_bars)) if active_bars else 0.0,
        "shared_pulse_count": shared_pulses,
        "mean_channels_per_filled_pulse": (
            sum(len(c) for c in by_bar_pulse.values()) / len(by_bar_pulse))
        if by_bar_pulse else 0.0,
    }

    mode_hist: dict[str, int] = {}
    for r in per_bar:
        mode_hist[r["mode"]] = mode_hist.get(r["mode"], 0) + 1

    return {
        "per_bar": per_bar,
        "report": analyzer.get_report(),
        "convergence": {
            "strong_bars": len(strong),
            "weak_bars": len(weak),
            "strong_bar_numbers": [c["bar"] for c in strong],
            "strong_fraction": len(strong) / n_bars if n_bars else 0.0,
            "detail": convergences,
        },
        "coalescence_ext": coalescence,
        "mode_histogram": mode_hist,
        "mode_majority": max(mode_hist, key=mode_hist.get) if mode_hist else None,
        "avg_energy": sum(r["energy"] for r in per_bar) / len(per_bar) if per_bar else 0,
        "avg_tension": sum(r["tension"] for r in per_bar) / len(per_bar) if per_bar else 0,
        "avg_complexity": sum(r["complexity"] for r in per_bar) / len(per_bar) if per_bar else 0,
    }


def modern_features(song_path: str) -> dict:
    """The 2026 perception layer: analyze_features 16-vector (per-bar + mean)
    and annotation_stats — same code the plainsong-mcp tools call, imported
    from the plainsong repo checkout (dynamics-and-swing: annotation_stats
    + per-note Vel:)."""
    code = r"""
import json, sys
from plainsong.pipeline import compile_file
from plainsong.features import extract, summarise, annotation_stats, FEATURE_NAMES
r = compile_file(sys.argv[1])
arr = r.arrangement
bars = extract(arr)
per_bar = [{"bar": b.bar, **{f: b.values[f] for f in FEATURE_NAMES}} for b in bars]
mean = summarise(bars)
anns = {}
for annotation in getattr(arr, "annotations", ()):
    anns[annotation.name] = annotation_stats(arr, annotation.name)
print(json.dumps({"per_bar": per_bar, "mean": mean, "annotations": anns}))
"""
    import subprocess
    env = dict(os.environ, PYTHONPATH=PLAINSONG_REPO)
    out = subprocess.run([PLAINSONG_PYTHON, "-c", code, song_path],
                         capture_output=True, text=True, env=env)
    if out.returncode:
        return {"error": out.stderr[-500:]}
    return json.loads(out.stdout)


def eye_full(song_path: str, tag: str, mid_dir: str | None = None) -> dict:
    """Old pulse reader and new perception layer, side by side."""
    mid_path = os.path.join(mid_dir, os.path.basename(os.path.splitext(song_path)[0]) + ".mid") \
        if mid_dir else None
    pipe = song_to_events(song_path, mid_path)
    eye = run_eye(pipe["events"], pipe["n_bars"])
    eye["modern"] = modern_features(song_path)
    eye["tag"] = tag
    eye["song"] = song_path
    eye["n_notes"] = pipe["n_notes"]
    return eye


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("song")
    p.add_argument("--tag", default="")
    p.add_argument("--mid-dir", default=None)
    a = p.parse_args()
    result = eye_full(a.song, a.tag or os.path.basename(a.song), a.mid_dir)
    slim = {k: v for k, v in result.items()
            if k not in ("per_bar", "convergence", "modern")}
    print(json.dumps(slim, indent=1))
    print("description:", result["report"]["description"])
