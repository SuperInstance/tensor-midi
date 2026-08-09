// ═══════════════════════════════════════════════════════════════════
// Test Suite — Narrative Engine (tensor-midi)
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NarrativeEngine, classifyEvent, frictionBits, volumeWord,
} from '../narrative/narrative-engine.js';
import { Friction } from '../src/swmidi.js';
import { TICKS_PER_BAR } from '../src/engine.js';

function ev(overrides = {}) {
  return { channel: 0, pitch: 60, velocity: 60, errorMask: 0, tick: 0, ...overrides };
}

describe('classifyEvent', () => {
  test('friction present always reads as tense, regardless of pitch', () => {
    const result = classifyEvent(ev({ pitch: 90, errorMask: Friction.Timeout }));
    assert.equal(result.texture, 'tense');
  });

  test('high pitch, no friction, reads as questioning', () => {
    assert.equal(classifyEvent(ev({ pitch: 85 })).texture, 'questioning');
  });

  test('low pitch reads as grounded', () => {
    assert.equal(classifyEvent(ev({ pitch: 40 })).texture, 'grounded');
  });

  test('high velocity, mid pitch, no friction, reads as bright', () => {
    assert.equal(classifyEvent(ev({ pitch: 60, velocity: 100 })).texture, 'bright');
  });

  test('mid pitch, mid velocity, no friction, reads as neutral', () => {
    assert.equal(classifyEvent(ev({ pitch: 60, velocity: 60 })).texture, 'neutral');
  });

  test('boundary: pitch exactly 80 is questioning', () => {
    assert.equal(classifyEvent(ev({ pitch: 80 })).texture, 'questioning');
  });

  test('boundary: pitch exactly 45 is grounded', () => {
    assert.equal(classifyEvent(ev({ pitch: 45 })).texture, 'grounded');
  });
});

describe('frictionBits', () => {
  test('no bits set returns empty array', () => {
    assert.deepEqual(frictionBits(0), []);
  });

  test('single bit resolves to its name', () => {
    assert.deepEqual(frictionBits(Friction.Timeout), ['Timeout']);
  });

  test('multiple bits resolve in wire-declared order, not set order', () => {
    const mask = Friction.NetworkError | Friction.Timeout | Friction.Conflict;
    assert.deepEqual(frictionBits(mask), ['Timeout', 'Conflict', 'NetworkError']);
  });
});

describe('volumeWord', () => {
  test('is monotonic in distinctness across the velocity range', () => {
    const words = new Set([volumeWord(0), volumeWord(50), volumeWord(90), volumeWord(127)]);
    assert.ok(words.size >= 3, 'expected velocity bands to read differently');
  });
});

describe('NarrativeEngine.beat', () => {
  test('resolves speaker name from the voice registry', () => {
    const engine = new NarrativeEngine({ voices: { 0: 'Riker' } });
    const line = engine.beat(ev({ channel: 0 }));
    assert.match(line, /Riker/);
  });

  test('falls back to a channel label when the voice is unresolved', () => {
    const engine = new NarrativeEngine();
    const line = engine.beat(ev({ channel: 7 }));
    assert.match(line, /Channel 7/);
  });

  test('a friction event composes its friction bits into the line', () => {
    const engine = new NarrativeEngine({ voices: { 0: 'Hermes' } });
    const line = engine.beat(ev({ channel: 0, errorMask: Friction.Timeout | Friction.Conflict }));
    assert.match(line, /Hermes/);
    // Both friction clauses should be present, joined.
    assert.match(line, /;/);
  });

  test('is a pure function of the wire fields — same event, same line', () => {
    const engineA = new NarrativeEngine({ voices: { 2: 'Wesley' } });
    const engineB = new NarrativeEngine({ voices: { 2: 'Wesley' } });
    const event = ev({ channel: 2, pitch: 88, velocity: 40, tick: 12345 });
    assert.equal(engineA.beat(event), engineB.beat(event));
  });

  test('never leaks a raw {placeholder} into the output', () => {
    const engine = new NarrativeEngine({ voices: { 0: 'Casey' } });
    for (const errorMask of [0, Friction.Ambiguity, Friction.SyntaxError | Friction.NetworkError]) {
      const line = engine.beat(ev({ errorMask, tick: errorMask * 7 + 1 }));
      assert.doesNotMatch(line, /\{[a-zA-Z]+\}/, `leaked placeholder in: ${line}`);
    }
  });
});

