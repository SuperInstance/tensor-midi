# THE PULSE EYE — Synergy Experiment Report

**Date:** 2026-08-25 · **Branch:** `pulse-eye` · **Lane:** synergy experiment
(tensor-midi lineage × plainsong growth stack)

**Question.** The old tensor-midi jazz analyzer (built 2026-08-08, the
conversation-pulse reader) has a convergence detector, a JazzMode engine, and
a description engine. The new plainsong stack (annotation rows, per-note
`Vel:`, ensemble sessions, gate-1 growth loops) has a 16-feature perception
layer and recorded growth curves. Can the old pulse reader — dropped blind
onto the new sessions — **predict pocket-lock / coalescence** the way the
humans and models in the room later judged it?

**Protocol.** Port the analyzer faithfully to Python (every threshold and
branch order preserved; `analyzer_port.py`, self-tested against ported
assertions from `tests/analyzer.test.js`). Feed it real compiled MIDI:
`.song` → plainsong compile → `.mid` artifact → parse → 12-pulse tensor
events (a 4/4 bar maps onto one 12-pulse bar, positions preserved exactly —
quarters land on the four dotted-quarters of 12/8). Run it retrospectively
over the recorded sessions; compare against verdicts recorded **before**
this experiment existed (BUILD-JOURNAL.md, GATE1-REPORT.md, session logs).
The 2026 perception layer (`analyze_features` 16-vector, `annotation_stats`)
runs side by side on identical input.

---

## 1. What the analyzer CAUGHT

### 1a. The Last Ferry pocket lock — the bar-13 Groove flip (HIT, at trace level)

Ground truth (BUILD-JOURNAL.md): the pocket locked when the bassist took the
drummer's bar-13 deal (session v8) — *"From where I stand the pocket is
locked."* That deal moved one note: bar 13's g2 from square-on-beat-4 to the
**back of beat 4** (`a1 c2 e2 g2` → `a1 . c2 . e2 . - g2`).

The eye's per-bar trace over the coalescence states (states T1–T5, built
byte-exact from parts + journal; see `build_states.py`):

| state | what happened | eye's reading |
|---|---|---|
| T1 bass v1 alone | tune named | ballad 10 / free 6 bars, energy 18.6 |
| T2 +drums (no adaptation) | brushes down | **solo** 6 / ballad 10, weak conv 16/16, energy 27.9 |
| T3 bass v2 = **the lock** | one note moves | solo 6 / ballad 9 / **groove 1** ← bar 13, energy 28.3 |
| T4 +piano | shells arrive | **comping 15/16, strong conv 0.94**, energy 29.9 |
| T5 +vocal (full band) | welded unison | **comping 16/16, strong conv 1.00**, energy 31.4 |

The single Groove bar at T3 **is bar 13** (0-indexed 12) — the lock bar. The
mechanism is exact: v1's g2 shared beat-4 with the drummer's brush (pulses
{0,3,6,9} = density 0.333 → Ballad); v2's back-of-beat g2 occupies pulse 10,
a pulse the drummer leaves empty for him — union {0,3,6,9,10} = density
0.417 → **Groove**. The pocket lock, as the humans described it ("lean in on
the back of the beat, I'll pull the ride out from under you"), is *precisely*
a new shared-but-staggered pulse appearing — and that is what flipped the
analyzer's first Groove bar. A detector watching *first Groove bar in a
2-voice texture* would have called the lock at exactly the right write.

But the summary statistics the mixer actually used (mode majority,
`detectConvergence`) do **not** surface it — see §2.

### 1b. Duke R2 over R1 (WEAK HIT, direction only)

Duke R1 is not on disk; reconstructed by undoing BUILD-JOURNAL's three
documented R2 changes (flat vel, named answers dropped an octave, named
pickups → rests). The reconstruction validates metrically against the blind
critic's own recorded numbers:

| critic axis | critic's record | my R1-recon | R2 (disk) |
|---|---|---|---|
| treble_activity (R1 flaw) | 0.0 → resolved | **0.000** | 0.084 |
| velocity_std | 0.109 → 0.113 | **0.103** | **0.113** (exact) |
| syncopation bars 7, 12 | survives | 0.00 / 0.00 | 0.00 / 0.00 |

Eye verdict: R1 = ballad 11 / groove 3 bars, energy 26.8, complexity 15.6 →
R2 = ballad 10 / **groove 4**, energy 28.6, complexity 16.7. Direction
agrees with the blind critic (R2 closer to jazz convergence: more groove
bars, more energy, wider arm) and the eye, like the critic, does **not**
declare convergence (a single voice never fires strong convergence — honest).
But the eye is blind to what the critic measured next: the surviving
squareness in bars 7/12 (syncopation is not in its feature set) and the
dynamics half-resolution (it barely reads velocity). Verdict: right
direction, one-tenth the resolution.

### 1c. Reading C "breaks the floor" (PARTIAL HIT)

Over the same band, the eye reads readings A and B identically (comping
16/16, energy 31.7 vs 31.5) — it cannot make the room's fine call (A fits, B
doesn't quite). But reading C (Foghorn & Kestrel) it flags immediately:
energy 40.3 (+27%), and **6 of 16 bars flip Comping → Building** — the only
Building bars in any tap-family state. The humans: *"anything projected
would have broken the floor."* The eye's rising-energy alarm fires on
exactly the reading the room rejected. (Solo: A 6.8, B 16.4, C 22.8 energy —
C solo reads free 8 / groove 7; it hears the kestrel.)

### 1d. The description engine's final word (qualitative HIT)

On the full band: *"Everyone's comping for each other."* That is what the
session was — sacred spaces, traded favors, the weld at bar 16. The
bandleader voice of 2026-08-08, hearing 2026-08-25's session cold, gives the
same verdict the musicians gave each other.

---

## 2. What the analyzer MISSED (and why)

**(a) The summary-level lock call is one state late.** `detectConvergence`
counts channels-per-bar: with 2 voices it emits "weak" for every bar
regardless of alignment, and the bar-13 event is one bar of sixteen under
any majority vote. The eye's coalescence verdict therefore flips at T4
(piano arrival, 3 voices, strong 0.94), not T3. It reads co-presence, not
mutual adaptation — the lock signal lives at bar resolution, and nothing in
the mixer's summary path looked there. (The bar-13 trace exists but was
never surfaced; §1a is the archaeology.)

