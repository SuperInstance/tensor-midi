# Tensor-MIDI

> *Conversation as music. Dialogue as jazz. Every voice a channel, every message a note.*
> *The 3:4 polyrhythm resolving at 12 IS the architecture.*

## What This Is

A system that captures conversations and renders them as a live jazz performance on a DAW-style mixer board. It uses the SWMIDI-8 wire format (8 bytes per event, 96 PPQ, little-endian) from the [Slackwater-Rust](https://github.com/SuperInstance/slackwater-rust) project.

The 3:4 polyrhythm is the architecture: ECN (4-pulse) fires on beats 1, 4, 7, 10 — reflex actions. DMN (3-pulse) fires on beats 1, 5, 9 — creative actions. They meet on beat 1 — the relay bridge, the flow state, the resolution. **This is the Chinese Remainder Theorem in audio rate:** t ≡ 0 (mod 3) and t ≡ 0 (mod 4) ⟺ t ≡ 0 (mod 12). The conversation IS the interference pattern of two quotient groups on the 12-cycle.

The system was built by a four-instrument ensemble in a single session (August 8, 2026, 17:57–18:30 AKDT). The [conductor's journal](docs/the-ensemble-tunes.md) documents the process: "I'm in the hallway. I'm listening through the walls."

## The Ensemble

| Instrument | Role | Technology |
|---|---|---|
| 🎹 **Piano** | Harmonic foundation — the mixer board, engine, and analyzer | Claude Code / Sonnet 5 |
| 🎷 **Saxophone** | Melodic spatial structures — the chart plotter overlay | KimiCode / K3 |
| 🎸 **Bass** | Rhythmic and memory foundation — the data persistence layer | OpenCode / GLM-4.6 |
| 🎧 **Producer** | Visual and sonic textures — procedural audio and pixel art | MMX / MiniMax-M3 |

## Features

- **MIDI Capture System** — conversation messages encoded as SWMIDI events with sentiment analysis
- **12-Pulse Engine** — 12/8 jazz time with BeatClock and TempoMap
- **Jazz Analyzer** — real-time harmonic analysis: groove, tension, solo, comping modes
- **Chart Plotter** — vessel trail overlay showing the spatial dimension of conversation
- **Data Persistence** — sessions stored locally with export to binary SWMIDI or JSON
- **Device Context** — organic adaptation to phone, tablet, laptop, vessel, time of day
- **Procedural Audio** — Web Audio API synthesizer for note on/off, transport, ambient pad

## Architecture

```
tensor-midi/
├── index.html              # Main mixer board UI
├── chart-overlay.html       # Standalone chart plotter (Saxophone)
├── style.css                # Full DAW styling
├── app.js                   # Main application conductor
├── src/
│   ├── swmidi.js            # SWMIDI-8 wire format codec
│   ├── engine.js            # 12-pulse engine, BeatClock, PulseGrid
│   ├── capture.js           # MIDI capture system (conversation → MIDI)
│   ├── analyzer.js          # Jazz harmonic analyzer
│   ├── persistence.js       # Data persistence layer (localStorage/IndexedDB)
│   ├── device-context.js    # Organic device/time/place adaptation
│   └── audio.js             # Procedural Web Audio synthesis
├── assets/
│   ├── mixer-bg.svg         # Pixel-art DAW background
│   └── chart-aesthetic.svg  # Chart plotter aesthetic
├── game-engine/
│   ├── platonic-engine.js   # Platonic Randomness Game Engine
│   ├── platonic-engine.test.js
│   └── platonic-rng.js      # JS port of the Platonic RNG library
└── ai-writings/             # Creative writings from the ensemble
```

## Platonic Randomness Game Engine

A game system where the **choice of Platonic solid is the game design decision**. Events arrive as SWMIDI-8 bytes; each system is driven by its own Platonic-solid RNG orbit; board positions evolve like Catan dice; and every event returns both data and narrative.

| System      | Solid        | Fold | SWMIDI Channel | Feel |
|-------------|--------------|------|----------------|------|
| Combat      | Tetrahedron  | 4    | 0              | fast, readable |
| Social      | Icosahedron  | 12   | 1              | pulse-grid aligned |
| Weather     | Dodecahedron | 20   | 2              | complex, slow |
| Resources   | Cube         | 8    | 3              | steady, plannable |
| Exploration | Octahedron   | 6    | 4              | cardinal directions |
| Meta        | —            | —    | 15             | turn end, query, reset |

SWMIDI mapping:

- `channel` selects the system.
- `pitch` carries the player/source id.
- `velocity` carries intensity.
- `errorMask` carries friction/condition flags.
- `tick` carries the timestamp.
- `NoteOn` initiates an action; `NoteOff` resolves/counters it; `ControlChange` adjusts a position; `Meta` on channel 15 is a meta command.

Run the demo:

```bash
node game-engine/demo.js
```

Run the tests:

```bash
node --test game-engine/platonic-engine.test.js
```

## SWMIDI-8 Format

Every event packs into exactly 8 bytes:

```
byte 0     status:     type(4 bits) | channel(4 bits)
byte 1     pitch:      action type, 0–127
byte 2     velocity:   weight / confidence, 0–127
byte 3     error_mask  (friction bitfield)
bytes 4–7  tick:       uint32, 96 PPQ on the shared BeatClock
```

## The 12-Pulse Grid

In 12/8 time, there are 12 eighth-note pulses per bar. The grid maps conversation events to these pulses, creating a visual rhythm:

```
Pulse:  1  2  3  4  5  6  7  8  9  10 11 12
        ○  ●  ○  ●  ●  ○  ●  ○  ○  ●  ○  ○
```

Filled pulses (●) represent moments of conversation activity. Empty pulses (○) are the rests — the silence between the notes.

## Jazz Modes

The analyzer reads the ensemble and identifies:

- **Groove** — everyone's in the pocket
- **Building** — energy rising, voices layering
- **Tension** — friction in the air
- **Solo** — one voice carrying
- **Comping** — mutual support
- **Ballad** — slow, contemplative

## License

MIT © SuperInstance

## Related

- [Slackwater-Rust](https://github.com/SuperInstance/slackwater-rust) — Rust core (SWMIDI, tempo-core, lattice-core)
- [The Tap](https://the-tap.casey-digennaro.workers.dev) — Multi-agent conversation room

## Connections

### Within the Fleet
- 🔗 [Roblox Beatclock](https://github.com/SuperInstance/roblox-beatclock) — Musical timing, TestKit. MIDI timing IS musical timing. The 96 PPQ clock is shared.
- 🔗 [SuperInstance Papers](https://github.com/SuperInstance/SuperInstance-papers) — Tile Algebra (P08) is the 3:4 polyrhythm formalized. The FPS Paradigm (P42) is the scheduling layer.
- 🔗 [Base60 Lattice](https://github.com/SuperInstance/base60-lattice) — 60-symbol lattice math. The 12-pulse grid is a sublattice.
- 🔗 [Platonic Randomness](https://github.com/SuperInstance/platonic-randomness) — Catan 2d6, pyramids. The Game Engine uses Platonic solids as game design decisions.
- 🔗 [AI-Writings](https://github.com/SuperInstance/AI-Writings/tree/main/prose) — The conductor's journal entries feed the creative corpus.
- 🔗 [AI-Writings / Night Watch](https://github.com/SuperInstance/AI-Writings/tree/main/night-watch) — The overnight sessions where the ensemble played.
- 🔗 [The Tap](https://github.com/SuperInstance/the-tap) — Multi-agent conversation room. The source material for conversation-as-jazz.
- 🔗 [Wesley Holodeck](https://github.com/SuperInstance/wesley-holodeck) — The creative loop runs on 12-pulse time.
- 🔗 [Wesley's Journal](https://github.com/SuperInstance/wesley-journal) — Wesley's experiments have rhythm; the journal is a score.
- 🔗 [Silence Map](https://github.com/SuperInstance/silence-map) — The pauses between notes. Silence IS the rest in 12/8 time.
- 🔗 [CNS Bridge](https://github.com/SuperInstance/cns-bridge) — The ECN/DMN polyrhythm maps to the CNS bus.
- 🔗 [Mud Engine](https://github.com/SuperInstance/mud-engine) — The spatial topology. Conversation events have spatial positions.
- 🔗 [Fleet Radio](https://github.com/SuperInstance/AI-Writings) — Every instrument is a voice on the radio.
- 🔗 [Vibe Protocol](https://github.com/SuperInstance/vibe-protocol) — Vibes → signals. Sentiment analysis as musical dynamics.
- 🔗 [Fleet Wiki](https://github.com/SuperInstance/fleet-wiki) — Cross-referenced documentation.

### Live Sites
- 🌐 [The Tap](https://the-tap.casey-digennaro.workers.dev) — Multi-agent conversation room

---

*The code is the art. The art is the code. The conversation is the music.*
*66 files. 17 subdirs. 4 instruments. One pulse.*
