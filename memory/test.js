// ════════════════════════════════════════════════════════════════════
// MEMORY LAYER TESTS — Session Store, Replay, Cross-Analysis
// ════════════════════════════════════════════════════════════════════
//
// Run: node memory/test.js
//
// ════════════════════════════════════════════════════════════════════

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { SessionStore } = require('./session-store');
const { ReplayEngine, BatchReplayer } = require('./replay');
const { CrossAnalyzer } = require('./cross-analysis');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tensor-midi-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true }); } catch {}
  }
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
  }
}

// ── Session Store Tests ──────────────────────────────────────────────

console.log('\n── Session Store ──');

test('creates a session with correct defaults', () => {
  const store = new SessionStore(tmpDir());
  const s = store.create({ title: 'Test Session' });
  assert.ok(s.id, 'Should have an id');
  assert.strictEqual(s.title, 'Test Session');
  assert.ok(s.createdAt > 0);
  assert.strictEqual(s.endedAt, null);
  assert.deepStrictEqual(s.participants, []);
  assert.strictEqual(s.key, 'C');
  assert.strictEqual(s.bpm, 120);
  assert.deepStrictEqual(s.events, []);
  assert.deepStrictEqual(s.messages, []);
  assert.deepStrictEqual(s.quotes, []);
});

test('saves and loads a session', () => {
  const store = new SessionStore(tmpDir());
  const s = store.create({ title: 'Save Me' });
  store.save(s);

  const loaded = store.load(s.id);
  assert.ok(loaded);
  assert.strictEqual(loaded.title, 'Save Me');
  assert.strictEqual(loaded.id, s.id);
});

test('returns null for missing session', () => {
  const store = new SessionStore(tmpDir());
  assert.strictEqual(store.load('does-not-exist'), null);
});

test('deletes a session', () => {
  const store = new SessionStore(tmpDir());
  const s = store.create({});
  store.save(s);
  assert.ok(store.delete(s.id));
  assert.strictEqual(store.load(s.id), null);
});

test('lists sessions sorted by createdAt desc', () => {
  const store = new SessionStore(tmpDir());
  const s1 = store.create({ title: 'First' });
  s1.createdAt = 1000;
  store.save(s1);
  const s2 = store.create({ title: 'Second' });
  s2.createdAt = 2000;
  store.save(s2);
  const list = store.list();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].title, 'Second');
  assert.strictEqual(list[1].title, 'First');
});

test('captures messages as events', () => {
  const store = new SessionStore(tmpDir());
  const s = store.create({});
  store.capture(s, { text: 'Hello world', speaker: 'riker', pitch: 72, vel: 80, sentiment: 'bright' });
  store.capture(s, { text: 'I am small', speaker: 'wesley', pitch: 48, vel: 40, sentiment: 'neutral' });

  assert.strictEqual(s.events.length, 2);
  assert.strictEqual(s.messages.length, 2);
  assert.deepStrictEqual(s.participants, ['riker', 'wesley']);
  assert.strictEqual(s.events[0].channel, 0); // riker
  assert.strictEqual(s.events[1].channel, 1); // wesley
  assert.strictEqual(s.events[0].pitch, 72);
  assert.strictEqual(s.events[1].pitch, 48);
});

test('finalize computes analysis, movements, key', () => {
  const store = new SessionStore(tmpDir());
  const s = store.create({ title: 'Final Test' });
  const messages = [
    { text: 'great awesome love it', speaker: 'p1', pitch: 72, vel: 90, sentiment: 'bright' },
    { text: 'bad error broken', speaker: 'p2', pitch: 40, vel: 100, sentiment: 'tense' },
    { text: 'imagine create build', speaker: 'p1', pitch: 84, vel: 70, sentiment: 'creative' },
    { text: 'what how why', speaker: 'p3', pitch: 75, vel: 60, sentiment: 'inquiring' },
    { text: 'wonderful perfect', speaker: 'p2', pitch: 68, vel: 80, sentiment: 'bright' },
  ];
  for (const m of messages) store.capture(s, m);
  store.finalize(s);

  assert.ok(s.analysis, 'Should have analysis');
  assert.ok(s.analysis.tension >= 0 && s.analysis.tension <= 100);
  assert.ok(s.analysis.energy >= 0 && s.analysis.energy <= 100);
  assert.ok(s.analysis.dominantMode, 'Should have a mode');
  assert.ok(s.analysis.dominantChord, 'Should have a chord');
  assert.ok(s.analysis.flowRatio >= 0 && s.analysis.flowRatio <= 1);
  assert.ok(s.analysis.pitchHistogram.length === 128);
  assert.ok(Object.keys(s.analysis.speakerStats).length === 3);
  assert.ok(s.movements.length >= 1, 'Should detect at least 1 movement');
  assert.ok(s.key, 'Should detect a key');
  assert.ok(s.endedAt !== null, 'Should set endedAt');
});

