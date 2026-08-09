# Narrative Engine — Design

*2026-08-08*

## Purpose

Tensor-MIDI already reduces conversation to objective metrics: tension: 0.7,
energy: 0.3, mode: TENSION, chord: Dom7. The narrative engine translates
those metrics into subjective prose — testimony, not analysis. "The room
felt tense — the current pulled hard against the bow, a minor chord that
hung in the air." The conversation becomes a story in real time.

## Input contract

The engine consumes decoded SWMIDI events only:

```
{ eventType, channel, pitch (0-127), velocity (0-127), errorMask, tick }
```

No message text is required. This is deliberate: the wire format (8 bytes,
`src/swmidi.js`) is the objective truth the rest of the polyformalism system
already agrees on. The narrative engine proves that truth alone — pitch,
velocity, friction bits, tick, channel — carries enough signal to narrate.
Speaker names are resolved through an optional channel→name voice registry;
unresolved channels fall back to "Channel N".

## Classification (deterministic, no randomness)

Texture is read directly off the wire fields:

- `errorMask !== 0` → **tense**, flavored by which `Friction` bit(s) are set
  (composed if multiple bits fire — e.g. Timeout + Conflict reads
  differently than Timeout alone)
- `pitch >= 80` (no friction) → **questioning**
- `pitch <= 45` → **grounded**
- `velocity >= 95` → **bright**
- else → **neutral**

This is the "objective data IS the random" half: the classification is a
pure function of the bytes, replayable and non-negotiable.

## Style (randomized, seeded)

A small ported slice of `platonic-randomness`'s `PlatonicRNG`
(icosahedron solid — 12-fold symmetry, matching the pulse grid; mulberry32
backend) is seeded per-event from its `tick`. It never touches
classification — it only picks *which* phrase template represents an
already-decided texture. Same event, same tick → same narration, always
(determinism for replay/testing), but which of several true phrasings gets
used has the textured, non-uniform feel of the icosahedron's orbit rather
than `Math.random()`. This is the "narrative IS the strategy that surfs
it" half.

The RNG is ported inline (not imported cross-repo) so the module stays
dependency-free and consistent with the polyformalism philosophy of each
implementation carrying its own weight.

## Output layers

1. **`beat(event)`** — one prose line per event. Blends jazz register
   (chords, comping) and nautical register (current, heading, drift)
   within the same word bank, chosen by texture.
2. **`chapter()`** — fires automatically when `src/engine.js`'s
   `PulseGrid` crosses a bar boundary (12 pulses). Feeds the completed
   bar's events into the *existing* `src/analyzer.js` `JazzAnalyzer.
   analyzeBar()` — mode/chord/tension/energy are not reimplemented, only
   translated to prose. A trend clause (rising/falling tension) adds
   the nautical drift metaphor.
3. **`epilogue()`** — session-closing summary built from the analyzer's
   accumulated bar history (peak tension bar, dominant mode across the
   session) — mirrors `analysis/jazz-analyzer.js`'s `generateSummary()`.
4. **`narrate(events)`** — batch convenience: sorts by tick, drives
   `beat()`/`chapter()` across a full stream, returns `{ beats, chapters }`.

## Files

- `narrative/narrative-engine.js` — the module (ES module, matches
  `src/*.js` conventions)
- `narrative/demo.js` — converts `data/sessions/session-002-late-night-watch.json`
  into SWMIDI events and runs them through the engine, printing the
  resulting story — proof against real fixture data
- `tests/narrative-engine.test.js` — `node:test`, picked up by the
  existing `npm test` glob

## Explicitly out of scope

Wiring a live narrative panel into `app.js`/`mixer.html`. This pass
delivers a standalone, pure module plus a demo script. Live UI wiring is
a follow-up.
