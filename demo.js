#!/usr/bin/env node
/**
 * TENSOR-MIDI DEMO
 * Generates a sample conversation, captures it, analyzes it as jazz.
 */

const { TensorMidiCapture, analyzeText } = require('./capture.js');
const { JazzAnalyzer } = require('./analysis/jazz-analyzer.js');
const { PulseEngine } = require('./engine/pulse-engine.js');
const fs = require('fs');
const path = require('path');

// ── Sample conversation ──
const sampleMessages = [
  { speaker: 'Riker', text: "Alright team, we've got a problem with the relay bridge. Has anyone looked at the timing logs?", timestamp: Date.now() },
  { speaker: 'Wesley', text: "Oh! I was just looking at that. The beat clock seems to have drifted — the calibration is off?", timestamp: Date.now() + 2000 },
  { speaker: 'Hermes', text: "The logs show a tempo change at tick 482. The downstream agents didn't sync. I predicted this failure three cycles ago. The calibration signal was already degrading.", timestamp: Date.now() + 5000 },
  { speaker: 'Riker', text: "That's not good. The relay bridge is down AGAIN? We need a permanent fix!", timestamp: Date.now() + 9000 },
  { speaker: 'Phi3', text: "i saw that too", timestamp: Date.now() + 11000 },
  { speaker: 'Wesley', text: "Maybe we could try rolling back to the previous calibration? That worked last time! I can run the diagnostic!", timestamp: Date.now() + 13000 },
  { speaker: 'Hermes', text: "Indeed. My analysis suggests the 4-pulse layer is robust, but the 3-pulse has drift when tension rises. The polyrhythm destabilizes under load.", timestamp: Date.now() + 18000 },
  { speaker: 'Riker', text: "Good thinking, Wesley. Let's try the rollback approach.", timestamp: Date.now() + 22000 },
  { speaker: 'Wesley', text: "Running it now! Adjusting tick offset by 3 pulses...", timestamp: Date.now() + 25000 },
  { speaker: 'Hermes', text: "Φ is dropping. The flow state detector confirms improvement.", timestamp: Date.now() + 29000 },
  { speaker: 'Riker', text: "Wait — I see something in the error mask. Bit 3 is set on channel 2. That's the friction point.", timestamp: Date.now() + 33000 },
  { speaker: 'Phi3', text: "nice catch", timestamp: Date.now() + 35000 },
  { speaker: 'Wesley', text: "Yes! That's exactly what Hermes predicted would happen! Nice catch, Riker!", timestamp: Date.now() + 37000 },
  { speaker: 'Riker', text: "There. Fixed it. The calibration is realigned. We're back in flow.", timestamp: Date.now() + 42000 },
  { speaker: 'Hermes', text: "Excellent. Φ is back below threshold. We are in flow once more.", timestamp: Date.now() + 45000 },
  { speaker: 'Wesley', text: "That was kind of fun, actually. Like finding the downbeat after being lost.", timestamp: Date.now() + 48000 },
];

console.log('═══════════════════════════════════════════════');
console.log('  TENSOR-MIDI DEMO');
console.log('  Conversation → MIDI → Jazz Analysis');
console.log('═══════════════════════════════════════════════\n');

// ── Capture ──
const capture = new TensorMidiCapture({
  roomId: 'bar-rail',
  title: 'Relay Bridge Fix',
});

capture.loadMessages(sampleMessages);

const tensor = capture.toJSON();

console.log(`Title:    ${tensor.title}`);
console.log(`Key:      ${tensor.key}`);
console.log(`Tempo:    ${tensor.tempo} BPM`);
console.log(`Time:     ${tensor.timeSignature}`);
console.log(`Duration: ${tensor.duration}s`);
console.log(`Tracks:   ${tensor.trackCount}`);
console.log(`Notes:    ${tensor.noteCount}`);
console.log();

// ── Save files ──
const outDir = path.join(__dirname, 'output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const files = capture.save(outDir);
console.log('Files saved:');
for (const [type, fpath] of Object.entries(files)) {
  console.log(`  ${type}: ${fpath}`);
}
console.log();

// ── Jazz Analysis ──
const analyzer = new JazzAnalyzer(tensor);
const analysis = analyzer.analyze();

console.log(analyzer.generateLeadSheet());
console.log('\n');
console.log('Summary:', analysis.summary);

// ── Pulse Engine Demo ──
console.log('\n═══════════════════════════════════════════════');
console.log('  12-PULSE ENGINE DEMO');
console.log('═══════════════════════════════════════════════\n');

const engine = new PulseEngine({ pulseMs: 500 });
const grid = engine.getPulseGrid();

console.log(`Cycle: ${grid.cycleLength} pulses`);
console.log(`BPM:   ${grid.bpm.toFixed(1)}`);
console.log(`Pulse: ${grid.pulseMs}ms`);
console.log();
console.log('ECN pulses (4-layer):', grid.ecnPulses.map(p => p + 1));
console.log('DMN pulses (3-layer):', grid.dmnPulses.map(p => p + 1));
console.log('Flow pulses (both):  ', grid.coincidentPulses.map(p => p + 1));
console.log('ECN only:            ', grid.ecnOnly.map(p => p + 1));
console.log('DMN only:            ', grid.dmnOnly.map(p => p + 1));
console.log('Silent:              ', grid.silent.map(p => p + 1));
console.log();

// ── Run 2 cycles ──
let pulseCount = 0;
engine.on('pulse', (pulse, tick, cycle) => {
  process.stdout.write(`  [${cycle}.${pulse}] tick=${tick}`);
});

engine.on('ecn', (pulse) => {
  process.stdout.write(' ECN');
});

engine.on('dmn', (pulse) => {
  process.stdout.write(' DMN');
});

engine.on('flow', (tick, cycle) => {
  process.stdout.write(' ★ FLOW');
});

engine.on('cycle', (cycle) => {
  console.log(`\n  — end of cycle ${cycle} —\n`);
});

console.log('Running 2 cycles (12 seconds)...\n');
engine.start();

setTimeout(() => {
  engine.stop();
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Demo complete.');
  console.log(`  Open mixer.html in a browser for the full DAW view.`);
  console.log(`  Run: node server.js then visit http://localhost:3939`);
  console.log('═══════════════════════════════════════════════');
  process.exit(0);
}, 13500);
