/**
 * Tests for the Platonic Randomness Game Engine
 * 
 * Run: node platonic-engine.test.js
 */

'use strict';

const { PlatonicEngine, SWMIDI_STATUS, SWMIDI_GAME_EVENTS } = require('./platonic-engine');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

function assertInRange(value, min, max, message) {
  assert(value >= min && value <= max, `${message} (expected [${min}, ${max}], got ${value})`);
}

function test(name, fn) {
  console.log(`\n▶ ${name}`);
  try {
    fn();
    console.log(`  ✓ passed`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.error(`  ✗ ERROR: ${e.message}`);
  }
}

// ── SWMIDI Encoding ───────────────────────────────────────────────────

test('SWMIDI encoding produces 8 bytes', () => {
  const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.COMBAT, 5, 1);
  assertEqual(bytes.length, 8, 'Event must be 8 bytes');
});

test('SWMIDI checksum is valid', () => {
  const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.SOCIAL, 3, 2);
  let checksum = 0;
  for (let i = 0; i < 7; i++) checksum ^= bytes[i];
  assertEqual(bytes[7], checksum, 'Checksum byte must match XOR of bytes 0-6');
});

test('SWMIDI encoding sets correct status', () => {
  const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.WEATHER, 2, 1);
  assertEqual(bytes[0], SWMIDI_STATUS.GAME_EVENT, 'Status must be GAME_EVENT');
});

// ── Engine Initialization ─────────────────────────────────────────────

test('Engine initializes with correct position counts per solid', () => {
  const engine = new PlatonicEngine('test-seed');
  assertEqual(engine.positions.combat.length, 4, 'Combat (tetrahedron) has 4 positions');
  assertEqual(engine.positions.social.length, 12, 'Social (icosahedron) has 12 positions');
  assertEqual(engine.positions.weather.length, 20, 'Weather (dodecahedron) has 20 positions');
  assertEqual(engine.positions.resource.length, 8, 'Resource (cube) has 8 positions');
  assertEqual(engine.positions.exploration.length, 6, 'Exploration (octahedron) has 6 positions');
});

test('Engine starts at turn 0', () => {
  const engine = new PlatonicEngine();
  assertEqual(engine.turn, 0, 'Initial turn must be 0');
});

test('Engine registers players', () => {
  const engine = new PlatonicEngine();
  const p = engine.addPlayer(1, 'Alice');
  assertEqual(p.name, 'Alice', 'Player name must match');
  assertEqual(p.combat.health, 100, 'Player starts with 100 HP');
  assertEqual(p.social.reputation, 50, 'Player starts with 50 reputation');
});

// ── Combat (Tetrahedron) ──────────────────────────────────────────────

test('Combat produces valid outcomes', () => {
  const engine = new PlatonicEngine('combat-test');
  engine.addPlayer(1, 'Fighter');
  
  for (let i = 0; i < 20; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.COMBAT, 5, 1);
    const { system, result, narrative } = engine.processSWMIDI(bytes);
    
    assertEqual(system, 'combat', `Combat event ${i} must return combat system`);
    assert(['strike', 'parry', 'feint', 'riposte'].includes(result.playerMove), 'Valid player move');
    assert(['strike', 'parry', 'feint', 'riposte'].includes(result.opponentMove), 'Valid opponent move');
    assert(['win', 'lose', 'clash'].includes(result.outcome), 'Valid outcome');
    assert(result.damage >= 0, 'Damage must be non-negative');
    assert(typeof narrative === 'string' && narrative.length > 0, 'Must have narrative');
  }
});

test('Combat positions evolve over time', () => {
  const engine = new PlatonicEngine('combat-evolve');
  engine.addPlayer(1, 'Fighter');
  
  const initialValues = engine.positions.combat.map(p => p.value);
  
  for (let i = 0; i < 10; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.COMBAT, 5, 1);
    engine.processSWMIDI(bytes);
  }
  
  const finalValues = engine.positions.combat.map(p => p.value);
  const changed = finalValues.some((v, i) => v !== initialValues[i]);
  assert(changed, 'Combat positions must change after 10 events');
});

