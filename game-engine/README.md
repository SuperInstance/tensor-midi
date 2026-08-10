# Game Engine — Platonic Randomness

> *The choice of Platonic solid IS the game design decision.*

## What This Is

A game system where dice are not dice — they're Platonic solids, and the solid chosen determines the game system's character. Events arrive as SWMIDI-8 bytes; each system runs on its own Platonic-solid RNG orbit; positions evolve like Catan dice.

### The Five Systems

| System | Solid | Fold | Channel | Feel |
|--------|-------|------|---------|------|
| Combat | Tetrahedron | 4 | 0 | Fast, readable |
| Social | Icosahedron | 12 | 1 | Pulse-grid aligned (matches the 12-pulse cycle!) |
| Weather | Dodecahedron | 20 | 2 | Complex, slow |
| Resources | Cube | 8 | 3 | Steady, plannable |
| Exploration | Octahedron | 6 | 4 | Cardinal directions |

The Social system uses the icosahedron (12-fold) specifically because it matches the 12-pulse grid. Social interactions are musical.

### Design Philosophy

The dice change the BOARD (positions evolve), not the winner. Strategy wins. Every event returns both `{ system, result, narrative }` — data and story stay coupled. This is the fleet's core principle: code is the art.

### Files
- **[platonic-engine.js](platonic-engine.js)** — The engine core
- **[platonic-rng.js](platonic-rng.js)** — JS port of the Platonic RNG
- **[platonic-engine.test.js](platonic-engine.test.js)** — Test suite
- **[demo.js](demo.js)** — Runnable demo

### Connected
- [Platonic Randomness](https://github.com/SuperInstance/platonic-randomness) — Catan 2d6, pyramids
- [Base60 Lattice](https://github.com/SuperInstance/base60-lattice) — 60-symbol lattice math
- [SuperInstance Papers P04](https://github.com/SuperInstance/SuperInstance-papers) — Pythagorean Geometric Tensors
