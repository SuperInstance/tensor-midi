// ═══════════════════════════════════════════════════════════════════
// Test Suite — 12-Pulse Engine (tensor-midi)
// Using Node.js built-in test runner
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PPQ, PULSES_PER_BAR, TICKS_PER_PULSE, TICKS_PER_BAR,
  DEFAULT_US_PER_QUARTER,
  bpmToUsPerQuarter, usPerQuarterToBpm,
  tickToPosition, positionToTick,
  BeatClock, PulseGrid,
  timeToTick, detectTempo,
} from '../src/engine.js';

describe('Constants', () => {
  test('PPQ is 96', () => {
    assert.equal(PPQ, 96);
  });
  test('PULSES_PER_BAR is 12', () => {
    assert.equal(PULSES_PER_BAR, 12);
  });
  test('TICKS_PER_PULSE is 48', () => {
    assert.equal(TICKS_PER_PULSE, 48);
  });
  test('TICKS_PER_BAR is 576', () => {
    assert.equal(TICKS_PER_BAR, 576);
  });
  test('DEFAULT_US_PER_QUARTER is 500000', () => {
    assert.equal(DEFAULT_US_PER_QUARTER, 500000);
  });
});

describe('bpmToUsPerQuarter', () => {
  test('120 BPM → 500000 us', () => {
    assert.equal(bpmToUsPerQuarter(120), 500000);
  });
  test('60 BPM → 1000000 us', () => {
    assert.equal(bpmToUsPerQuarter(60), 1000000);
  });
  test('240 BPM → 250000 us', () => {
    assert.equal(bpmToUsPerQuarter(240), 250000);
  });
  test('0 BPM clamps to 1 (no division by zero)', () => {
    assert.equal(bpmToUsPerQuarter(0), 60000000);
  });
  test('negative BPM clamps to 1', () => {
    assert.equal(bpmToUsPerQuarter(-10), 60000000);
  });
});

describe('usPerQuarterToBpm', () => {
  test('500000 us → 120 BPM', () => {
    assert.equal(usPerQuarterToBpm(500000), 120);
  });
  test('1000000 us → 60 BPM', () => {
    assert.equal(usPerQuarterToBpm(1000000), 60);
  });
  test('250000 us → 240 BPM', () => {
    assert.equal(usPerQuarterToBpm(250000), 240);
  });
  test('0 us clamps to 1', () => {
    assert.equal(usPerQuarterToBpm(0), 60000000);
  });
});

describe('tickToPosition', () => {
  test('tick 0 → bar 0, pulse 0, subTick 0', () => {
    assert.deepEqual(tickToPosition(0), { bar: 0, pulse: 0, subTick: 0 });
  });
  test('tick 48 → bar 0, pulse 1, subTick 0', () => {
    assert.deepEqual(tickToPosition(48), { bar: 0, pulse: 1, subTick: 0 });
  });
  test('tick 576 → bar 1, pulse 0, subTick 0', () => {
    assert.deepEqual(tickToPosition(576), { bar: 1, pulse: 0, subTick: 0 });
  });
  test('tick 600 → bar 1, pulse 0, subTick 24', () => {
    assert.deepEqual(tickToPosition(600), { bar: 1, pulse: 0, subTick: 24 });
  });
  test('tick 1152 → bar 2, pulse 0', () => {
    const pos = tickToPosition(1152);
    assert.equal(pos.bar, 2);
    assert.equal(pos.pulse, 0);
  });
  test('tick 624 → bar 1, pulse 1', () => {
    const pos = tickToPosition(624);
    assert.equal(pos.bar, 1);
    assert.equal(pos.pulse, 1);
  });
  test('last pulse of bar 0 is tick 528', () => {
    const pos = tickToPosition(528);
    assert.equal(pos.bar, 0);
    assert.equal(pos.pulse, 11);
  });
});

