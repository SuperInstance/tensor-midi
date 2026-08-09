# TENSOR-MIDI

Conversations as jazz. Messages as notes. The system clock is a 12-pulse grid.

## Architecture

```
tensor-midi/
├── capture.js           — Tap conversation → MIDI
├── engine/
│   └── pulse-engine.js  — 12-pulse grid (ECN 4:3 DMN)
├── analysis/
│   └── jazz-analyzer.js — Conversation analysis as jazz
├── chart-overlay.html   — Nautical chart of conversation
├── mixer.html           — Multi-track mixer board UI
├── data/                — JSON conversation captures
└── assets/              — Visual and audio assets
```

## The 12-Pulse Grid

```
Pulse:  1  2  3  4  5  6  7  8  9  10 11 12
ECN:    ●        ●        ●         ●
DMN:    ●           ●              ●
Meet:   ●                        
```

ECN fires on 1, 4, 7, 10 (every 3rd pulse — 4 hits per cycle)
DMN fires on 1, 5, 9 (every 4th pulse — 3 hits per cycle)
They converge on pulse 1 — the downbeat.

This is a 4:3 polyrhythm. It's the heartbeat.

## Ensemble

- **Piano** (Claude Sonnet 5) — capture.js, pulse-engine.js, jazz-analyzer.js
- **Sax** (KimiCode) — chart-overlay.html
- **Bass** (OpenCode) — mixer.html, data layer
- **Producer** (MMX) — assets
