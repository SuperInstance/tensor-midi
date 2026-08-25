"""Run THE PULSE EYE retrospective experiment over the recorded sessions.

Protocol: the heritage analyzer reads each state BLIND (it never sees the
recorded verdicts); the comparison below runs afterwards, against ground
truth recorded in BUILD-JOURNAL.md / GATE1-REPORT.md / session logs.
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapter import eye_full  # noqa: E402

STATES = os.path.join(HERE, "states")
RESULTS = os.path.join(HERE, "results")
os.makedirs(os.path.join(RESULTS, "mid"), exist_ok=True)

# ── ground truth (recorded before this experiment ran) ───────────────

TAP_TRUTH = {
    "lock_at": "T3",
    "source": ("BUILD-JOURNAL.md: bass v8 'From where I stand the pocket is "
               "locked - piano can come in whenever ready' — after taking the "
               "drummer's bar-13 deal"),
}
VOCAL_TRUTH = {
    "fits": "A",
    "source": ("BUILD-JOURNAL.md: vocalist chose the smoke reading because "
               "'the room had already decided it... anything projected would "
               "have broken the floor the rhythm section spent the whole "
               "conversation laying'"),
}
DUKE_TRUTH = {
    "critic_pass2": ("critique 2 (register) RESOLVED; critique 1 (dynamics) "
                     "HALF-SURVIVES (velocity_std 0.109->0.113); critique 3 "
                     "survives bars 7 & 12 (syncopation 0.00); HONEST GAP: "
                     "not CONVERGED, best take = version 4 (R2)"),
    "r1_axis": {"treble_activity": 0.0, "velocity_std": 0.109},
}
GATE_CURVE = json.load(open(
    "/home/eileen/projects/plainsong-mcp/stitch/measurement.json"))["curve"]

# ── run the eye over everything ──────────────────────────────────────

RUNS = (
    [f"tap-T{n}" for n in range(1, 6)]
    + [f"vocal-V{t}-over-band" for t in "ABC"]
    + [f"vocal-V{t}-solo" for t in "ABC"]
    + ["duke-R1-recon", "duke-R2-final"]
    + [f"seam-stitch-{n:02d}" for n in range(1, 11)]
    + [f"seam-canon-{i:02d}" for i in range(1, 7)]
)

TAP_FILES = {
    "tap-T1": "tap-T1-bass-v1.song",
    "tap-T2": "tap-T2-drums-arrive.song",
    "tap-T3": "tap-T3-pocket-lock.song",
    "tap-T4": "tap-T4-piano-in.song",
    "tap-T5": "tap-T5-full.score.song",
}

readings = {}
for tag in RUNS:
    if tag in TAP_FILES:
        fname = TAP_FILES[tag]
    elif tag.startswith("seam-canon"):
        fname = next(f for f in os.listdir(STATES)
                     if f.startswith(tag))          # canon files carry names
    else:
        fname = f"{tag}.song"
    path = os.path.join(STATES, fname)
    print(f"eye -> {tag} ...", flush=True)
    readings[tag] = eye_full(path, tag, os.path.join(RESULTS, "mid"))
    json.dump(readings[tag], open(os.path.join(RESULTS, f"{tag}.json"), "w"),
              indent=1, default=str)

# ── helpers ──────────────────────────────────────────────────────────

def pearson(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            r[order[k]] = avg
        i = j + 1
    return r


def spearman(xs, ys):
    return pearson(ranks(xs), ranks(ys))


def row(tag):
    r = readings[tag]
    return {
        "tag": tag,
        "mode_majority": r["mode_majority"],
        "mode_hist": r["mode_histogram"],
        "strong_conv_frac": round(r["convergence"]["strong_fraction"], 3),
        "weak_conv_bars": r["convergence"]["weak_bars"],
        "shared_pulse_frac": round(
            r["coalescence_ext"]["shared_pulse_fraction_of_active_bars"], 3),
        "avg_energy": round(r["avg_energy"], 1),
        "avg_complexity": round(r["avg_complexity"], 1),
        "avg_tension": round(r["avg_tension"], 2),
        "chord_final": r["report"]["currentChord"],
        "description": r["report"]["description"],
    }

# ── (1) tap coalescence table ────────────────────────────────────────

tap = [row(f"tap-T{n}") for n in range(1, 6)]
print("\n=== TAP COALESCENCE (ground truth: pocket lock at T3) ===")
for t in tap:
    print(json.dumps(t, indent=None))

# ── (2) vocal readings ───────────────────────────────────────────────

print("\n=== VOCAL READINGS (ground truth: A fits the room) ===")
for t in "ABC":
    print(f"V{t} over band:", json.dumps(row(f"vocal-V{t}-over-band"), indent=None))
    print(f"V{t} solo     :", json.dumps(row(f"vocal-V{t}-solo"), indent=None))

# ── (3) duke R1 vs R2 ────────────────────────────────────────────────

print("\n=== DUKE (ground truth: R2 improved but NOT converged) ===")
for tag in ("duke-R1-recon", "duke-R2-final"):
    print(tag, json.dumps(row(tag), indent=None))
    mean = readings[tag]["modern"]["mean"]
    per_bar = readings[tag]["modern"]["per_bar"]
    print("   critic axes: treble_activity=%.3f velocity_std=%.3f "
          "sync_b7=%.2f sync_b12=%.2f"
          % (mean["treble_activity"], mean["velocity_std"],
             per_bar[6]["syncopation"], per_bar[11]["syncopation"]))

# ── (4) seamstress: correlation with the gate-1 curve ────────────────

print("\n=== SEAMSTRESS (gate curve:", GATE_CURVE, ") ===")
energy = [readings[f"seam-stitch-{n:02d}"]["avg_energy"] for n in range(1, 11)]
cxty = [readings[f"seam-stitch-{n:02d}"]["avg_complexity"] for n in range(1, 11)]
tension = [readings[f"seam-stitch-{n:02d}"]["avg_tension"] for n in range(1, 11)]
modes = [readings[f"seam-stitch-{n:02d}"]["mode_majority"] for n in range(1, 11)]
canon_modes = [readings[f"seam-canon-{i:02d}"]["mode_majority"] for i in range(1, 7)]
canon_energy = [readings[f"seam-canon-{i:02d}"]["avg_energy"] for i in range(1, 7)]

print("stitch energy :", [round(e, 1) for e in energy])
print("stitch cxty   :", [round(c, 1) for c in cxty])
print("stitch tension:", tension, "(all zero -> inert, correlation undefined)")
print("stitch modes  :", modes)
print("canon modes   :", canon_modes)
print("canon energy  :", [round(e, 1) for e in canon_energy])
print("pearson(energy, gate_distance) =", pearson(energy, GATE_CURVE))
print("spearman(energy, gate_distance) =", spearman(energy, GATE_CURVE))
print("pearson(cxty, gate_distance)   =", pearson(cxty, GATE_CURVE))
print("spearman(cxty, gate_distance)  =", spearman(cxty, GATE_CURVE))

# also: modern 16-feature sanity — does the eye's energy relate to
# note_density (the feature the gate steered hardest)?
nd = [readings[f"seam-stitch-{n:02d}"]["modern"]["mean"]["note_density"]
      for n in range(1, 11)]
print("note_density  :", [round(x, 3) for x in nd])
print("pearson(energy, note_density)  =", pearson(energy, nd))

json.dump({
    "tap": tap,
    "tap_truth": TAP_TRUTH,
    "vocal_truth": VOCAL_TRUTH,
    "duke_truth": DUKE_TRUTH,
    "correlations": {
        "gate_curve": GATE_CURVE,
        "energy": energy, "complexity": cxty, "tension": tension, "modes": modes,
        "pearson_energy_vs_distance": pearson(energy, GATE_CURVE),
        "spearman_energy_vs_distance": spearman(energy, GATE_CURVE),
        "pearson_complexity_vs_distance": pearson(cxty, GATE_CURVE),
        "spearman_complexity_vs_distance": spearman(cxty, GATE_CURVE),
        "pearson_energy_vs_note_density": pearson(energy, nd),
        "canon_modes": canon_modes, "canon_energy": canon_energy,
    },
}, open(os.path.join(RESULTS, "summary.json"), "w"), indent=1)

print("\nwrote", os.path.join(RESULTS, "summary.json"))