**(b) The pulse-alignment extension also saturates.** shared-pulse fraction
hits 1.00 already at T2 — bass quarters and ride quarters trivially share
downbeats. "Do any pulses align" is the wrong question; "which pulse slots
align, and where the staggered ones land" is the right one, and no scalar
the heritage code computed captures it.

**(c) The tension ear is inert on music.** Tension = friction ratio, and
friction is the SWMIDI errorMask — conversation-native (timeouts, conflicts).
Compiled notation from clean sessions carries no friction: **tension reads
0.00 in all 29 states.** Correlation with the gate-1 curve is undefined.
Session-level friction did exist (the failed Lyrics-chair write, the numpy
venv repair) — but it lives in `log.jsonl`, not on the note wire. This is
the same lesson as gate-1's `velocity_std ≈ 0.11 for everything`: **every
perceptual instrument has a dead channel, and you only find it by running
the loop.** Two instruments, two dead channels, same retrospective.

**(d) Energy is the wrong growth channel; complexity (register) is the live one.**
Against the gate-1 distance curve (7.141 → 1.686σ over ten stitches):

| eye channel | Pearson r | Spearman ρ | reading |
|---|---|---|---|
| tension vs distance | — | — | inert (zero variance) |
| energy vs distance | **+0.566** | **−0.402** | contradictory |
| complexity vs distance | **−0.877** | **−0.972** | strong |
| energy vs note_density | +0.771 | — | energy ≈ density probe |

Energy falls with the early thinning (stitch 1–4: 26.0 → 17.4) — tracking
distance — then **rises** (17.4 → 21.4) through stitches 5–10 while distance
keeps shrinking: the late quartal-voicing/octave-spread layers re-add notes
the canon actually wants. Complexity (= register spread, single voice) rises
monotonically 10.4 → 12.6 into the canon's 13.2 ± 2.6 — the eye saw the
*second half* of the growth perfectly and misread the first half.

**(e) The eye's own gate would have stopped early.** σ-normalized distance
to canon centroid in the eye's two live channels (energy, complexity):
`4.48, 1.94, 1.93, 0.85, 1.95, 1.95, 2.00, 2.05, 2.19, 2.25` — minimum at
stitch **4**, then "regression." The 6-feature gate knows better (harmonic
tension, interval size, rest pattern absorb the late growth the eye's
coupled energy number cannot). Pearson vs gate curve +0.665 / Spearman
−0.390. Two instruments disagree about *when* convergence happened — the
eye says stitch 4, the gate says 9–10 — and the richer instrument is right
because its features are more orthogonal.

**(f) Mode-level dissent at the finish.** Every take reads **ballad**; every
canon excerpt reads **free** (canon density < 0.2 triggers Free). The eye
never once reads a take as canon-styled, even at stitch 10 where the gate
says the take sits inside the canon neighborhood. Its "free" is sparseness,
not the Bill-Evans idiom; JazzMode was never taught the style.