describe('positionToTick', () => {
  test('bar 0, pulse 0 → tick 0', () => {
    assert.equal(positionToTick(0, 0), 0);
  });
  test('bar 0, pulse 1 → tick 48', () => {
    assert.equal(positionToTick(0, 1), 48);
  });
  test('bar 1, pulse 0 → tick 576', () => {
    assert.equal(positionToTick(1, 0), 576);
  });
  test('bar 1, pulse 3, subTick 24 → tick 744', () => {
    // 576 (bar) + 3*48 (pulses) + 24 (subtick) = 744
    assert.equal(positionToTick(1, 3, 24), 744);
  });
  test('round-trip: position → tick → position', () => {
    for (let bar = 0; bar < 5; bar++) {
      for (let pulse = 0; pulse < 12; pulse++) {
        const tick = positionToTick(bar, pulse);
        const pos = tickToPosition(tick);
        assert.equal(pos.bar, bar);
        assert.equal(pos.pulse, pulse);
      }
    }
  });
});

describe('BeatClock', () => {
  test('default BPM is 120', () => {
    const bc = new BeatClock();
    assert.equal(bc.bpm, 120);
  });
  test('custom BPM constructor', () => {
    const bc = new BeatClock(90);
    assert.ok(Math.abs(bc.bpm - 90) < 0.01, `Expected ~90, got ${bc.bpm}`);
  });
  test('setBpm changes tempo', () => {
    const bc = new BeatClock(120);
    bc.setBpm(140);
    assert.ok(Math.abs(bc.bpm - 140) < 0.01, `Expected ~140, got ${bc.bpm}`);
  });
  test('advance increments tick', () => {
    const bc = new BeatClock();
    bc.advance(100);
    assert.equal(bc.tick, 100);
  });
  test('advance is additive', () => {
    const bc = new BeatClock();
    bc.advance(50);
    bc.advance(50);
    assert.equal(bc.tick, 100);
  });
  test('tickToUs at 120 BPM: 1 tick = 5208 us approx', () => {
    const bc = new BeatClock(120);
    // 500000 us/quarter / 96 PPQ = 5208.33 us per tick
    const us = bc.tickToUs(1);
    assert.ok(us >= 5207 && us <= 5210, `Expected ~5208, got ${us}`);
  });
  test('tickToUs: 96 ticks = 500000 us at 120 BPM', () => {
    const bc = new BeatClock(120);
    const us = bc.tickToUs(96);
    assert.equal(us, 500000);
  });
  test('usToTick: 500000 us → 96 ticks at 120 BPM', () => {
    const bc = new BeatClock(120);
    assert.equal(bc.usToTick(500000), 96);
  });
  test('tickToUs round-trip with tempo change', () => {
    const bc = new BeatClock(120);
    bc.advance(96); // 1 quarter note at 120
    bc.setBpm(60);  // half speed
    bc.advance(96); // 1 quarter note at 60 = 1000000 us
    // Total: 500000 + 1000000 = 1500000 us for 192 ticks
    const us = bc.tickToUs(192);
    assert.equal(us, 1500000);
  });
  test('tempoChanges sorted by tick', () => {
    const bc = new BeatClock(120);
    bc.advance(100);
    bc.setBpm(60);
    bc.advance(100);
    bc.setBpm(140);
    for (let i = 1; i < bc.tempoChanges.length; i++) {
      assert.ok(bc.tempoChanges[i].tick >= bc.tempoChanges[i-1].tick);
    }
  });
});