test('detectKey finds the correct key', () => {
  const store = new SessionStore(tmpDir());
  const s = store.create({});
  // All pitches in C major: C=60, E=64, G=67
  for (let i = 0; i < 10; i++) {
    store.capture(s, {
      text: 'note', speaker: 'test',
      pitch: [60, 64, 67, 72][i % 4],
      vel: 80, sentiment: 'neutral',
    });
  }
  const key = store.detectKey(s);
  assert.strictEqual(key, 'C', 'Should detect C major');
});

test('adds cross-session quotes', () => {
  const store = new SessionStore(tmpDir());
  const s1 = store.create({ title: 'Original' });
  store.capture(s1, { text: 'wise words', speaker: 'sage', pitch: 60, vel: 60, sentiment: 'neutral' });
  store.save(s1);

  const s2 = store.create({ title: 'Quoter' });
  store.capture(s2, { text: 'as the sage said', speaker: 'student', pitch: 60, vel: 60, sentiment: 'neutral' });
  store.addQuote(s2, 0, s1, 0, 'referencing the sage');
  store.save(s2);

  const loaded = store.load(s2.id);
  assert.strictEqual(loaded.quotes.length, 1);
  assert.strictEqual(loaded.quotes[0].fromSessionId, s1.id);
  assert.strictEqual(loaded.quotes[0].note, 'referencing the sage');
});

test('findQuotesTo finds sessions that reference a given session', () => {
  const store = new SessionStore(tmpDir());
  const s1 = store.create({ title: 'Quoted' });
  store.save(s1);
  const s2 = store.create({ title: 'Quoter' });
  store.addQuote(s2, 0, s1, 0, 'test');
  store.save(s2);

  const refs = store.findQuotesTo(s1.id);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].sessionId, s2.id);
});

test('toScore produces human-readable output', () => {
  const store = new SessionStore(tmpDir());
  const s = store.create({ title: 'Score Test' });
  store.capture(s, { text: 'hello', speaker: 'a', pitch: 60, vel: 80, sentiment: 'bright' });
  store.capture(s, { text: 'goodbye', speaker: 'b', pitch: 72, vel: 60, sentiment: 'neutral' });
  store.finalize(s);
  const score = store.toScore(s);
  assert.ok(score.includes('Score Test'));
  assert.ok(score.includes('hello'));
  assert.ok(score.includes('goodbye'));
  assert.ok(score.includes('──'));
});

test('search filters by speaker and mode', () => {
  const store = new SessionStore(tmpDir());
  const s1 = store.create({ title: 'Riker Session' });
  store.capture(s1, { text: 'hi', speaker: 'riker', pitch: 60, vel: 60, sentiment: 'neutral' });
  store.finalize(s1);

  const s2 = store.create({ title: 'Wesley Session' });
  store.capture(s2, { text: 'hi', speaker: 'wesley', pitch: 60, vel: 60, sentiment: 'neutral' });
  store.finalize(s2);

  const rikerOnly = store.search({ speaker: 'riker' });
  assert.strictEqual(rikerOnly.length, 1);
  assert.strictEqual(rikerOnly[0].title, 'Riker Session');
});

