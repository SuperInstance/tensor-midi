// ═══════════════════════════════════════════════════════════════════
// Test Suite — Pulse Engine (engine/pulse-engine.js)
// Testing the 12-pulse polyrhythm engine for tensor-midi
// ═══════════════════════════════════════════════════════════════════

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  PPQ, CYCLE_LENGTH, ECN_PULSES, DMN_PULSES, FLOW_PULSE,
  DEFAULT_PULSE_MS, FlowState,
  TempoMap, BeatClock, MusicalPosition, FlowStateDetector, PulseEngine,
} = require('../engine/pulse-engine.js');

// ── Constants ────────────────────────────────────────────────────────

describe('Constants', () => {
  test('PPQ is 96', () => {
    assert.equal(PPQ, 96);
  });
  test('CYCLE_LENGTH is 12', () => {
    assert.equal(CYCLE_LENGTH, 12);
  });
  test('ECN_PULSES are [0, 3, 6, 9]', () => {
    assert.deepEqual(ECN_PULSES, [0, 3, 6, 9]);
  });
  test('DMN_PULSES are [0, 4, 8]', () => {
    assert.deepEqual(DMN_PULSES, [0, 4, 8]);
  });
  test('FLOW_PULSE is 0', () => {
    assert.equal(FLOW_PULSE, 0);
  });
  test('DEFAULT_PULSE_MS is 500', () => {
    assert.equal(DEFAULT_PULSE_MS, 500);
  });
  test('ECN and DMN coincide only at pulse 0', () => {
    const coincident = ECN_PULSES.filter(p => DMN_PULSES.includes(p));
    assert.deepEqual(coincident, [0]);
  });
  test('Silent pulses are [1, 2, 5, 7, 10, 11]', () => {
    const all = Array.from({ length: CYCLE_LENGTH }, (_, i) => i);
    const silent = all.filter(p => !ECN_PULSES.includes(p) && !DMN_PULSES.includes(p));
    assert.deepEqual(silent, [1, 2, 5, 7, 10, 11]);
  });
  test('ECN fires 4 times per cycle', () => {
    assert.equal(ECN_PULSES.length, 4);
  });
  test('DMN fires 3 times per cycle', () => {
    assert.equal(DMN_PULSES.length, 3);
  });
  test('ECN-only pulses are [3, 6, 9]', () => {
    const ecnOnly = ECN_PULSES.filter(p => !DMN_PULSES.includes(p));
    assert.deepEqual(ecnOnly, [3, 6, 9]);
  });
  test('DMN-only pulses are [4, 8]', () => {
    const dmnOnly = DMN_PULSES.filter(p => !ECN_PULSES.includes(p));
    assert.deepEqual(dmnOnly, [4, 8]);
  });
});

// ── FlowState ────────────────────────────────────────────────────────

describe('FlowState', () => {
  test('Has four states', () => {
    assert.equal(Object.keys(FlowState).length, 4);
  });
  test('States are string values', () => {
    assert.equal(FlowState.OUT_OF_FLOW, 'OutOfFlow');
    assert.equal(FlowState.APPROACHING, 'ApproachingFlow');
    assert.equal(FlowState.IN_FLOW, 'InFlow');
    assert.equal(FlowState.DEEP_FLOW, 'DeepFlow');
  });
});

// ── TempoMap ─────────────────────────────────────────────────────────

