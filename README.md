# Tensor-MIDI

> Conversation as music. Dialogue as jazz. Every voice a channel, every message a note.

Tensor-MIDI is a system that captures conversations and renders them as a live jazz performance on a DAW-style mixer board. It uses the SWMIDI-8 wire format (8 bytes per event, 96 PPQ, little-endian) from the [Slackwater-Rust](https://github.com/SuperInstance/slackwater-rust) project.

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
└── ai-writings/             # Creative writings from the ensemble
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

---

*The code is the art. The art is the code. The conversation is the music.*