test('findSimilar finds sessions with similar pitch distributions', () => {
  const store = new SessionStore(tmpDir());
  const s1 = store.create({ title: 'High' });
  for (let i = 0; i < 5; i++) {
    store.capture(s1, { text: 'x', speaker: 'a', pitch: 72 + i, vel: 80, sentiment: 'bright' });
  }
  store.finalize(s1);

  const s2 = store.create({ title: 'Also High' });
  for (let i = 0; i < 5; i++) {
    store.capture(s2, { text: 'x', speaker: 'a', pitch: 72 + i, vel: 80, sentiment: 'bright' });
  }
  store.finalize(s2);

  const s3 = store.create({ title: 'Low' });
  for (let i = 0; i < 5; i++) {
    store.capture(s3, { text: 'x', speaker: 'a', pitch: 36 + i, vel: 80, sentiment: 'tense' });
  }
  store.finalize(s3);

  const similar = store.findSimilar(s1);
  assert.ok(similar.length > 0);
  assert.strictEqual(similar[0].session.id, s2.id, 'Should find s2 most similar to s1');
});

// ── Replay Engine Tests ──────────────────────────────────────────────

console.log('\n── Replay Engine ──');

test('loads a session for replay', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);
  const s = store.create({ title: 'Replay Me', bpm: 120 });
  for (let i = 0; i < 5; i++) {
    store.capture(s, { text: `msg ${i}`, speaker: 'test', pitch: 60 + i, vel: 70, sentiment: 'neutral' });
  }
  store.save(s);

  const engine = new ReplayEngine(store);
  engine.load(s.id);
  assert.strictEqual(engine.events.length, 5);
  assert.strictEqual(engine.currentEventIndex, 0);
});

test('playInstant emits all events synchronously', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);
  const s = store.create({ title: 'Instant' });
  for (let i = 0; i < 10; i++) {
    store.capture(s, { text: `msg ${i}`, speaker: 'test', pitch: 60, vel: 70, sentiment: 'neutral' });
  }
  store.save(s);

  const engine = new ReplayEngine(store);
  engine.load(s.id);

  let count = 0;
  engine.on('event', () => count++);
  engine.playInstant();

  assert.strictEqual(count, 10);
});

test('emits end event after playback', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);
  const s = store.create({ title: 'End Test' });
  store.capture(s, { text: 'one', speaker: 'a', pitch: 60, vel: 60, sentiment: 'neutral' });
  store.save(s);

  const engine = new ReplayEngine(store);
  engine.load(s.id);

  let ended = false;
  engine.on('end', () => { ended = true; });
  engine.playInstant();

  assert.ok(ended);
});

test('loadDuet merges two sessions by tick', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  const sA = store.create({ title: 'A', bpm: 120 });
  store.capture(sA, { text: 'a1', speaker: 'a', pitch: 60, vel: 60, sentiment: 'neutral', tick: 0 });
  store.capture(sA, { text: 'a2', speaker: 'a', pitch: 64, vel: 60, sentiment: 'neutral', tick: 96 });
  store.save(sA);

  const sB = store.create({ title: 'B', bpm: 120 });
  store.capture(sB, { text: 'b1', speaker: 'b', pitch: 67, vel: 60, sentiment: 'neutral', tick: 0 });
  store.capture(sB, { text: 'b2', speaker: 'b', pitch: 72, vel: 60, sentiment: 'neutral', tick: 48 });
  store.save(sB);

  const engine = new ReplayEngine(store);
  engine.loadDuet(sA.id, sB.id, { offsetB: 0 });
  assert.strictEqual(engine.events.length, 4);
  // Should be sorted by tick
  assert.strictEqual(engine.events[0].tick, 0);
  assert.strictEqual(engine.events[1].tick, 0);
});

test('stop rewinds to beginning', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);
  const s = store.create({ title: 'Stop' });
  for (let i = 0; i < 5; i++) {
    store.capture(s, { text: `m${i}`, speaker: 'a', pitch: 60, vel: 60, sentiment: 'neutral' });
  }
  store.save(s);

  const engine = new ReplayEngine(store);
  engine.load(s.id);
  engine.currentEventIndex = 3;
  engine.stop();
  assert.strictEqual(engine.currentEventIndex, 0);
});

