"""Reconstruct the growth states of the recorded ensemble sessions from
disk artifacts + the recorded journals.

Honesty ledger (what is byte-exact vs reconstructed):
  * the-tap-afterhours bass v1: bar 13 of the final bass part is swapped
    back per BUILD-JOURNAL.md, which quotes BOTH lines verbatim:
      v8 (on disk): "a1 . c2 . e2 . - g2"   (the drummer's deal)
      v1 (journal): "a1 c2 e2 g2"           ("square on top of beat 4")
    "rest of the line untouched" — so this is byte-exact for the notation.
  * drums v5 (first write) was revised 29s later (v6, on disk); v5's exact
    cells are not recoverable, so both pre-lock and post-lock states use
    the final drums. The lock test compares bass-v1 vs bass-v2 UNDER THE
    SAME drummer, which is the right controlled comparison anyway.
  * duke-lab R1: NOT on disk (parts are overwrite-in-place, no git history
    for the session). Reconstructed from BUILD-JOURNAL.md's exact list of
    R2 changes, each undone (flat vel, named answer notes dropped one
    octave, named pickups replaced by rests to keep bar cell-counts).
    Labeled approximate; validated metrically against the critic's own
    recorded R1 numbers (see run_all).
  * seamstress takes 1-10: byte-exact on disk (stitch/runs/stitch-NN/).
  * vocal readings A/B/C: byte-exact on disk in the vocal-lab session.
"""

import os
import re

ENS = "/home/eileen/projects/plainsong-mcp/.plainsong/workspace/ensemble"
STITCH = "/home/eileen/projects/plainsong-mcp/stitch"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "states")
os.makedirs(OUT, exist_ok=True)


def read(p):
    return open(p).read()


def write(name, text):
    path = os.path.join(OUT, name)
    open(path, "w").write(text)
    return path


# ── the-tap-afterhours: coalescence states in log order ─────────────

tap_score = read(f"{ENS}/the-tap-afterhours/score.song")
lines = tap_score.splitlines()

HEADER = "\n".join(lines[:5]) + "\n"          # TRACK / MetaData / blank / [A]
BASS_V2 = [l for l in lines if l.startswith("@bass")]
DRUMS = [l for l in lines if l.startswith("@drums")]
PIANO = [l for l in lines if l.startswith("@piano")]
VOCAL = [l for l in lines if l.startswith("@vocal")]

# bass v1: second bass row, bar 13 cell swapped back (see module docstring)
bass_v1_rows = list(BASS_V2)
old_bar13 = "| a1 . c2 . e2 . - g2 |"          # v8, on disk
new_bar13 = "| a1 c2 e2 g2 |"                  # v1, quoted in BUILD-JOURNAL
assert old_bar13 in bass_v1_rows[1], "bar-13 v8 cell not found where expected"
bass_v1_rows[1] = bass_v1_rows[1].replace(old_bar13, new_bar13)

def song(*rows):
    return HEADER + "\n".join(rows) + "\n"

TAP_STATES = {
    # T1: bass alone names the tune (v3)
    "tap-T1-bass-v1": song(*bass_v1_rows),
    # T2: drummer arrives, brushes down — but nobody has adapted yet (v5/v6)
    "tap-T2-drums-arrive": song(*bass_v1_rows, *DRUMS),
    # T3: bass takes the drummer's bar-13 deal — "the pocket is locked" (v8)
    "tap-T3-pocket-lock": song(*BASS_V2, *DRUMS),
    # T4: piano joins, shells on 2-and-4, sacred spaces kept (v10)
    "tap-T4-piano-in": song(*BASS_V2, *DRUMS, *PIANO),
}
write("tap-T1-bass-v1.song", TAP_STATES["tap-T1-bass-v1"])
write("tap-T2-drums-arrive.song", TAP_STATES["tap-T2-drums-arrive"])
write("tap-T3-pocket-lock.song", TAP_STATES["tap-T3-pocket-lock"])
write("tap-T4-piano-in.song", TAP_STATES["tap-T4-piano-in"])