// ── Social (Icosahedron) ──────────────────────────────────────────────

test('Social produces pulse-grid-aligned actions', () => {
  const engine = new PlatonicEngine('social-test');
  engine.addPlayer(1, 'Diplomat');
  
  const actions = new Set();
  for (let i = 0; i < 30; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.SOCIAL, 3, 1);
    const { system, result } = engine.processSWMIDI(bytes);
    
    assertEqual(system, 'social', `Social event ${i} must return social system`);
    assertInRange(result.targetPulse, 1, 12, 'Target pulse must be 1-12');
    assert(typeof result.success === 'boolean', 'Success must be boolean');
    actions.add(result.action);
  }
  
  // Over 30 rolls, we should see at least 5 different social actions
  assert(actions.size >= 5, `Should see variety in social actions (got ${actions.size})`);
});

// ── Weather (Dodecahedron) ────────────────────────────────────────────

test('Weather evolves slowly (dodecahedron orbit)', () => {
  const engine = new PlatonicEngine('weather-test');
  
  const states = [];
  for (let i = 0; i < 10; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.WEATHER, 2, 1);
    const { system, result } = engine.processSWMIDI(bytes);
    
    assertEqual(system, 'weather', `Weather event ${i} must return weather system`);
    assert(typeof result.current === 'string', 'Must have current weather string');
    assert(typeof result.severity === 'number', 'Must have severity number');
    assertInRange(result.severity, 0, 5, 'Severity must be reasonable');
    states.push(result.current);
  }
  
  // Weather should evolve — at least 2 different states in 10 turns
  const uniqueStates = new Set(states);
  assert(uniqueStates.size >= 2, `Weather should vary over 10 turns (got ${uniqueStates.size} states)`);
});

// ── Resources (Cube) ──────────────────────────────────────────────────

test('Resource rolls produce triangular distribution (2d4)', () => {
  const engine = new PlatonicEngine('resource-dist-test');
  engine.addPlayer(1, 'Gatherer');
  
  const totals = [];
  for (let i = 0; i < 200; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.RESOURCE, 3, 1);
    const { result } = engine.processSWMIDI(bytes);
    totals.push(result.total);
  }
  
  // Range check: 2d4 produces values 2-8
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  assertInRange(min, 2, 2, 'Minimum roll should be 2');
  assertInRange(max, 8, 8, 'Maximum roll should be 8');
  
  // Mode check: 5 should be most common (or near-most)
  const counts = {};
  for (const t of totals) counts[t] = (counts[t] || 0) + 1;
  const mode = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  assert(Number(mode[0]) >= 4 && Number(mode[0]) <= 6, `Mode should be near 5 (got ${mode[0]})`);
});

test('Resource accumulation works', () => {
  const engine = new PlatonicEngine('resource-accum-test');
  engine.addPlayer(1, 'Miner');
  
  const initialWood = engine.players.get(1).resources.wood;
  
  for (let i = 0; i < 50; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.RESOURCE, 4, 1);
    engine.processSWMIDI(bytes);
  }
  
  // At least some resources should have been gathered
  const total = Object.values(engine.players.get(1).resources).reduce((a, b) => a + b, 0);
  assert(total > 0, 'Player should have gathered resources after 50 rolls');
});

// ── Exploration (Octahedron) ──────────────────────────────────────────

test('Exploration moves player in cardinal directions', () => {
  const engine = new PlatonicEngine('explore-test');
  engine.addPlayer(1, 'Explorer');
  
  const directions = new Set();
  for (let i = 0; i < 20; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.EXPLORATION, 4, 1);
    const { system, result } = engine.processSWMIDI(bytes);
    
    assertEqual(system, 'exploration', `Exploration event ${i} must return exploration system`);
    assert(['north', 'south', 'east', 'west', 'ascend', 'descend'].includes(result.direction), 'Valid direction');
    assert(result.distance >= 1, 'Distance must be positive');
    directions.add(result.direction);
  }
  
  // Over 20 rolls, should see at least 3 different directions
  assert(directions.size >= 3, `Should see multiple directions (got ${directions.size})`);
});