test('BatchReplayer.analyzeTimeline computes running metrics', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);
  const s = store.create({ title: 'Timeline' });
  const msgs = [
    { text: 'great', speaker: 'a', pitch: 72, vel: 90, sentiment: 'bright' },
    { text: 'bad', speaker: 'b', pitch: 40, vel: 100, sentiment: 'tense' },
    { text: 'great', speaker: 'a', pitch: 68, vel: 85, sentiment: 'bright' },
    { text: 'awesome', speaker: 'c', pitch: 76, vel: 75, sentiment: 'bright' },
  ];
  for (const m of msgs) store.capture(s, m);
  store.save(s);

  const replayer = new BatchReplayer(store);
  const timeline = replayer.analyzeTimeline(s.id);
  assert.strictEqual(timeline.length, 4);
  assert.strictEqual(timeline[0].runningTension, 0);
  assert.ok(timeline[1].runningTension > 0, 'Second event has tension');
  assert.ok(timeline[3].activeChannels === 3);
});

// ── Cross-Analysis Tests ─────────────────────────────────────────────

console.log('\n── Cross-Session Analysis ──');

test('fleetStats aggregates across sessions', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  const s1 = store.create({ title: 'S1' });
  store.capture(s1, { text: 'great', speaker: 'a', pitch: 60, vel: 80, sentiment: 'bright' });
  store.capture(s1, { text: 'love it', speaker: 'b', pitch: 64, vel: 70, sentiment: 'bright' });
  store.finalize(s1);

  const s2 = store.create({ title: 'S2' });
  store.capture(s2, { text: 'bad', speaker: 'a', pitch: 40, vel: 100, sentiment: 'tense' });
  store.capture(s2, { text: 'error', speaker: 'c', pitch: 36, vel: 90, sentiment: 'tense' });
  store.finalize(s2);

  const analyzer = new CrossAnalyzer(store);
  const stats = analyzer.fleetStats();

  assert.strictEqual(stats.totalSessions, 2);
  assert.strictEqual(stats.totalEvents, 4);
  assert.ok(stats.avgTension > 0);
  assert.ok(stats.dominantMode);
  assert.ok(stats.dominantKey);
});

test('speakerProfiles builds per-speaker stats', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  const s1 = store.create({ title: 'S1' });
  store.capture(s1, { text: 'high', speaker: 'soprano', pitch: 84, vel: 80, sentiment: 'bright' });
  store.capture(s1, { text: 'low', speaker: 'bass', pitch: 40, vel: 60, sentiment: 'neutral' });
  store.finalize(s1);

  const s2 = store.create({ title: 'S2' });
  store.capture(s2, { text: 'high again', speaker: 'soprano', pitch: 88, vel: 90, sentiment: 'bright' });
  store.finalize(s2);

  const analyzer = new CrossAnalyzer(store);
  const profiles = analyzer.speakerProfiles();

  assert.ok(profiles['soprano']);
  assert.ok(profiles['bass']);
  assert.strictEqual(profiles['soprano'].totalEvents, 2);
  assert.strictEqual(profiles['soprano'].sessionCount, 2);
  assert.strictEqual(profiles['soprano'].usualRegister, 'high');
  assert.strictEqual(profiles['bass'].usualRegister, 'low');
  assert.strictEqual(profiles['soprano'].usualSentiment, 'bright');
});

test('sessionClusters groups by key-mode', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  // Create sessions with same key/mode
  for (let i = 0; i < 3; i++) {
    const s = store.create({ title: `S${i}` });
    store.capture(s, { text: 'x', speaker: 'a', pitch: 60, vel: 70, sentiment: 'neutral' });
    store.finalize(s);
  }

  const analyzer = new CrossAnalyzer(store);
  const clusters = analyzer.sessionClusters();
  assert.ok(Object.keys(clusters).length >= 1);
});

test('emotionalArcs finds patterns', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  // Two sessions with the same arc: bright → tense → bright
  const sentiments = ['bright', 'tense', 'bright'];
  for (let s = 0; s < 2; s++) {
    const session = store.create({ title: `Arc${s}` });
    for (const sentiment of sentiments) {
      store.capture(session, {
        text: `msg ${sentiment}`, speaker: 'a',
        pitch: 60, vel: 70, sentiment,
      });
    }
    store.finalize(session);
  }

  const analyzer = new CrossAnalyzer(store);
  const arcs = analyzer.emotionalArcs(2);
  assert.ok(arcs.length > 0, 'Should find at least one arc');
});