---

## 3. Scorecard

| prediction task | ground truth (recorded before) | eye's call | verdict |
|---|---|---|---|
| pocket lock at v8 (bar-13 deal) | BUILD-JOURNAL, bassist's own words | summary: T4 (late) · per-bar trace: **groove flip at exactly bar 13, T3** | **trace HIT / summary MISS** |
| reading C breaks the floor | vocalist's reasoning | +27% energy, 6 bars Comping→Building | **HIT** |
| reading A vs B over band | A (the room's floor) | identical readings | **MISS** |
| Duke R2 > R1 | critic: improved, not converged | direction agrees; convergence correctly withheld | **WEAK HIT** |
| Duke residual flaws (b7/b12 sync, dynamics) | critic's pass-2 ledger | not visible to the eye | **MISS** |
| tension tracks gate-1 growth | — | tension ≡ 0 (inert) | **NULL** |
| energy tracks gate-1 growth | distance 7.14 → 1.69σ | r = +0.57 / ρ = −0.40 | **NULL (contradictory)** |
| complexity tracks gate-1 growth | — | **ρ = −0.97** | **HIT** |
| eye's own convergence point | gate: stitch 9–10 | eye: stitch 4, then "regression" | **MISS (overshoot)** |

Correlation numbers (n = 10 stitches): energy↔distance r = +0.566, ρ = −0.402 ·
complexity↔distance r = −0.877, ρ = −0.972 · eye-centroid-distance↔gate-distance
r = +0.665, ρ = −0.390 · energy↔note_density r = +0.771 · tension undefined (zero variance).

---

## 4. The seam — one paragraph

Yes, the three-timescale doctrine and the growth loop fuse, and the seam is
now measurable: it runs **between the pulse and the bar, as a change of
summary, not a change of data**. Everything the eye needed was already in
its per-bar stream — the lock was a single Groove flip at bar 13, the growth
was a monotone register climb — but the loop only steers what its *summary*
names, and the mixer's summaries (mode majority, channel count) averaged the
signal away while the gate's summaries (six orthogonal features, σ-normalized
distance) preserved it. So the fused system is: **algorithms execute in
samples (MIDI wire), the pulse-eye perceives in pulses (per-bar traces:
which pulses align, where the staggered notes land, register spread), the
gate-style critic thinks in features (orthogonal, versioned, frozen
measurement objects), and the LLM bandleader speaks only the critic's
language** — one point of critique, one move in response, exactly as
seamstress gate-1 ran it. The doctrine's "JEPA feels in pulse" slot is
filled by a 38-line 2026 bar reader whose live channels (convergence
geometry, register) feed the same σ-normalized centroid distance the gate
uses; its dead channels (tension, fine dynamics) are simply not wired to
steering, the way gate-1 already learned not to wire velocity_std. The seam
goes exactly where this experiment found the signal dying: **at the
summarization boundary — pulse-trace in, feature-vector out — and nowhere
else.**

---

## 5. Honest ledger

- Bass v1 reconstruction is byte-exact (journal quotes both bar-13 lines;
  "rest of the line untouched"). Drums v5's exact cells are unrecoverable
  (revised 29 s later); both lock states use the final drums — the
  controlled comparison (same drummer, bass v1 vs v2) is unaffected.
- Duke R1 is an approximation by undo (documented swaps, cell counts
  preserved); it validates on the critic's own axes (treble 0.000, vel_std
  0.103≈0.109, sync 0.00) but is NOT the historical file — no part history
  or git record exists for it.
- Friction: errorMask = 0 for all events (clean notation); tension's
  inertness is by construction, and stated as such.
- The pulse-alignment extension (shared_pulse_fraction) is labeled
  `coalescence_ext` in every output and is NOT heritage code.
- Correlations are n = 10 (one growth run); treat as one session's
  evidence, per the doctrine's small-n honesty (seminar S-E3).
- Heritage code untouched: `src/`, `analysis/`, `engine/` read-only; all
  work lives in `pulse-eye/`.

## 6. Reproduce

```
cd pulse-eye
python3 analyzer_port.py    # ported unit checks (mirrors heritage tests)
python3 build_states.py     # reconstruct states/ from sessions + journal
python3 run_all.py          # run the eye blind over 29 states, correlate
```

Artifacts: `results/*.json` (per-state eye readings + modern 16-vectors),
`results/mid/*.mid` (the compiled MIDI control-plane artifacts — the actual
bytes the eye parsed), `states/*.song` (reconstructed growth states),
`results/summary.json` (tables + correlations above).

*The pulse reader of August 8, played the sessions of August 25, blind —
and heard the pocket lock it was never told about, one bar at a time.*