describe('NarrativeEngine chapters', () => {
  test('no chapter is ready before a phrase of bars has closed', () => {
    const engine = new NarrativeEngine({ barsPerChapter: 4 });
    engine.beat(ev({ tick: 0 }));
    assert.equal(engine.chapter(), null);
  });

  test('a chapter appears once barsPerChapter bars have closed', () => {
    const engine = new NarrativeEngine({ barsPerChapter: 2 });
    // Three bars' worth of single events — crossing into bar 2 closes bar 0,
    // crossing into bar 3 closes bar 1, completing the first 2-bar phrase.
    engine.beat(ev({ channel: 0, tick: 0 }));
    engine.beat(ev({ channel: 0, tick: TICKS_PER_BAR }));
    engine.beat(ev({ channel: 0, tick: TICKS_PER_BAR * 2 }));
    const chapter = engine.chapter();
    assert.equal(typeof chapter, 'string');
    assert.match(chapter, /[Bb]ars? 1/);
  });

  test('chapter text never leaks a raw {placeholder}', () => {
    const engine = new NarrativeEngine({ voices: { 0: 'Riker', 1: 'Phi3' }, barsPerChapter: 1 });
    engine.beat(ev({ channel: 0, pitch: 90, tick: 0 }));
    engine.beat(ev({ channel: 1, pitch: 30, errorMask: Friction.Conflict, tick: TICKS_PER_BAR }));
    const chapter = engine.chapter();
    assert.ok(chapter);
    assert.doesNotMatch(chapter, /\{[a-zA-Z]+\}/, `leaked placeholder in: ${chapter}`);
  });
});

describe('NarrativeEngine.narrate', () => {
  test('sorts out-of-order events by tick before narrating', () => {
    const engine = new NarrativeEngine({ voices: { 0: 'Casey', 1: 'Wesley' } });
    const events = [
      ev({ channel: 1, tick: 100 }),
      ev({ channel: 0, tick: 0 }),
    ];
    const { beats } = engine.narrate(events);
    assert.match(beats[0], /Casey/);
    assert.match(beats[1], /Wesley/);
  });

  test('produces one beat per event', () => {
    const engine = new NarrativeEngine();
    const events = [ev({ tick: 0 }), ev({ tick: 50 }), ev({ tick: TICKS_PER_BAR + 5 })];
    const { beats } = engine.narrate(events);
    assert.equal(beats.length, 3);
  });
});

describe('NarrativeEngine.epilogue', () => {
  test('a session with no events is too brief for a form', () => {
    const engine = new NarrativeEngine();
    const { summary } = engine.epilogue();
    assert.match(summary, /Too brief/);
  });

  test('a populated session closes with a summary and flushes any partial phrase', () => {
    const engine = new NarrativeEngine({ barsPerChapter: 4 });
    engine.narrate([ev({ tick: 0 }), ev({ tick: TICKS_PER_BAR })]);
    assert.equal(engine.chapter(), null, 'phrase should still be open before epilogue');
    const { chapters, summary } = engine.epilogue();
    assert.equal(chapters.length, 1, 'epilogue should flush the partial phrase');
    assert.match(summary, /The set closes after 2 bars/);
  });

  test('two identical event streams produce an identical story end-to-end', () => {
    const events = [
      ev({ channel: 0, pitch: 88, tick: 0 }),
      ev({ channel: 1, pitch: 40, errorMask: Friction.RateLimit, tick: 300 }),
      ev({ channel: 0, velocity: 110, tick: TICKS_PER_BAR + 50 }),
    ];
    const voices = { 0: 'Hermes', 1: 'DeepSeek' };
    const engineA = new NarrativeEngine({ voices, barsPerChapter: 1 });
    const engineB = new NarrativeEngine({ voices, barsPerChapter: 1 });
    const resultA = engineA.narrate(events);
    const resultB = engineB.narrate(events);
    assert.deepEqual(resultA, resultB);
    assert.deepEqual(engineA.epilogue(), engineB.epilogue());
  });
});
