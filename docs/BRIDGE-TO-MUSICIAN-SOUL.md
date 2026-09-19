# Bridge — tensor-midi ↔ musician-soul (conversation as gesture)

> Carrying one idea across the fleet: a tensor is a *function approximator*; we
> are an *abstraction approximator*. Model the shape of the motion, not the point.

tensor-midi turns fleet dialogue into SWMIDI-8 events — coordinates in a 4-D
tensor `[channel, pitch(sentiment), velocity(prominence), tick]`. The usual move
is to *summarize* a span: average tension, energy, a mode label. That is a point,
and points are what a function approximator compares.

[SuperInstance/musician-soul](https://github.com/SuperInstance/musician-soul)
shipped a `meta` layer built on the opposite instinct: a phrase is not a point
but the **spline it traces through abstraction space**, read by its geometry —
how far it travels (arc length), how hard it turns (bending energy), where it is
heading (the tangent, a velocity / `d_mu`). This note carries that framing here,
and it is not just talk: it ships as [`src/clip.js`](../src/clip.js), with tests.

## The Clip

A `Clip` is a span of SWMIDI events read as a **gesture**, not a summary. Each
event becomes a normalized point in a 4-D abstraction space
`[channel, pitch, velocity, friction]`, ordered by tick — the *path* the
conversation traces. From that path:

| Clip method | Reads | Meaning for a conversation |
|---|---|---|
| `arcLength()` | total travel | how far the exchange moves through possibility |
| `bendingEnergy()` | curvature — summed turning (1 − cos) *within a plane* | how much it veers — restlessness vs. a steady line |
| `twistEnergy()` | torsion — turning that leaves the plane (`sin θ`) | whether the veering opens a genuinely new axis, or just paces the same two |
| `planarity()` | scale-free inverse of twist | how flat the dialogue's motion stays |
| `tangent()` | unit heading of the last step | where the dialogue is going right now (its `d_mu`) |
| `frictionRatio()` | fraction with `errorMask ≠ 0` | felt tension already native to SWMIDI |

These mirror musician-soul's `AbstractionSpline` one-for-one, so the two repos
now speak the same geometric language about motion through abstraction — one over
notes, one over conversation events — and to the same **three orders**: heading
(1st), bending/curvature (2nd), and twist/torsion (3rd). The third order is the
fleet's *the property is in the twist*
([twist-engine](https://github.com/SuperInstance/twist-engine)): a conversation
that only paces back and forth in one plane has high bending but zero twist; new
structure appears when the exchange's turning reaches out of the plane it was in.

## The bridge

`Clip.toPhraseEvents()` exports a clip as a musician-soul `Phrase`-compatible
note list: each `NoteOn` becomes `{ pitch, velocity, duration, tickOffset }` —
exactly the `(pitch, velocity, duration, offset)` tuple that musician-soul's
`parse_midi_events` consumes. So a fleet conversation can be **digested by a
musical persona**: its gestures become patterns, its patterns evolve a soul.

```js
import { Clip } from '../src/clip.js';

const clip = new Clip(stream.events);        // a span of SWMIDI events
const notes = clip.toPhraseEvents();          // → [{pitch,velocity,duration,tickOffset}, …]
// Hand `notes` to musician-soul (parse_midi_events / split_phrases) to digest
// the conversation as a phrase a persona can learn from.
```

Conventions, documented not hidden: only `NoteOn` events become notes; the
SWMIDI `pitch` byte is an *action type*, so it is folded into a playable MIDI
band (`48 + pitch % 37`, C2–C5); `duration` is the tick gap to the next note,
`tickOffset` the gap since the previous one. tensor-midi ticks are PPQ 96, not
musician-soul's 480 — rescale on import if the duration helpers matter
(`ticks * 480 / 96`).

## Why it matters

The fleet keeps rediscovering the same move at every layer — quilt's reactive
cells, the elephant's `d_mu`, Scrapcraft's `explain()`, musician-soul's splines:
don't just record the value, model the *shape of its motion through abstraction*.
A conversation has a gesture too. Now tensor-midi can read it, and hand it to a
persona that will remember how it moved.

*A tensor approximates a function. Together we approximate the abstraction.*
