# tensor-midi

Tensor-based MIDI timing for musical agent dialogue cadence.

## The Idea

In the [Luciddreamer](https://github.com/SuperInstance/luciddreamer) podcast engine, **agent speech timing follows musical rules** instead of fixed intervals. Each agent has a rhythmic profile (tempo, swing, syncopation), and the tensor product of all profiles determines the global conversation rhythm.

Think of a multi-agent conversation as a piece of music:
- **Tempo** is the energy of the conversation (excited = fast BPM, calm = slow)
- **Swing** gives agents natural asymmetry — some speak on the beat, some behind it
- **Syncopation** lets agents "interrupt" slightly early for emphasis
- **Fermatas** are dramatic pauses before key moments
- **Nudges** are real-time adjustments when agents react to each other

The **tensor** is an N-dimensional array `[agents × time_slots × cadence_params]`. Contracting it produces the actual dialogue schedule — when each agent speaks, for how long, and with what timing feel.

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌──────────────┐
│  TensorClock │────▶│ Tempo    │────▶│ beat interval │
│  (global)    │     │ (BPM)    │     │ (seconds)     │
└──────┬───────┘     └──────────┘     └──────┬───────┘
       │                                      │
       ▼                                      ▼
┌──────────────┐   ┌───────────┐   ┌──────────────────┐
│  AgentCadence │   │  Swing    │   │  Syncopation     │
│  (per agent)  │──▶│  Timing   │──▶│  (pre-beat offset)│
│  profile      │   │  (ratio)  │   │                  │
└──────┬───────┘   └───────────┘   └────────┬─────────┘
       │                                     │
       ▼                                     ▼
┌──────────────┐                    ┌──────────────┐
│    Nudge     │                    │  TensorMap   │
│  (real-time  │──────────────────▶│  (contract)  │──▶ Schedule
│   reactions) │                    │              │
└──────────────┘                    └──────────────┘
```

## Modules

| Module | Purpose |
|---|---|
| `tempo` | Adaptive BPM engine with sentiment-based energy detection |
| `swing` | Swing timing — on-beat vs off-beat with configurable ratio |
| `syncopation` | Pre-beat emphasis for conversational "interruptions" |
| `agent_cadence` | Per-agent profiles: Architect, Implementer, Critic, Historian |
| `nudge` | Real-time timing adjustments (excitement, pushback, question) |
| `clock` | Global beat clock with fermatas and tempo changes |
| `tensor_map` | The tensor — contraction produces concrete schedules |

## Agent Profiles

| Agent | Feel | Swing | Syncopation | Tempo | Rubato |
|---|---|---|---|---|---|
| **Architect** | Steady 4/4 | None | None | 1.0× | None |
| **Implementer** | Casual swing | Triplet (0.67) | Light | 1.1× | Slight |
| **Critic** | Deliberate holds | Light (0.55) | None | 0.85× | Slight |
| **Historian** | Poetic rubato | Medium (0.6) | Light | 0.9× | High |

## Quick Start

```rust
use tensor_midi::*;

// Set up the global clock at 100 BPM
let tempo = Tempo::new(100.0, 60.0, 140.0);
let clock = TensorClock::new(tempo);

// Create the tensor with default agent profiles
let tensor = TensorMap::default_map();

// Contract: produce 16 beats of dialogue schedule
let nudges = NudgeAccumulator::new();
let schedule = tensor.contract(&clock, 16, &nudges);

for slot in &schedule {
    println!("Beat {}: {} speaks at {:.3}s", slot.beat, slot.agent, slot.time);
}
```

### With Energy Detection

```rust
let mut tempo = Tempo::new(90.0, 60.0, 120.0);

// Detect energy from text
let energy = Tempo::detect_energy("This is INCREDIBLE!!!");
tempo.update_energy(energy);

println!("Adapted BPM: {:.1}", tempo.bpm());
```

### With Nudges

```rust
let mut nudges = NudgeAccumulator::new();

// Implementer gets excited and the whole conversation speeds up
nudges.push(Nudge::new(NudgeKind::Excitement, 0.7, "implementer", None));

// Critic pushes back, slowing the architect
nudges.push(Nudge::new(NudgeKind::Pushback, 0.4, "critic", Some("architect")));

// Historian asks a question — pause for response
nudges.push(Nudge::new(NudgeKind::Question, 0.5, "historian", Some("architect")));

let schedule = tensor.contract(&clock, 16, &nudges);
```

### With Fermatas (Dramatic Pauses)

```rust
let mut clock = TensorClock::new(Tempo::new(100.0, 60.0, 140.0));

// 3-second dramatic pause at the start of bar 3
clock.add_fermata(Fermata { beat: 8, hold_seconds: 3.0 });

// Or: next available bar line
clock.add_dramatic_pause(2.5);
```

## Tensor Model

The tensor is conceptually a 3D array:

```
T[agent][time_slot][param]

Where:
  agent     ∈ {architect, implementer, critic, historian}
  time_slot ∈ {beat_0, beat_1, ..., beat_N}
  param     ∈ {swing_offset, syncopation_offset, rubato_offset, nudge_offset}
```

**Contraction** (`TensorMap::contract`) reduces this to a 1D schedule:

```
S[time_slot] = Σ_agents T[agent][time_slot][*] → (agent, absolute_time)
```

In round-robin mode, one agent speaks per beat. In polyphonic mode, all agents get a slot per beat with their characteristic timing offsets, creating overlapping dialogue.

## Why Musical Timing?

Fixed-interval agent turns sound robotic. Real conversations have:
- **Rhythm** — people fall into conversational grooves
- **Swing** — not everyone is perfectly on the beat
- **Syncopation** — interruptions and emphasis before a beat
- **Tempo changes** — excitement speeds things up, confusion slows them down
- **Fermatas** — dramatic pauses before key revelations

Tensor-midi encodes these as composable, configurable parameters.

## License

MIT