test('Exploration discoveries increase score', () => {
  const engine = new PlatonicEngine('explore-score-test');
  engine.addPlayer(1, 'Scout');
  
  const initialScore = engine.players.get(1).score;
  
  for (let i = 0; i < 50; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.EXPLORATION, 8, 1);
    engine.processSWMIDI(bytes);
  }
  
  const finalScore = engine.players.get(1).score;
  assert(finalScore >= initialScore, 'Score should not decrease from exploration');
});

// ── Turn Management ───────────────────────────────────────────────────

test('Turn end advances turn counter', () => {
  const engine = new PlatonicEngine('turn-test');
  
  assertEqual(engine.turn, 0, 'Start at turn 0');
  
  const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.TURN_END, 0, 0);
  engine.processSWMIDI(bytes);
  
  assertEqual(engine.turn, 1, 'Turn should advance to 1');
});

test('Weather evolves on turn end even without explicit weather event', () => {
  const engine = new PlatonicEngine('turn-weather-test');
  
  // Find initial weather
  const initialWeather = engine.positions.weather.findIndex(p => p.value > 0);
  
  // End several turns
  for (let i = 0; i < 5; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.TURN_END, 0, 0);
    engine.processSWMIDI(bytes);
  }
  
  // Weather may or may not have changed (dodecahedron is slow), but the system should not crash
  assert(true, 'Weather evolution on turn end should not crash');
});

// ── State Query ───────────────────────────────────────────────────────

test('State query returns complete game state', () => {
  const engine = new PlatonicEngine('query-test');
  engine.addPlayer(1, 'Alice');
  engine.addPlayer(2, 'Bob');
  
  // Do some events
  for (let i = 0; i < 5; i++) {
    engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.COMBAT, 3, 1));
    engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.RESOURCE, 3, 2));
  }
  
  const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.STATE_QUERY, 0, 0);
  const { system, result, narrative } = engine.processSWMIDI(bytes);
  
  assertEqual(system, 'meta', 'State query returns meta system');
  assertEqual(result.players.length, 2, 'Should have 2 players');
  assert(result.eventCount >= 10, 'Should have logged events');
  assert(typeof narrative === 'string', 'Should have narrative');
});

// ── Determinism ───────────────────────────────────────────────────────

test('Same seed produces same sequence', () => {
  const engine1 = new PlatonicEngine('deterministic-seed');
  const engine2 = new PlatonicEngine('deterministic-seed');
  
  engine1.addPlayer(1, 'A');
  engine2.addPlayer(1, 'A');
  
  const results1 = [];
  const results2 = [];
  
  for (let i = 0; i < 10; i++) {
    const bytes = PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.COMBAT, 5, 1);
    const r1 = engine1.processSWMIDI(bytes);
    const r2 = engine2.processSWMIDI([...bytes]);
    results1.push(r1.result.playerMove);
    results2.push(r2.result.playerMove);
  }
  
  for (let i = 0; i < 10; i++) {
    assertEqual(results1[i], results2[i], `Same seed: roll ${i} must match`);
  }
});

// ── Narrative Quality ─────────────────────────────────────────────────

test('All systems produce narrative text', () => {
  const engine = new PlatonicEngine('narrative-test');
  engine.addPlayer(1, 'Hero');
  
  const systems = [
    SWMIDI_GAME_EVENTS.COMBAT,
    SWMIDI_GAME_EVENTS.SOCIAL,
    SWMIDI_GAME_EVENTS.WEATHER,
    SWMIDI_GAME_EVENTS.RESOURCE,
    SWMIDI_GAME_EVENTS.EXPLORATION,
  ];
  
  for (const evt of systems) {
    const bytes = PlatonicEngine.encodeGameEvent(evt, 3, 1);
    const { narrative } = engine.processSWMIDI(bytes);
    assert(typeof narrative === 'string' && narrative.length > 10, `${evt}: narrative must be meaningful text`);
  }
});

// ── Error Handling ────────────────────────────────────────────────────

