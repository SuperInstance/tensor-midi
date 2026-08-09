# TENSOR-MIDI

> The conversation is music. Every syllable is a note. Every agent is a track. The mixer board is the chart plotter. The 12-pulse grid is the clock the fleet runs on.

Treats fleet conversations as jazz performances captured in MIDI, viewable as a DAW/mixer-board, and overlaid on a nautical chart because the boat is moving.

## Architecture

Built on the ECN/DMN polyrhythm research from Slackwater:

```
3:4 POLRHYTHM RESOLVING AT 12

  ECN (4-pulse): ●  ·  ·  ●  ·  ·  ●  ·  ·  ●  ·  ·   (structure, consonance, prediction)
  DMN (3-pulse): ●  ·  ·  ·  ●  ·  ·  ·  ●  ·  ·  ·   (exploration, dissonance, surprise)
  COINCIDENT:    ●  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·   (flow state, relay bridge)
  PULSE:          1  2  3  4  5  6  7  8  9 10 11 12
```

Beat 1: both ECN and DMN fire simultaneously — the flow state, the relay bridge, the resolution.

## Components

### 1. Conversation Capture (`capture.js`)
- Each agent = a MIDI track/channel
- Each message = a note (pitch = sentiment, velocity = emphasis, duration = length)
- Inflection markers: `?` raises pitch, `!` increases velocity, `...` extends duration
- Output: Standard MIDI file (.mid) + JSON tensor + SWMIDI wire format

### 2. Mixer Board (`mixer.html`)
Web-based DAW interface:
- Channel strip per agent with mute/solo/volume
- MIDI note visualization with color-coded sentiment
- 12-pulse grid showing ECN/DMN firing pattern
- Click any note → see the full text message
- Real-time mode: polls The Tap API for live conversations

### 3. Chart Plotter Overlay (`chart-overlay.html`)
Nautical chart view:
- Vessel track (simulated or from sensor data)
- Conversation events plotted at position where they occurred
- Time slider to scrub through chronologically
- Layer toggles: track, events, heatmap, tension zones

### 4. Pulse Engine (`engine/pulse-engine.js`)
The system clock:
- 12-pulse cycle at configurable rate (default 500ms/pulse)
- ECN fires on pulses 1, 4, 7, 10
- DMN fires on pulses 1, 5, 9
- Beat 1 = both = flow state
- Ported from slackwater-rust tempo-core (BeatClock, TempoMap)

### 5. Jazz Analysis (`analysis/jazz-analyzer.js`)
Produces a jazz lead sheet:
- Key identification (major for positive sentiment, minor for conflicted)
- Tempo derivation (message frequency → BPM)
- Form identification (blues, AABA, ABA, through-composed, free)
- Role assignment (leader, soloist, comping, rhythm section, guest)
- Tension & release analysis
- Chord progression generation

### 6. Fleet Radio Integration
Each radio episode becomes a multi-track MIDI file, viewable in the mixer and chart.

## Usage

```bash
# Run the demo
node demo.js

# Start the server
node server.js
# → Mixer: http://localhost:3939
# → Chart: http://localhost:3939/chart-overlay.html

# Analyze a captured conversation
node -e "const fs=require('fs'); const {JazzAnalyzer}=require('./analysis/jazz-analyzer'); const data=JSON.parse(fs.readFileSync('output/relay-bridge-fix.tensor.json','utf8')); const a=new JazzAnalyzer(data); console.log(a.generateLeadSheet());"
```

## Data Model

```json
{
  "track": "wesley",
  "channel": 1,
  "notes": [
    {
      "pitch": 64,
      "velocity": 85,
      "start": 0.000,
      "duration": 2.340,
      "text": "...",
      "sentiment": "curious",
      "color": "#93c5fd"
    }
  ],
  "tempo": 120,
  "key": "Cmin",
  "timeSignature": "12/8"
}
```

## Integration with Existing Systems

- **slackwater-rust/tempo-core**: BeatClock and TempoMap ported to JS
- **slackwater-rust/swmidi**: SWMIDI wire format compatible (8-byte events)
- **slackwater-rust/harmony-core**: FlowStateDetector ported
- **slackwater-rust/tminus-core**: Calibration signal feeds into pulse engine
- **the-tap**: Live conversation data via `/api/room/:id/conversation`
- **scummvm-prototype**: Visual rendering layer compatible

## Origin

Built by Riker for Casey's fleet. The conversation IS the instrument.