describe('TempoMap', () => {
  test('Default BPM 120 → 500000 usPerQuarter', () => {
    const map = new TempoMap();
    assert.equal(map.events[0].usPerQuarter, 500000);
  });

  test('Custom BPM constructor', () => {
    const map = new TempoMap(60);
    assert.equal(map.events[0].usPerQuarter, 1000000);
  });

  test('setBPM adds tempo event', () => {
    const map = new TempoMap(120);
    map.setBPM(960, 60);
    assert.equal(map.events.length, 2);
    assert.equal(map.events[1].tick, 960);
    assert.equal(map.events[1].usPerQuarter, 1000000);
  });

  test('setBPM with very low BPM clamps to 1', () => {
    const map = new TempoMap(120);
    map.setBPM(0, 0);
    // Math.max(1, 0) = 1, so 60000000/1 = 60000000
    // tick 0 already exists, so it replaces the default event
    assert.equal(map.events[0].usPerQuarter, 60000000);
    assert.equal(map.events.length, 1);
  });

  test('setBPM with negative BPM clamps to 1', () => {
    const map = new TempoMap(120);
    map.setBPM(0, -100);
    // tick 0 already exists, so it replaces the default event
    assert.equal(map.events[0].usPerQuarter, 60000000);
    assert.equal(map.events.length, 1);
  });

  test('setTempo replaces existing event at same tick', () => {
    const map = new TempoMap(120);
    map.setTempo(0, 750000);
    assert.equal(map.events.length, 1);
    assert.equal(map.events[0].usPerQuarter, 750000);
  });

  test('setTempo inserts at beginning', () => {
    const map = new TempoMap(120);
    map.setTempo(0, 400000);
    assert.equal(map.events[0].usPerQuarter, 400000);
    assert.equal(map.events.length, 1);
  });

  test('setTempo inserts in middle', () => {
    const map = new TempoMap(120);
    map.setBPM(1920, 60);
    map.setBPM(960, 90);
    assert.equal(map.events.length, 3);
    assert.equal(map.events[0].tick, 0);
    assert.equal(map.events[1].tick, 960);
    assert.equal(map.events[2].tick, 1920);
  });

  test('setTempo appends at end', () => {
    const map = new TempoMap(120);
    map.setBPM(960, 60);
    map.setBPM(2880, 90);
    assert.equal(map.events.length, 3);
    assert.equal(map.events[2].tick, 2880);
  });

  test('tempoAt returns correct tempo', () => {
    const map = new TempoMap(120);
    map.setBPM(960, 60);
    assert.equal(map.tempoAt(0).usPerQuarter, 500000);
    assert.equal(map.tempoAt(960).usPerQuarter, 1000000);
    assert.equal(map.tempoAt(1920).usPerQuarter, 1000000);
  });

  test('tempoAt before first event returns first', () => {
    const map = new TempoMap(120);
    assert.equal(map.tempoAt(0).usPerQuarter, 500000);
  });

  test('tickToUs at tick 0 is 0', () => {
    const map = new TempoMap(120);
    assert.equal(map.tickToUs(0), 0);
  });

  test('tickToUs at one quarter note = usPerQuarter', () => {
    const map = new TempoMap(120);
    assert.equal(map.tickToUs(PPQ), 500000);
  });

  test('tickToUs with tempo change', () => {
    const map = new TempoMap(120);
    map.setBPM(PPQ, 60); // After first quarter note, tempo halves
    // First quarter at 500000 us/quarter
    // Second quarter at 1000000 us/quarter
    assert.equal(map.tickToUs(PPQ * 2), 1500000);
  });

  test('usToTick is inverse of tickToUs', () => {
    const map = new TempoMap(120);
    for (const tick of [0, 48, 96, 192, 288, 576, 960]) {
      const us = map.tickToUs(tick);
      const back = map.usToTick(us);
      assert.equal(back, tick, `Failed for tick ${tick}: us=${us}, back=${back}`);
    }
  });

  test('usToTick with tempo change', () => {
    const map = new TempoMap(120);
    map.setBPM(PPQ, 60);
    // 1500000 us should be tick 192
    assert.equal(map.usToTick(1500000), PPQ * 2);
  });

  test('usToTick with zero us', () => {
    const map = new TempoMap(120);
    assert.equal(map.usToTick(0), 0);
  });
});

// ── BeatClock ────────────────────────────────────────────────────────

