// ═══════════════════════════════════════════════════════════════════
// Test Suite — Clip: conversation as gesture (tensor-midi)
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Clip } from '../src/clip.js';
import { EventType, Friction } from '../src/swmidi.js';

// Helper: a NoteOn event at a tick with given coordinates.
function ev({ channel = 0, pitch = 0, velocity = 64, errorMask = 0, tick = 0, eventType = EventType.NoteOn }) {
  return { eventType, channel, pitch, velocity, errorMask, tick };
}

describe('Clip construction', () => {
  test('sorts events by tick', () => {
    const c = new Clip([ev({ tick: 30 }), ev({ tick: 10 }), ev({ tick: 20 })]);
    assert.deepEqual(
      c.events.map((e) => e.tick),
      [10, 20, 30]
    );
  });
  test('length reflects event count', () => {
    assert.equal(new Clip([ev({ tick: 0 }), ev({ tick: 1 })]).length, 2);
    assert.equal(new Clip().length, 0);
  });
});

describe('gesture geometry — graceful on degenerate input', () => {
  test('empty clip has zero geometry', () => {
    const c = new Clip([]);
    assert.equal(c.arcLength(), 0);
    assert.equal(c.bendingEnergy(), 0);
    assert.deepEqual(c.tangent(), [0, 0, 0, 0]);
    assert.equal(c.frictionRatio(), 0);
  });
  test('single event has zero travel and zero heading', () => {
    const c = new Clip([ev({ pitch: 40, tick: 5 })]);
    assert.equal(c.arcLength(), 0);
    assert.deepEqual(c.tangent(), [0, 0, 0, 0]);
  });
});

describe('arcLength — travel through abstraction space', () => {
  test('a steady climb in one axis has positive length', () => {
    const c = new Clip([
      ev({ pitch: 0, tick: 0 }),
      ev({ pitch: 40, tick: 1 }),
      ev({ pitch: 80, tick: 2 }),
    ]);
    assert.ok(c.arcLength() > 0);
  });
  test('a wildly varying exchange travels farther than a steady one', () => {
    const steady = new Clip([
      ev({ pitch: 0, velocity: 10, tick: 0 }),
      ev({ pitch: 10, velocity: 12, tick: 1 }),
      ev({ pitch: 20, velocity: 14, tick: 2 }),
      ev({ pitch: 30, velocity: 16, tick: 3 }),
    ]);
    const wild = new Clip([
      ev({ pitch: 0, velocity: 10, tick: 0 }),
      ev({ pitch: 120, velocity: 120, tick: 1 }),
      ev({ pitch: 5, velocity: 5, tick: 2 }),
      ev({ pitch: 110, velocity: 115, tick: 3 }),
    ]);
    assert.ok(wild.arcLength() > steady.arcLength());
  });
});

describe('bendingEnergy — turning of the gesture', () => {
  test('a straight line barely bends; a zig-zag bends more', () => {
    // Straight: pitch increases uniformly, nothing else changes.
    const line = new Clip([
      ev({ pitch: 0, tick: 0 }),
      ev({ pitch: 30, tick: 1 }),
      ev({ pitch: 60, tick: 2 }),
      ev({ pitch: 90, tick: 3 }),
    ]);
    // Zig-zag: velocity axis alternates.
    const zig = new Clip([
      ev({ pitch: 0, velocity: 0, tick: 0 }),
      ev({ pitch: 30, velocity: 120, tick: 1 }),
      ev({ pitch: 60, velocity: 0, tick: 2 }),
      ev({ pitch: 90, velocity: 120, tick: 3 }),
    ]);
    assert.ok(line.bendingEnergy() < 1e-6);
    assert.ok(zig.bendingEnergy() > line.bendingEnergy());
  });
});