describe('PulseGrid', () => {
  test('empty grid has no active bars', () => {
    const pg = new PulseGrid();
    assert.deepEqual(pg.activeBars, []);
  });
  test('addEvent creates a bar', () => {
    const pg = new PulseGrid();
    pg.addEvent({ tick: 0, type: 'test' });
    assert.deepEqual(pg.activeBars, [0]);
  });
  test('addEvent at tick 48 → pulse 1', () => {
    const pg = new PulseGrid();
    pg.addEvent({ tick: 48 });
    const events = pg.getPulse(0, 1);
    assert.equal(events.length, 1);
  });
  test('getPulse on empty bar returns []', () => {
    const pg = new PulseGrid();
    assert.deepEqual(pg.getPulse(99, 5), []);
  });
  test('getBarPattern shows filled pulses', () => {
    const pg = new PulseGrid();
    pg.addEvent({ tick: 0 });   // pulse 0
    pg.addEvent({ tick: 48 });  // pulse 1
    pg.addEvent({ tick: 96 });  // pulse 2
    const pattern = pg.getBarPattern(0);
    assert.equal(pattern[0], true);
    assert.equal(pattern[1], true);
    assert.equal(pattern[2], true);
    assert.equal(pattern[3], false);
  });
  test('getBarDensity: 3 of 12 pulses = 0.25', () => {
    const pg = new PulseGrid();
    pg.addEvent({ tick: 0 });
    pg.addEvent({ tick: 48 });
    pg.addEvent({ tick: 96 });
    assert.equal(pg.getBarDensity(0), 3/12);
  });
  test('getBarDensity: empty bar = 0', () => {
    const pg = new PulseGrid();
    assert.equal(pg.getBarDensity(0), 0);
  });
  test('multiple events on same pulse', () => {
    const pg = new PulseGrid();
    pg.addEvent({ tick: 0, id: 1 });
    pg.addEvent({ tick: 0, id: 2 });
    pg.addEvent({ tick: 0, id: 3 });
    const events = pg.getPulse(0, 0);
    assert.equal(events.length, 3);
  });
  test('totalEvents counts across all bars', () => {
    const pg = new PulseGrid();
    pg.addEvent({ tick: 0 });
    pg.addEvent({ tick: 576 });
    pg.addEvent({ tick: 48 });
    assert.equal(pg.totalEvents, 3);
  });
  test('clear removes everything', () => {
    const pg = new PulseGrid();
    pg.addEvent({ tick: 0 });
    pg.addEvent({ tick: 100 });
    pg.clear();
    assert.equal(pg.totalEvents, 0);
    assert.deepEqual(pg.activeBars, []);
  });
  test('events spanning multiple bars', () => {
    const pg = new PulseGrid();
    for (let bar = 0; bar < 5; bar++) {
      pg.addEvent({ tick: bar * 576 });
    }
    assert.equal(pg.activeBars.length, 5);
    assert.equal(pg.totalEvents, 5);
  });
});

describe('timeToTick', () => {
  test('0 ms at 120 BPM → tick 0', () => {
    assert.equal(timeToTick(0, 120), 0);
  });
  test('500 ms at 120 BPM → ~96 ticks', () => {
    // 500000 us / (500000/96) = 96 ticks
    const tick = timeToTick(500, 120);
    assert.ok(tick >= 95 && tick <= 97, `Expected ~96, got ${tick}`);
  });
  test('faster BPM → more ticks for same time', () => {
    const slow = timeToTick(1000, 60);
    const fast = timeToTick(1000, 240);
    assert.ok(fast > slow, `Expected fast (${fast}) > slow (${slow})`);
  });
});

describe('detectTempo', () => {
  test('fewer than 2 messages → default 120', () => {
    assert.equal(detectTempo([]), 120);
    assert.equal(detectTempo([{ timestamp: 100 }]), 120);
  });
  test('500ms intervals → 120 BPM', () => {
    const msgs = [
      { timestamp: 0 },
      { timestamp: 500 },
      { timestamp: 1000 },
      { timestamp: 1500 },
    ];
    assert.equal(detectTempo(msgs), 120);
  });
  test('100ms intervals → 180 BPM', () => {
    const msgs = [
      { timestamp: 0 },
      { timestamp: 100 },
      { timestamp: 200 },
    ];
    // 100ms < 100 boundary → 240? No, the code says < 100 → 240, < 250 → 180
    // 100 is NOT < 100, so it falls to < 250 → 180
    assert.equal(detectTempo(msgs), 180);
  });
  test('2000ms intervals → 60 BPM', () => {
    const msgs = [
      { timestamp: 0 },
      { timestamp: 2000 },
      { timestamp: 4000 },
    ];
    // 2000 is NOT < 2000, so falls to < 5000 → 60
    assert.equal(detectTempo(msgs), 60);
  });
  test('very slow (6000ms) → 40 BPM', () => {
    const msgs = [
      { timestamp: 0 },
      { timestamp: 6000 },
      { timestamp: 12000 },
    ];
    assert.equal(detectTempo(msgs), 40);
  });
  test('tempo detection is order-independent (sorts internally)', () => {
    const msgs = [
      { timestamp: 1500 },
      { timestamp: 0 },
      { timestamp: 500 },
      { timestamp: 1000 },
    ];
    assert.equal(detectTempo(msgs), 120);
  });
});