describe('BeatClock', () => {
  test('Starts at tick 0', () => {
    const clock = new BeatClock();
    assert.equal(clock.currentTick(), 0);
  });

  test('Default BPM is 120', () => {
    const clock = new BeatClock();
    assert.equal(clock.bpm(), 120);
  });

  test('Custom BPM constructor', () => {
    const clock = new BeatClock(90);
    assert.equal(Math.round(clock.bpm()), 90);
  });

  test('advance increases tick', () => {
    const clock = new BeatClock();
    clock.advance(48);
    assert.equal(clock.currentTick(), 48);
  });

  test('advance returns new tick', () => {
    const clock = new BeatClock();
    const result = clock.advance(48);
    assert.equal(result, 48);
  });

  test('advance accumulates', () => {
    const clock = new BeatClock();
    clock.advance(48);
    clock.advance(48);
    assert.equal(clock.currentTick(), 96);
  });

  test('seek to higher tick', () => {
    const clock = new BeatClock();
    clock.advance(48);
    clock.seek(192);
    assert.equal(clock.currentTick(), 192);
  });

  test('seek to same tick is allowed', () => {
    const clock = new BeatClock();
    clock.advance(48);
    assert.doesNotThrow(() => clock.seek(48));
  });

  test('seek backward throws', () => {
    const clock = new BeatClock();
    clock.advance(100);
    assert.throws(
      () => clock.seek(50),
      /monotonic/i
    );
  });

  test('setBPM changes tempo', () => {
    const clock = new BeatClock(120);
    clock.advance(48);
    clock.setBPM(60);
    assert.equal(Math.round(clock.bpm()), 60);
  });

  test('currentUs returns microseconds since tick 0', () => {
    const clock = new BeatClock(120);
    clock.advance(PPQ); // One quarter note
    assert.equal(clock.currentUs(), 500000);
  });

  test('reset returns to zero', () => {
    const clock = new BeatClock();
    clock.advance(500);
    clock.reset();
    assert.equal(clock.currentTick(), 0);
  });

  test('reset restores default BPM', () => {
    const clock = new BeatClock(90);
    clock.advance(100);
    clock.reset();
    assert.equal(clock.bpm(), 120); // default after reset
  });
});

// ── MusicalPosition ──────────────────────────────────────────────────

describe('MusicalPosition', () => {
  test('fromTick at 0 is bar 0, beat 0, subTick 0', () => {
    const pos = MusicalPosition.fromTick(0);
    assert.equal(pos.bar, 0);
    assert.equal(pos.beat, 0);
    assert.equal(pos.subTick, 0);
  });

  test('fromTick at one quarter note = beat 1', () => {
    const pos = MusicalPosition.fromTick(PPQ);
    assert.equal(pos.bar, 0);
    assert.equal(pos.beat, 1);
    assert.equal(pos.subTick, 0);
  });

  test('fromTick at one bar (4 beats)', () => {
    const pos = MusicalPosition.fromTick(PPQ * 4);
    assert.equal(pos.bar, 1);
    assert.equal(pos.beat, 0);
    assert.equal(pos.subTick, 0);
  });

  test('fromTick with subTick', () => {
    const pos = MusicalPosition.fromTick(PPQ + 24);
    assert.equal(pos.bar, 0);
    assert.equal(pos.beat, 1);
    assert.equal(pos.subTick, 24);
  });

  test('fromTick with custom beatsPerBar', () => {
    const pos = MusicalPosition.fromTick(PPQ * 3, 3);
    assert.equal(pos.bar, 1);
    assert.equal(pos.beat, 0);
  });

  test('toTick is inverse of fromTick', () => {
    for (const tick of [0, 24, 48, 96, 192, 384, 576]) {
      const pos = MusicalPosition.fromTick(tick);
      assert.equal(pos.toTick(), tick, `Failed for tick ${tick}`);
    }
  });

  test('toTick with custom beatsPerBar', () => {
    const pos = new MusicalPosition(1, 2, 24);
    assert.equal(pos.toTick(3), PPQ * 3 + PPQ * 2 + 24);
  });

  test('pulseInCycle at tick 0 is pulse 0', () => {
    assert.equal(MusicalPosition.pulseInCycle(0), 0);
  });

  test('pulseInCycle at tick 48 (one pulse) is pulse 1', () => {
    assert.equal(MusicalPosition.pulseInCycle(48), 1);
  });

  test('pulseInCycle at tick 576 (one bar) wraps to pulse 0', () => {
    assert.equal(MusicalPosition.pulseInCycle(576), 0);
  });

  test('pulseInCycle at tick 144 is pulse 3 (ECN beat)', () => {
    assert.equal(MusicalPosition.pulseInCycle(144), 3);
  });

  test('pulseInCycle at tick 192 is pulse 4 (DMN beat)', () => {
    assert.equal(MusicalPosition.pulseInCycle(192), 4);
  });

  test('pulseInCycle wraps correctly through multiple cycles', () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let pulse = 0; pulse < 12; pulse++) {
        const tick = cycle * 576 + pulse * 48;
        assert.equal(
          MusicalPosition.pulseInCycle(tick),
          pulse,
          `Failed at cycle ${cycle}, pulse ${pulse}, tick ${tick}`
        );
      }
    }
  });
});

