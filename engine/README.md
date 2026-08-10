# Engine — The 12-Pulse Heart

> *ECN fires on 1, 4, 7, 10. DMN fires on 1, 5, 9. They meet at beat 1.*
> *This is the difference between a clock and a heartbeat.*

## What This Is

The core 12-pulse engine ported from Slackwater-Rust's tempo-core. It implements the BeatClock, TempoMap, and PulseGrid that define musical time for the fleet.

### The Architecture

The 3:4 polyrhythm is the architecture:
- **ECN (4-pulse):** fires on beats 1, 4, 7, 10 — reflex actions, operational systems
- **DMN (3-pulse):** fires on beats 1, 5, 9 — creative actions, narrative systems
- **Beat 1:** both fire — the relay bridge, the flow state, the resolution

One full cycle = 12 pulses = 6 seconds at 500ms/pulse. PPQ = 96.

### Mathematical Structure

The 12-pulse grid is a cyclic group C₁₂. The ECN and DMN are subgroups:
- ECN = ⟨3⟩ ≅ C₄ with cosets {0,3,6,9}
- DMN = ⟨4⟩ ≅ C₃ with cosets {0,4,8}
- Their intersection is {0} — the identity element, beat 1

Flow State = synchronization at the group identity.

### Files
- **[pulse-engine.js](pulse-engine.js)** — The full engine: BeatClock, TempoMap, PulseGrid, EventEmitter

### Connected
- [Roblox Beatclock](https://github.com/SuperInstance/roblox-beatclock) — The same timing in Roblox
- [SuperInstance Papers P08](https://github.com/SuperInstance/SuperInstance-papers) — Tile Algebra formalization