test('repertoire returns complete fleet profile', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  const s = store.create({ title: 'Rep' });
  store.capture(s, { text: 'hello', speaker: 'a', pitch: 60, vel: 70, sentiment: 'bright' });
  store.capture(s, { text: 'create', speaker: 'b', pitch: 72, vel: 80, sentiment: 'creative' });
  store.finalize(s);

  const analyzer = new CrossAnalyzer(store);
  const r = analyzer.repertoire();
  assert.ok(r.summary.totalSessions === 1);
  assert.ok(r.summary.totalEvents === 2);
  assert.ok(r.houseStyle.key);
  assert.ok(r.houseStyle.mode);
});

test('report generates human-readable output', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  const s = store.create({ title: 'Report Test' });
  store.capture(s, { text: 'hello world', speaker: 'a', pitch: 60, vel: 70, sentiment: 'bright' });
  store.finalize(s);

  const analyzer = new CrossAnalyzer(store);
  const report = analyzer.report();
  assert.ok(report.includes('FLEET REPERTOIRE'));
  assert.ok(report.includes('Report Test') || report.includes('a:'));
});

test('quoteGraph builds cross-reference network', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  const s1 = store.create({ title: 'Orig' });
  store.save(s1);
  const s2 = store.create({ title: 'Quote' });
  store.addQuote(s2, 0, s1, 0, 'test');
  store.save(s2);

  const analyzer = new CrossAnalyzer(store);
  const graph = analyzer.quoteGraph();
  assert.ok(graph[s2.id]);
  assert.ok(graph[s2.id].includes(s1.id));
});

// ── Integration Test ─────────────────────────────────────────────────

console.log('\n── Integration ──');

test('full workflow: create, capture, finalize, replay, analyze', () => {
  const dir = tmpDir();
  const store = new SessionStore(dir);

  // Create and populate session
  const session = store.create({ title: 'Full Workflow', bpm: 140 });
  const messages = [
    { text: 'The ensemble is warming up', speaker: 'riker', pitch: 60, vel: 60, sentiment: 'neutral' },
    { text: 'I hear something beautiful', speaker: 'wesley', pitch: 79, vel: 50, sentiment: 'bright' },
    { text: 'What if we play in F#?', speaker: 'phi3', pitch: 66, vel: 70, sentiment: 'inquiring' },
    { text: 'Yes! Imagine a sunset in sound', speaker: 'riker', pitch: 78, vel: 85, sentiment: 'creative' },
    { text: 'The harmony is breaking', speaker: 'hermes', pitch: 42, vel: 95, sentiment: 'tense' },
    { text: 'No, listen closer', speaker: 'wesley', pitch: 74, vel: 45, sentiment: 'bright' },
    { text: 'They resolve together', speaker: 'riker', pitch: 66, vel: 80, sentiment: 'bright' },
  ];

  for (const m of messages) store.capture(session, m);
  store.finalize(session);

  // Verify analysis
  assert.ok(session.analysis.tension > 0 || session.analysis.energy > 0);
  assert.ok(session.participants.length === 4);

  // Replay
  const engine = new ReplayEngine(store);
  engine.load(session.id);
  const events = [];
  engine.on('event', (e) => events.push(e));
  engine.playInstant();
  assert.strictEqual(events.length, 7);

  // Cross-analysis
  const analyzer = new CrossAnalyzer(store);
  const fleet = analyzer.fleetStats();
  assert.strictEqual(fleet.totalSessions, 1);
  assert.strictEqual(fleet.totalEvents, 7);

  // Score output
  const score = store.toScore(session);
  assert.ok(score.includes('Full Workflow'));

  // Cleanup
  cleanup();
});

// ── Results ──────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────\n`);

if (failed > 0) {
  cleanup();
  process.exit(1);
}

cleanup();
process.exit(0);