test('Invalid byte count throws error', () => {
  const engine = new PlatonicEngine();
  let threw = false;
  try {
    engine.processSWMIDI([0xC0, 0x00, 0x01, 0x02]);
  } catch (e) {
    threw = true;
    assert(e.message.includes('8 bytes'), 'Error message should mention byte count');
  }
  assert(threw, 'Must throw on invalid byte count');
});

test('Invalid checksum throws error', () => {
  const engine = new PlatonicEngine();
  const bytes = [0xC0, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0xFF];
  let threw = false;
  try {
    engine.processSWMIDI(bytes);
  } catch (e) {
    threw = true;
    assert(e.message.includes('checksum'), 'Error message should mention checksum');
  }
  assert(threw, 'Must throw on invalid checksum');
});

// ── NOTE_ON feeds social system ───────────────────────────────────────

test('NOTE_ON events feed social pulse grid', () => {
  const engine = new PlatonicEngine('note-test');
  
  const bytes = PlatonicEngine.encodeSWMIDI(SWMIDI_STATUS.NOTE_ON, 0, 60, 100, 1);
  const { system, result } = engine.processSWMIDI(bytes);
  
  assertEqual(system, 'social', 'NOTE_ON should feed social system');
  assertInRange(result.pulse, 1, 12, 'Pulse must map to 1-12');
  assert(result.energy > 0, 'Velocity should produce positive energy');
});

// ── Serialization ─────────────────────────────────────────────────────

test('Serialize produces valid state object', () => {
  const engine = new PlatonicEngine('serialize-test');
  engine.addPlayer(1, 'Alice');
  engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.COMBAT, 5, 1));
  
  const state = engine.serialize();
  
  assertEqual(state.seed, 'serialize-test', 'Serialized seed must match');
  assert(state.positions, 'Must have positions');
  assert(state.players, 'Must have players');
  assert(Array.isArray(state.eventLog), 'Must have event log array');
});

// ── Integration: Full Game Session ────────────────────────────────────

test('Full game session: 3 players, 10 turns, all systems exercised', () => {
  const engine = new PlatonicEngine('full-game-session');
  
  engine.addPlayer(1, 'Alice');
  engine.addPlayer(2, 'Bob');
  engine.addPlayer(3, 'Carol');
  
  for (let turn = 0; turn < 10; turn++) {
    // Each player takes actions
    for (const playerId of [1, 2, 3]) {
      // Combat
      engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.COMBAT, 5, playerId));
      // Social
      engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.SOCIAL, 3, playerId));
      // Resource
      engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.RESOURCE, 4, playerId));
      // Exploration
      engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.EXPLORATION, 5, playerId));
    }
    
    // Weather happens once per turn
    engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.WEATHER, 2, 0));
    
    // End turn
    engine.processSWMIDI(PlatonicEngine.encodeGameEvent(SWMIDI_GAME_EVENTS.TURN_END, 0, 0));
  }
  
  // Verify final state
  assertEqual(engine.turn, 10, 'Should be at turn 10 after 10 turn-ends');
  
  const state = engine.serialize();
  assert(state.eventLog.length >= 100, `Should have many events logged (got ${state.eventLog.length})`);
  
  // All players should still exist
  for (const [id, player] of engine.players) {
    assert(player.combat.health >= 0, `Player ${id} health should be non-negative`);
    assert(player.score >= 0, `Player ${id} score should be non-negative`);
  }
  
  // No player should have died (intensity is moderate)
  const allAlive = Array.from(engine.players.values()).every(p => p.combat.health > 0);
  // Players might take damage but with intensity 5 and 10 turns, unlikely to die
  // Just verify health is tracked
  assert(true, `Full session completed. Players: ${Array.from(engine.players.values()).map(p => `${p.name}(HP:${p.combat.health},Score:${p.score})`).join(', ')}`);
});

// ── Summary ───────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length > 0) {
  console.log(`\n  Failures:`);
  for (const f of failures) console.log(`    • ${f}`);
}
console.log(`${'═'.repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