// ── FlowStateDetector ────────────────────────────────────────────────

describe('FlowStateDetector', () => {
  test('Starts in OUT_OF_FLOW', () => {
    const det = new FlowStateDetector();
    assert.equal(det.state, FlowState.OUT_OF_FLOW);
  });

  test('Default phiThreshold is 0.05', () => {
    const det = new FlowStateDetector();
    assert.equal(det.phiThreshold, 0.05);
  });

  test('Default deepFlowThreshold is phiThreshold/3', () => {
    const det = new FlowStateDetector(0.09);
    assert.equal(det.deepFlowThreshold, 0.03);
  });

  test('High phi keeps in OUT_OF_FLOW', () => {
    const det = new FlowStateDetector();
    for (let i = 0; i < 20; i++) {
      det.observe(1.0);
    }
    assert.equal(det.state, FlowState.OUT_OF_FLOW);
  });

  test('Low phi transitions to APPROACHING then IN_FLOW', () => {
    const det = new FlowStateDetector(0.05, 10);
    // First few observations with low phi → APPROACHING
    for (let i = 0; i < 4; i++) {
      det.observe(0.01);
    }
    assert.equal(det.state, FlowState.APPROACHING);
    // Continue until minWindow reached → IN_FLOW
    for (let i = 0; i < 6; i++) {
      det.observe(0.01);
    }
    assert.equal(det.state, FlowState.IN_FLOW);
  });

  test('Very low phi transitions to DEEP_FLOW', () => {
    const det = new FlowStateDetector(0.05, 10);
    // Get to IN_FLOW first
    for (let i = 0; i < 10; i++) {
      det.observe(0.01);
    }
    assert.equal(det.state, FlowState.IN_FLOW);
    // Now push to DEEP_FLOW with very low phi
    for (let i = 0; i < 10; i++) {
      det.observe(0.001); // well below deepFlowThreshold
    }
    assert.equal(det.state, FlowState.DEEP_FLOW);
  });

  test('High phi from IN_FLOW goes to APPROACHING', () => {
    const det = new FlowStateDetector(0.05, 10);
    for (let i = 0; i < 10; i++) det.observe(0.01);
    assert.equal(det.state, FlowState.IN_FLOW);
    det.observe(0.1); // above threshold
    assert.equal(det.state, FlowState.APPROACHING);
  });

  test('High phi from APPROACHING goes to OUT_OF_FLOW', () => {
    const det = new FlowStateDetector(0.05, 10);
    for (let i = 0; i < 4; i++) det.observe(0.01);
    assert.equal(det.state, FlowState.APPROACHING);
    det.observe(0.2); // above threshold * 2
    assert.equal(det.state, FlowState.OUT_OF_FLOW);
  });

  test('inFlow() returns true for IN_FLOW and DEEP_FLOW', () => {
    const det = new FlowStateDetector(0.05, 10);
    assert.equal(det.inFlow(), false);
    for (let i = 0; i < 10; i++) det.observe(0.01);
    assert.equal(det.inFlow(), true);
  });

  test('lastPhi returns last observed value', () => {
    const det = new FlowStateDetector();
    det.observe(0.42);
    assert.equal(det.lastPhi(), 0.42);
  });

  test('lastPhi returns 1.0 on empty history', () => {
    const det = new FlowStateDetector();
    assert.equal(det.lastPhi(), 1.0);
  });

  test('reset clears state', () => {
    const det = new FlowStateDetector(0.05, 10);
    for (let i = 0; i < 10; i++) det.observe(0.01);
    det.reset();
    assert.equal(det.state, FlowState.OUT_OF_FLOW);
    assert.equal(det.phiHistory.length, 0);
    assert.equal(det.sustainedCount, 0);
  });

  test('phiHistory is bounded by maxHistory', () => {
    const det = new FlowStateDetector();
    for (let i = 0; i < 600; i++) {
      det.observe(0.5);
    }
    assert.ok(det.phiHistory.length <= 500, `History was ${det.phiHistory.length}, expected <= 500`);
  });

  test('Custom thresholds work', () => {
    const det = new FlowStateDetector(0.2, 5);
    for (let i = 0; i < 5; i++) {
      det.observe(0.1); // Below 0.2 threshold
    }
    assert.equal(det.state, FlowState.IN_FLOW);
  });

  test('Zero phi always advances toward flow', () => {
    const det = new FlowStateDetector(0.05, 3);
    for (let i = 0; i < 3; i++) {
      det.observe(0.0);
    }
    assert.equal(det.state, FlowState.IN_FLOW);
  });

  test('DEEP_FLOW recovery to IN_FLOW', () => {
    const det = new FlowStateDetector(0.05, 10);
    // Get to deep flow
    for (let i = 0; i < 10; i++) det.observe(0.01);
    for (let i = 0; i < 10; i++) det.observe(0.001);
    assert.equal(det.state, FlowState.DEEP_FLOW);
    // Phi rises above deepFlowThreshold but below phiThreshold
    det.observe(0.03); // between deep (0.0167) and phi (0.05)
    assert.equal(det.state, FlowState.IN_FLOW);
  });

  test('DEEP_FLOW recovery to APPROACHING on high phi', () => {
    const det = new FlowStateDetector(0.05, 10);
    for (let i = 0; i < 10; i++) det.observe(0.01);
    for (let i = 0; i < 10; i++) det.observe(0.001);
    assert.equal(det.state, FlowState.DEEP_FLOW);
    det.observe(0.2); // above phiThreshold
    assert.equal(det.state, FlowState.APPROACHING);
  });

  test('NaN phi does not trigger crash', () => {
    const det = new FlowStateDetector();
    // NaN phi — all comparisons return false, so it falls through
    // to the else branch (sustainedCount = 0)
    assert.doesNotThrow(() => det.observe(NaN));
    assert.equal(det.state, FlowState.OUT_OF_FLOW);
  });
});

