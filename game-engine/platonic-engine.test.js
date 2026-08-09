/**
 * Tests for the Platonic Randomness Game Engine
 *
 * Uses Node's built-in test runner. Run with:
 *   node --test game-engine/platonic-engine.test.js
 * or from the project root:
 *   npm test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EventType,
  encodeEvent,
  encodeStream,
} from '../src/swmidi.js';
import {
  PlatonicEngine,
  SYSTEM_CHANNELS,
  CHANNEL_BY_SYSTEM,
  SOLID_MAP,
  META_COMMANDS,
  COMBAT_MOVES,
  SOCIAL_ACTIONS,
  WEATHER_STATES,
  RESOURCE_TYPES,
  DIRECTIONS,
} from './platonic-engine.js';
import { VERTEX_COUNTS } from './platonic-rng.js';

// ── Helpers ───────────────────────────────────────────────────────────

function eventBytes(overrides = {}) {
  return encodeEvent({
    eventType: EventType.NoteOn,
    channel: 0,
    pitch: 1,
    velocity: 64,
    errorMask: 0,
    tick: 0,
    ...overrides,
  });
}

// ── SWMIDI Compatibility ──────────────────────────────────────────────

describe('SWMIDI compatibility', () => {
  test('encodeGameEvent produces exactly 8 bytes', () => {
    const bytes = PlatonicEngine.encodeGameEvent('combat', 1, 64, 96);
    assert.equal(bytes.length, 8);
  });

  test('encodeGameEvent round-trips through processEvent', () => {
    const engine = new PlatonicEngine('roundtrip');
    engine.addPlayer(7, 'Seven');
    const bytes = PlatonicEngine.encodeGameEvent('resource', 7, 100, 1234);
    const { system, result } = engine.processEvent(bytes);
    assert.equal(system, 'resource');
    assert.equal(result.amount, 1 + Math.floor(100 / 32));
  });

  test('processEvent accepts decoded event objects', () => {
    const engine = new PlatonicEngine('decoded');
    engine.addPlayer(3, 'Tres');
    const event = {
      eventType: EventType.NoteOn,
      channel: CHANNEL_BY_SYSTEM.combat,
      pitch: 3,
      velocity: 40,
      errorMask: 0,
      tick: 48,
    };
    const { system, result } = engine.processEvent(event);
    assert.equal(system, 'combat');
    assert.ok(COMBAT_MOVES.includes(result.playerMove));
  });

  test('processEvent rejects non-event input', () => {
    const engine = new PlatonicEngine();
    assert.throws(() => engine.processEvent('not an event'), /processEvent expects/);
  });

  test('processEvent rejects truncated SWMIDI bytes', () => {
    const engine = new PlatonicEngine();
    assert.throws(() => engine.processEvent(new Uint8Array(7)), /Truncated/);
  });
});

// ── Initialization ────────────────────────────────────────────────────

describe('initialization', () => {
  test('position counts match Platonic solid vertex counts', () => {
    const engine = new PlatonicEngine('init');
    assert.equal(engine.positions.combat.length, VERTEX_COUNTS.tetrahedron);
    assert.equal(engine.positions.social.length, VERTEX_COUNTS.icosahedron);
    assert.equal(engine.positions.weather.length, VERTEX_COUNTS.dodecahedron);
    assert.equal(engine.positions.resource.length, VERTEX_COUNTS.cube);
    assert.equal(engine.positions.exploration.length, VERTEX_COUNTS.octahedron);
  });

  test('system channels map to the right solids', () => {
    assert.equal(SOLID_MAP[SYSTEM_CHANNELS[0]], 'tetrahedron');
    assert.equal(SOLID_MAP[SYSTEM_CHANNELS[1]], 'icosahedron');
    assert.equal(SOLID_MAP[SYSTEM_CHANNELS[2]], 'dodecahedron');
    assert.equal(SOLID_MAP[SYSTEM_CHANNELS[3]], 'cube');
    assert.equal(SOLID_MAP[SYSTEM_CHANNELS[4]], 'octahedron');
  });

  test('weather starts one-hot (exactly one active state)', () => {
    const engine = new PlatonicEngine('weather-init');
    const active = engine.positions.weather.filter((p) => p.value > 0);
    assert.equal(active.length, 1);
    assert.equal(active[0].index, 0);
  });

  test('addPlayer registers player with defaults', () => {
    const engine = new PlatonicEngine();
    const p = engine.addPlayer(1, 'Alice');
    assert.equal(p.name, 'Alice');
    assert.equal(p.combat.health, 100);
    assert.equal(p.social.reputation, 50);
    assert.equal(p.score, 0);
  });

  test('duplicate player id throws', () => {
    const engine = new PlatonicEngine();
    engine.addPlayer(1, 'Alice');
    assert.throws(() => engine.addPlayer(1, 'Bob'), /already exists/);
  });
});

// ── Combat (Tetrahedron) ──────────────────────────────────────────────

describe('combat', () => {
  test('NoteOn combat returns valid outcome', () => {
    const engine = new PlatonicEngine('combat-outcome');
    engine.addPlayer(1, 'Fighter');
    const bytes = PlatonicEngine.encodeGameEvent('combat', 1, 80, 0);
    const { system, result, narrative } = engine.processEvent(bytes);
    assert.equal(system, 'combat');
    assert.ok(['strike', 'parry', 'feint', 'riposte'].includes(result.playerMove));
    assert.ok(['strike', 'parry', 'feint', 'riposte'].includes(result.opponentMove));
    assert.ok(['win', 'lose', 'clash'].includes(result.outcome));
    assert.ok(result.damage >= 0);
    assert.ok(narrative.length > 0);
  });

  test('combat positions evolve after multiple events', () => {
    const engine = new PlatonicEngine('combat-evolve');
    engine.addPlayer(1, 'Fighter');
    const initial = engine.positions.combat.map((p) => p.value);
    for (let i = 0; i < 12; i++) {
      engine.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 50, i));
    }
    const changed = engine.positions.combat.some((p, i) => p.value !== initial[i]);
    assert.ok(changed, 'combat positions should evolve');
  });

  test('combat damage reduces player health on loss', () => {
    const engine = new PlatonicEngine('combat-damage');
    engine.addPlayer(1, 'Fighter');
    let healthDropped = false;
    for (let i = 0; i < 30; i++) {
      const before = engine.players.get(1).combat.health;
      engine.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 127, i));
      const after = engine.players.get(1).combat.health;
      if (after < before) healthDropped = true;
    }
    assert.ok(healthDropped, 'player should take damage at least once in 30 rolls');
  });

  test('NoteOff combat recovers health', () => {
    const engine = new PlatonicEngine('combat-recover');
    engine.addPlayer(1, 'Fighter');
    engine.players.get(1).combat.health = 50;
    engine.processEvent(encodeEvent({
      eventType: EventType.NoteOff,
      channel: CHANNEL_BY_SYSTEM.combat,
      pitch: 1,
      velocity: 127,
      errorMask: 0,
      tick: 0,
    }));
    assert.ok(engine.players.get(1).combat.health > 50);
  });
});

// ── Social (Icosahedron) ──────────────────────────────────────────────

describe('social', () => {
  test('social action targets a pulse 1-12', () => {
    const engine = new PlatonicEngine('social-pulse');
    engine.addPlayer(1, 'Diplomat');
    for (let i = 0; i < 20; i++) {
      const { result } = engine.processEvent(PlatonicEngine.encodeGameEvent('social', 1, 60, i));
      assert.ok(result.targetPulse >= 1 && result.targetPulse <= 12);
      assert.ok(SOCIAL_ACTIONS.includes(result.action));
    }
  });

  test('social positions evolve', () => {
    const engine = new PlatonicEngine('social-evolve');
    const initial = engine.positions.social.map((p) => p.value);
    for (let i = 0; i < 24; i++) {
      engine.processEvent(PlatonicEngine.encodeGameEvent('social', 1, 50, i));
    }
    const changed = engine.positions.social.some((p, i) => p.value !== initial[i]);
    assert.ok(changed);
  });

  test('NOTE_ON from SWMIDI feeds social pulse grid', () => {
    const engine = new PlatonicEngine('social-note');
    engine.addPlayer(1, 'Diplomat');
    const bytes = encodeEvent({
      eventType: EventType.NoteOn,
      channel: CHANNEL_BY_SYSTEM.social,
      pitch: 1,
      velocity: 100,
      errorMask: 0,
      tick: 96,
    });
    const { system } = engine.processEvent(bytes);
    assert.equal(system, 'social');
  });
});

// ── Weather (Dodecahedron) ────────────────────────────────────────────

describe('weather', () => {
  test('weather produces valid state and severity', () => {
    const engine = new PlatonicEngine('weather');
    for (let i = 0; i < 10; i++) {
      const { result } = engine.processEvent(PlatonicEngine.encodeGameEvent('weather', 0, 40, i));
      assert.ok(WEATHER_STATES.includes(result.current));
      assert.ok(result.severity >= 0);
    }
  });

  test('weather stays one-hot after evolution', () => {
    const engine = new PlatonicEngine('weather-onehot');
    for (let i = 0; i < 20; i++) {
      engine.processEvent(PlatonicEngine.encodeGameEvent('weather', 0, 30, i));
    }
    const active = engine.positions.weather.filter((p) => p.value > 0);
    assert.equal(active.length, 1);
  });

  test('turn end evolves weather', () => {
    const engine = new PlatonicEngine('weather-turn');
    const before = engine.positions.weather.findIndex((p) => p.value > 0);
    for (let i = 0; i < 10; i++) {
      engine.processEvent(PlatonicEngine.encodeMetaEvent('turnEnd', i));
    }
    const after = engine.positions.weather.findIndex((p) => p.value > 0);
    assert.ok(after >= 0 && after < 20);
  });
});

// ── Resources (Cube) ──────────────────────────────────────────────────

describe('resources', () => {
  test('resource rolls are 2d4 in range 2-8', () => {
    const engine = new PlatonicEngine('resource-range');
    engine.addPlayer(1, 'Gatherer');
    const totals = [];
    for (let i = 0; i < 200; i++) {
      const { result } = engine.processEvent(PlatonicEngine.encodeGameEvent('resource', 1, 30, i));
      assert.ok(result.total >= 2 && result.total <= 8);
      totals.push(result.total);
    }
    assert.equal(Math.min(...totals), 2);
    assert.equal(Math.max(...totals), 8);
  });

  test('resource distribution peaks near the middle', () => {
    const engine = new PlatonicEngine('resource-dist');
    const totals = [];
    for (let i = 0; i < 300; i++) {
      const { result } = engine.processEvent(PlatonicEngine.encodeGameEvent('resource', 1, 30, i));
      totals.push(result.total);
    }
    const counts = totals.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
    const mode = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    assert.ok(mode >= 4 && mode <= 6, `mode should be near 5, got ${mode}`);
  });

  test('resources accumulate for the player', () => {
    const engine = new PlatonicEngine('resource-accum');
    engine.addPlayer(1, 'Miner');
    for (let i = 0; i < 50; i++) {
      engine.processEvent(PlatonicEngine.encodeGameEvent('resource', 1, 50, i));
    }
    const total = Object.values(engine.players.get(1).resources).reduce((a, b) => a + b, 0);
    assert.ok(total > 0);
  });

  test('ControlChange adjusts a resource node', () => {
    const engine = new PlatonicEngine('resource-cc');
    const before = engine.positions.resource[0].value;
    engine.processEvent(encodeEvent({
      eventType: EventType.ControlChange,
      channel: CHANNEL_BY_SYSTEM.resource,
      pitch: 0,
      velocity: 127,
      errorMask: 0,
      tick: 0,
    }));
    assert.ok(engine.positions.resource[0].value > before);
  });
});

// ── Exploration (Octahedron) ──────────────────────────────────────────

describe('exploration', () => {
  test('exploration uses cardinal directions', () => {
    const engine = new PlatonicEngine('explore');
    engine.addPlayer(1, 'Scout');
    const directions = new Set();
    for (let i = 0; i < 30; i++) {
      const { result } = engine.processEvent(PlatonicEngine.encodeGameEvent('exploration', 1, 60, i));
      assert.ok(DIRECTIONS.includes(result.direction));
      assert.ok(result.distance >= 1);
      directions.add(result.direction);
    }
    assert.ok(directions.size >= 3, 'should see multiple directions');
  });

  test('exploration discoveries increase score', () => {
    const engine = new PlatonicEngine('explore-score');
    engine.addPlayer(1, 'Scout');
    const initial = engine.players.get(1).score;
    for (let i = 0; i < 60; i++) {
      engine.processEvent(PlatonicEngine.encodeGameEvent('exploration', 1, 127, i));
    }
    assert.ok(engine.players.get(1).score >= initial);
  });

  test('player position changes with exploration', () => {
    const engine = new PlatonicEngine('explore-position');
    engine.addPlayer(1, 'Scout');
    const before = { ...engine.players.get(1).position };
    for (let i = 0; i < 20; i++) {
      engine.processEvent(PlatonicEngine.encodeGameEvent('exploration', 1, 80, i));
    }
    const after = engine.players.get(1).position;
    assert.ok(after.x !== before.x || after.y !== before.y);
  });
});

// ── Meta / Turn Management ────────────────────────────────────────────

describe('meta events', () => {
  test('turn end advances turn counter', () => {
    const engine = new PlatonicEngine('turn');
    assert.equal(engine.turn, 0);
    engine.processEvent(PlatonicEngine.encodeMetaEvent('turnEnd'));
    assert.equal(engine.turn, 1);
  });

  test('state query returns complete state', () => {
    const engine = new PlatonicEngine('query');
    engine.addPlayer(1, 'Alice');
    engine.addPlayer(2, 'Bob');
    engine.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 50, 0));
    engine.processEvent(PlatonicEngine.encodeGameEvent('resource', 2, 50, 48));
    const { system, result, narrative } = engine.processEvent(PlatonicEngine.encodeMetaEvent('stateQuery'));
    assert.equal(system, 'meta');
    assert.equal(result.players.length, 2);
    assert.ok(result.eventCount >= 2);
    assert.ok(narrative.includes('Alice'));
  });

  test('reset clears state but keeps seed', () => {
    const engine = new PlatonicEngine('reset');
    engine.addPlayer(1, 'Alice');
    engine.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 50, 0));
    const { result } = engine.processEvent(PlatonicEngine.encodeMetaEvent('reset'));
    assert.equal(result.reset, true);
    assert.equal(engine.turn, 0);
    assert.equal(engine.players.size, 0);
    assert.equal(engine.eventLog.length, 0);
    assert.equal(engine.masterSeed, 'reset');
  });
});

// ── Stream Processing ─────────────────────────────────────────────────

describe('stream processing', () => {
  test('processStream decodes and executes multiple events', () => {
    const engine = new PlatonicEngine('stream');
    engine.addPlayer(1, 'Alice');
    engine.addPlayer(2, 'Bob');

    const events = [
      { eventType: EventType.NoteOn, channel: 0, pitch: 1, velocity: 60, errorMask: 0, tick: 0 },
      { eventType: EventType.NoteOn, channel: 1, pitch: 2, velocity: 60, errorMask: 0, tick: 48 },
      { eventType: EventType.NoteOn, channel: 3, pitch: 1, velocity: 60, errorMask: 0, tick: 96 },
      { eventType: EventType.Meta, channel: 15, pitch: META_COMMANDS.TURN_END, velocity: 0, errorMask: 0, tick: 144 },
    ];

    const stream = encodeStream(events);
    const results = engine.processStream(stream);
    assert.equal(results.length, 4);
    assert.equal(results[0].system, 'combat');
    assert.equal(results[1].system, 'social');
    assert.equal(results[2].system, 'resource');
    assert.equal(results[3].system, 'meta');
    assert.equal(engine.turn, 1);
  });

  test('stream is sorted by tick before processing', () => {
    const engine = new PlatonicEngine('stream-sort');
    const events = [
      { eventType: EventType.Meta, channel: 15, pitch: META_COMMANDS.TURN_END, velocity: 0, errorMask: 0, tick: 200 },
      { eventType: EventType.NoteOn, channel: 0, pitch: 1, velocity: 60, errorMask: 0, tick: 0 },
    ];
    const results = engine.processStream(encodeStream(events));
    assert.equal(results[0].system, 'combat');
    assert.equal(results[1].system, 'meta');
  });
});

// ── Determinism ───────────────────────────────────────────────────────

describe('determinism', () => {
  test('same seed produces identical sequences', () => {
    const e1 = new PlatonicEngine('deterministic');
    const e2 = new PlatonicEngine('deterministic');
    e1.addPlayer(1, 'A');
    e2.addPlayer(1, 'A');

    const results1 = [];
    const results2 = [];
    for (let i = 0; i < 10; i++) {
      results1.push(e1.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 60, i)).result.playerMove);
      results2.push(e2.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 60, i)).result.playerMove);
    }
    assert.deepEqual(results1, results2);
  });

  test('different seeds diverge', () => {
    const e1 = new PlatonicEngine('seed-a');
    const e2 = new PlatonicEngine('seed-b');
    e1.addPlayer(1, 'A');
    e2.addPlayer(1, 'A');

    const seq1 = [];
    const seq2 = [];
    for (let i = 0; i < 10; i++) {
      seq1.push(e1.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 60, i)).result.playerMove);
      seq2.push(e2.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 60, i)).result.playerMove);
    }
    assert.notDeepEqual(seq1, seq2);
  });
});

// ── Narrative Output ──────────────────────────────────────────────────

describe('narrative output', () => {
  test('every system returns a non-empty narrative', () => {
    const engine = new PlatonicEngine('narrative');
    engine.addPlayer(1, 'Hero');
    const systems = ['combat', 'social', 'weather', 'resource', 'exploration'];
    for (const sys of systems) {
      const { narrative } = engine.processEvent(PlatonicEngine.encodeGameEvent(sys, 1, 60, 0));
      assert.ok(typeof narrative === 'string');
      assert.ok(narrative.length > 10);
    }
  });

  test('state query narrative lists players', () => {
    const engine = new PlatonicEngine('narrative-query');
    engine.addPlayer(1, 'Alice');
    engine.addPlayer(2, 'Bob');
    const { narrative } = engine.processEvent(PlatonicEngine.encodeMetaEvent('stateQuery'));
    assert.ok(narrative.includes('Alice'));
    assert.ok(narrative.includes('Bob'));
  });
});

// ── Integration: Full Session ─────────────────────────────────────────

describe('full game session', () => {
  test('3 players, 10 turns, all systems exercised', () => {
    const engine = new PlatonicEngine('full-session');
    engine.addPlayer(1, 'Alice');
    engine.addPlayer(2, 'Bob');
    engine.addPlayer(3, 'Carol');

    for (let turn = 0; turn < 10; turn++) {
      for (const playerId of [1, 2, 3]) {
        engine.processEvent(PlatonicEngine.encodeGameEvent('combat', playerId, 50, turn * 576 + playerId * 48));
        engine.processEvent(PlatonicEngine.encodeGameEvent('social', playerId, 40, turn * 576 + playerId * 48 + 12));
        engine.processEvent(PlatonicEngine.encodeGameEvent('resource', playerId, 40, turn * 576 + playerId * 48 + 24));
        engine.processEvent(PlatonicEngine.encodeGameEvent('exploration', playerId, 50, turn * 576 + playerId * 48 + 36));
      }
      engine.processEvent(PlatonicEngine.encodeGameEvent('weather', 0, 30, turn * 576 + 200));
      engine.processEvent(PlatonicEngine.encodeMetaEvent('turnEnd', turn * 576 + 576));
    }

    assert.equal(engine.turn, 10);
    const state = engine.serialize();
    assert.ok(state.eventLog.length >= 100);

    for (const player of engine.players.values()) {
      assert.ok(player.combat.health >= 0);
      assert.ok(player.score >= 0);
    }
  });
});

// ── Unknown / Edge Cases ──────────────────────────────────────────────

describe('unknown and edge cases', () => {
  test('unknown channel returns unknown system without crashing', () => {
    const engine = new PlatonicEngine();
    const { system, narrative } = engine.processEvent(encodeEvent({
      eventType: EventType.NoteOn,
      channel: 7,
      pitch: 1,
      velocity: 60,
      errorMask: 0,
      tick: 0,
    }));
    assert.equal(system, 'unknown');
    assert.ok(narrative.includes('channel 7'));
  });

  test('serialize produces a round-trippable state shape', () => {
    const engine = new PlatonicEngine('serialize');
    engine.addPlayer(1, 'Alice');
    engine.processEvent(PlatonicEngine.encodeGameEvent('combat', 1, 60, 0));
    const state = engine.serialize();
    assert.equal(state.seed, 'serialize');
    assert.ok(state.positions);
    assert.ok(Array.isArray(state.players));
    assert.ok(Array.isArray(state.eventLog));
    assert.ok('orbits' in state);
  });
});