# T5 = the full score as recorded (v15), straight from the session
# (symlink-free copy so the state dir is self-contained)
write("tap-T5-full.score.song", tap_score)

# ── vocal readings A/B/C: each lab reading grafted onto the T4 band ──

def reading_rows(path):
    """The @vocal note rows (drop other headers) of a lab reading file."""
    rows = []
    for l in read(path).splitlines():
        if l.startswith("@vocal |"):
            rows.append(l)
    assert rows, f"no @vocal rows in {path}"
    return rows

for tag, fname in [("A", "vocal-reading-a-smoke.song"),
                   ("B", "vocal-reading-b-folkballad.song"),
                   ("C", "vocal-reading-c-foghorn-kestrel.song")]:
    rows = reading_rows(f"{ENS}/vocal-lab-last-ferry/{fname}")
    write(f"vocal-V{tag}-over-band.song",
          song(*BASS_V2, *DRUMS, *PIANO, *rows))

# solo readings too (as sung in the lab, alone)
for tag, fname in [("A", "vocal-reading-a-smoke.song"),
                   ("B", "vocal-reading-b-folkballad.song"),
                   ("C", "vocal-reading-c-foghorn-kestrel.song")]:
    write(f"vocal-V{tag}-solo.song", read(f"{ENS}/vocal-lab-last-ferry/{fname}"))

# ── duke-lab: R2 (on disk) vs R1 (reconstructed per BUILD-JOURNAL) ──

duke = read(f"{ENS}/duke-lab/score.song")
dlines = duke.splitlines()
D_HEADER = "\n".join(dlines[:5]) + "\n"
D_ROWS = [l for l in dlines if l.startswith("@piano")]

r1_rows = []
for i, row in enumerate(D_ROWS, start=1):
    r = row
    # (1) FLAT ARM: strip the per-row vel marks R2 added
    r = re.sub(r"\s*\|\s*vel:\s*\d+\s*$", "", r)
    # (2) REGISTER CEILING: drop the named answer notes one octave
    swaps = {
        2:  [("F5 Ab5 Db6", "F4 Ab4 Db5")],
        6:  [("Eb6 . D6 B5", "Eb5 . D5 B4")],
        9:  [("Eb6 Db6 C6", "Eb5 Db5 C5")],
        10: [("C6 . B5", "C5 . B4")],
        15: [("Eb6 D6", "Eb5 D5")],
        16: [("C6 .", "C5 .")],
    }
    for old, new in swaps.get(i, []):
        assert old in r, f"duke R2 bar {i}: expected {old!r} not found"
        r = r.replace(old, new)
    # (3) PICKUPS: replace the added barline-crossers with rests,
    #     keeping the cell count so subdivision is unchanged
    if i == 4:
        assert r.endswith("D4 E4"), f"bar4 tail unexpected: {r[-20:]!r}"
        r = r[: -len("D4 E4")] + "(rest) (rest)"
    if i == 12:
        assert "G3-B3" in r
        r = r.replace("G3-B3", "(rest)")
    r1_rows.append(r)

write("duke-R2-final.song", duke)
write("duke-R1-recon.song", D_HEADER + "\n".join(r1_rows) + "\n")

# ── seamstress gate-1: takes 1-10 (byte-exact) + canon excerpts ──────

SEAM_STATES = {}
for n in range(1, 11):
    src = f"{STITCH}/runs/stitch-{n:02d}/take.song"
    dst = f"seam-stitch-{n:02d}.song"
    write(dst, read(src))
    SEAM_STATES[f"seam-stitch-{n:02d}"] = dst

for p in sorted(os.listdir(f"{STITCH}/canon")):
    if p.endswith(".song"):
        write(f"seam-{p}", read(f"{STITCH}/canon/{p}"))

print("states written to", OUT)
for f in sorted(os.listdir(OUT)):
    print(" ", f)