describe('twistEnergy — third order (torsion) leaving the plane', () => {
  // A conversation veering inside the (pitch, velocity) plane: bends, but never
  // leaves the plane → zero twist. channel and friction held constant.
  const planar = new Clip(
    Array.from({ length: 8 }, (_, i) => {
      const a = i * 0.6;
      return ev({
        channel: 0,
        pitch: Math.round(63 + 40 * Math.cos(a)),
        velocity: Math.round(63 + 40 * Math.sin(a)),
        tick: i,
      });
    })
  );
  // The same veer, but steadily recruiting the channel axis each step → a helix
  // through abstraction space → positive twist.
  const helix = new Clip(
    Array.from({ length: 8 }, (_, i) => {
      const a = i * 0.6;
      return ev({
        channel: i,
        pitch: Math.round(63 + 40 * Math.cos(a)),
        velocity: Math.round(63 + 40 * Math.sin(a)),
        tick: i,
      });
    })
  );

  test('a planar veer does not twist; a helix does', () => {
    assert.ok(planar.twistEnergy() < 1e-6, `planar twist ${planar.twistEnergy()}`);
    assert.ok(helix.twistEnergy() > planar.twistEnergy());
    assert.ok(Number.isFinite(helix.twistEnergy()));
  });

  test('planarity is bounded and high for a flat veer', () => {
    assert.ok(planar.planarity() > 0.95);
    assert.ok(planar.planarity() <= 1 && planar.planarity() >= 0);
    assert.ok(helix.planarity() < planar.planarity());
    // Too-short clips are trivially planar.
    assert.equal(new Clip([ev({ tick: 0 }), ev({ tick: 1 })]).planarity(), 1);
    assert.equal(new Clip([]).twistEnergy(), 0);
  });
});

describe('tangent — the conversation heading (d_mu)', () => {
  test('is a unit vector when the clip moves', () => {
    const c = new Clip([ev({ pitch: 0, tick: 0 }), ev({ pitch: 40, tick: 1 }), ev({ pitch: 90, tick: 2 })]);
    const t = c.tangent();
    const n = Math.sqrt(t.reduce((s, x) => s + x * x, 0));
    assert.ok(Math.abs(n - 1) < 1e-9);
  });
});

describe('frictionRatio', () => {
  test('counts events carrying friction', () => {
    const c = new Clip([
      ev({ tick: 0, errorMask: Friction.None }),
      ev({ tick: 1, errorMask: Friction.Timeout }),
      ev({ tick: 2, errorMask: Friction.SyntaxError | Friction.TypeMismatch }),
      ev({ tick: 3, errorMask: Friction.None }),
    ]);
    assert.equal(c.frictionRatio(), 0.5);
  });
});

describe('toPhraseEvents — the bridge to musician-soul', () => {
  test('exports NoteOns as (pitch, velocity, duration, tickOffset) tuples', () => {
    const c = new Clip([
      ev({ pitch: 0, velocity: 80, tick: 0 }),
      ev({ pitch: 10, velocity: 90, tick: 96 }),
      ev({ pitch: 40, velocity: 70, tick: 240 }),
    ]);
    const notes = c.toPhraseEvents();
    assert.equal(notes.length, 3);
    // First note: no leading gap, duration = gap to next.
    assert.equal(notes[0].tickOffset, 0);
    assert.equal(notes[0].duration, 96);
    assert.equal(notes[0].velocity, 80);
    // Second note: gap since previous, duration to next.
    assert.equal(notes[1].tickOffset, 96);
    assert.equal(notes[1].duration, 144);
    // Pitches land in the playable band C2..C5 (48..84).
    for (const n of notes) assert.ok(n.pitch >= 48 && n.pitch <= 84);
    // Last note gets a default duration of at least 1.
    assert.ok(notes[2].duration >= 1);
  });

  test('skips non-NoteOn events', () => {
    const c = new Clip([
      ev({ pitch: 0, tick: 0, eventType: EventType.NoteOn }),
      ev({ pitch: 2, tick: 1, eventType: EventType.ControlChange }),
      ev({ pitch: 4, tick: 2, eventType: EventType.NoteOn }),
    ]);
    assert.equal(c.toPhraseEvents().length, 2);
  });

  test('empty clip exports nothing', () => {
    assert.deepEqual(new Clip([]).toPhraseEvents(), []);
  });
});