// ── PulseEngine ──────────────────────────────────────────────────────

describe('PulseEngine', () => {
  test('Constructor sets defaults', () => {
    const engine = new PulseEngine();
    assert.equal(engine.pulseNumber, 0);
    assert.equal(engine.cycleCount, 0);
    assert.equal(engine.totalPulses, 0);
    assert.equal(engine.running, false);
    assert.equal(engine.pulseMs, DEFAULT_PULSE_MS);
  });

  test('Constructor with custom options', () => {
    const engine = new PulseEngine({ pulseMs: 250, bpm: 90 });
    assert.equal(engine.pulseMs, 250);
    assert.equal(engine.beatClock.bpm(), 90);
  });

  test('state() returns snapshot', () => {
    const engine = new PulseEngine();
    const s = engine.state();
    assert.equal(s.pulse, 0);
    assert.equal(s.cycle, 0);
    assert.equal(s.totalPulses, 0);
    assert.equal(s.running, false);
    assert.equal(s.flowState, FlowState.OUT_OF_FLOW);
  });

  test('getPulseGrid returns correct structure', () => {
    const engine = new PulseEngine();
    const grid = engine.getPulseGrid();
    assert.equal(grid.cycleLength, 12);
    assert.deepEqual(grid.ecnPulses, [0, 3, 6, 9]);
    assert.deepEqual(grid.dmnPulses, [0, 4, 8]);
    assert.equal(grid.flowPulse, 0);
    assert.deepEqual(grid.coincidentPulses, [0]);
    assert.deepEqual(grid.ecnOnly, [3, 6, 9]);
    assert.deepEqual(grid.dmnOnly, [4, 8]);
    assert.deepEqual(grid.silent, [1, 2, 5, 7, 10, 11]);
  });

  test('getPulseGrid has 12 total classified pulses', () => {
    const engine = new PulseEngine();
    const grid = engine.getPulseGrid();
    const total = grid.coincidentPulses.length + grid.ecnOnly.length +
                  grid.dmnOnly.length + grid.silent.length;
    assert.equal(total, 12);
  });

  test('setTempo updates BPM and pulseMs', () => {
    const engine = new PulseEngine();
    engine.setTempo(60);
    // 60 BPM: pulseMs = 60000 / 60 / 2 = 500
    assert.equal(engine.pulseMs, 500);
    assert.equal(Math.round(engine.beatClock.bpm()), 60);
  });

  test('setTempo to 120 BPM → pulseMs 250', () => {
    const engine = new PulseEngine();
    engine.setTempo(120);
    // 120 BPM: pulseMs = 60000 / 120 / 2 = 250
    assert.equal(engine.pulseMs, 250);
  });

  test('start sets running to true', () => {
    const engine = new PulseEngine({ pulseMs: 10000 }); // Very slow to avoid multiple ticks
    engine.start();
    assert.equal(engine.running, true);
    engine.stop();
  });

  test('stop sets running to false', () => {
    const engine = new PulseEngine({ pulseMs: 10000 });
    engine.start();
    engine.stop();
    assert.equal(engine.running, false);
  });

  test('start is idempotent', () => {
    const engine = new PulseEngine({ pulseMs: 10000 });
    engine.start();
    engine.start(); // Should not throw or double-set interval
    assert.equal(engine.running, true);
    engine.stop();
  });

  test('pulse event fires with correct args', (_, done) => {
    const engine = new PulseEngine({ pulseMs: 10000 });
    engine.once('pulse', (pulse, tick, cycle) => {
      assert.equal(pulse, 0);
      assert.equal(tick, 0);
      assert.equal(cycle, 0);
      engine.stop();
      done();
    });
    engine.start();
  });

  test('ecn event fires on pulse 0', (_, done) => {
    const engine = new PulseEngine({ pulseMs: 10000 });
    engine.once('ecn', (pulse, tick) => {
      assert.equal(pulse, 0);
      engine.stop();
      done();
    });
    engine.start();
  });

  test('dmn event fires on pulse 0', (_, done) => {
    const engine = new PulseEngine({ pulseMs: 10000 });
    engine.once('dmn', (pulse, tick) => {
      assert.equal(pulse, 0);
      engine.stop();
      done();
    });
    engine.start();
  });

  test('flow event fires on pulse 0', (_, done) => {
    const engine = new PulseEngine({ pulseMs: 10000 });
    engine.once('flow', (tick, cycle) => {
      assert.equal(tick, 0);
      assert.equal(cycle, 0);
      engine.stop();
      done();
    });
    engine.start();
  });

  test('Multiple listeners can attach (setMaxListeners 50)', () => {
    const engine = new PulseEngine();
    let count = 0;
    for (let i = 0; i < 30; i++) {
      engine.on('pulse', () => count++);
    }
    // Should not throw MaxListenersExceededWarning
    assert.equal(engine.getMaxListeners(), 50);
  });
});
