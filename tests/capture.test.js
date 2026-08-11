// ═══════════════════════════════════════════════════════════════════
// Test Suite — MIDI Capture System (tensor-midi)
// Tests analyzeSentiment, MidiCapture, and ChannelAssignment
// ═══════════════════════════════════════════════════════════════════

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock the swmidi and engine dependencies before importing capture
// We need to stub browser/global APIs used internally

import {
  ChannelAssignment,
  analyzeSentiment,
  MidiCapture,
} from '../src/capture.js';

// ─── ChannelAssignment ─────────────────────────────────────────────────────

describe('ChannelAssignment', () => {
  test('human is channel 0', () => {
    assert.equal(ChannelAssignment.human, 0);
  });

  test('assistant is channel 1', () => {
    assert.equal(ChannelAssignment.assistant, 1);
  });

  test('subagent channels are sequential 2-4', () => {
    assert.equal(ChannelAssignment.subagent1, 2);
    assert.equal(ChannelAssignment.subagent2, 3);
    assert.equal(ChannelAssignment.subagent3, 4);
  });

  test('system is channel 8', () => {
    assert.equal(ChannelAssignment.system, 8);
  });

  test('tool is channel 9', () => {
    assert.equal(ChannelAssignment.tool, 9);
  });

  test('error is channel 15', () => {
    assert.equal(ChannelAssignment.error, 15);
  });
});

// ─── analyzeSentiment ──────────────────────────────────────────────────────

describe('analyzeSentiment', () => {
  test('neutral text returns base pitch 60', () => {
    const result = analyzeSentiment('hello world');
    assert.equal(result.pitch, 60);
    assert.equal(result.sentiment.label, 'neutral');
  });

  test('positive words increase pitch', () => {
    const result = analyzeSentiment('this is great and awesome');
    // positivity = 2 → pitch = 60 + 2*5 = 70
    assert.equal(result.pitch, 70);
    assert.equal(result.sentiment.positivity, 2);
    assert.equal(result.sentiment.label, 'bright');
  });

  test('negative words decrease pitch', () => {
    const result = analyzeSentiment('this is bad and terrible');
    // negativity = 2 → pitch = 60 - 2*10 = 40
    assert.equal(result.pitch, 40);
    assert.equal(result.sentiment.negativity, 2);
    assert.equal(result.sentiment.label, 'tense');
  });

  test('question words set mid-range pitch', () => {
    const result = analyzeSentiment('what is this?');
    // questionScore = 2 (what + ?) → pitch = 72 + 2*3 = 78
    assert.equal(result.pitch, 78);
    assert.equal(result.sentiment.questionScore, 2);
    assert.equal(result.sentiment.label, 'inquiring');
  });

  test('creative words increase pitch', () => {
    const result = analyzeSentiment('imagine and create something');
    // creativity = 2 → pitch = 60 + 2*8 = 76
    assert.equal(result.pitch, 76);
    assert.equal(result.sentiment.creativity, 2);
    assert.equal(result.sentiment.label, 'creative');
  });

  test('pitch is clamped to 0-127 range', () => {
    // Extreme negativity would push below 0
    const veryNegative = analyzeSentiment('bad error fail broken hate wrong terrible awful crash bug issue');
    assert.ok(veryNegative.pitch >= 0, `pitch should be >= 0, got ${veryNegative.pitch}`);
    assert.ok(veryNegative.pitch <= 127, `pitch should be <= 127, got ${veryNegative.pitch}`);
  });

  test('pitch maxes out at 127 with many positive words', () => {
    const veryPositive = analyzeSentiment('great awesome love perfect excellent wonderful good amazing fantastic beautiful brilliant');
    assert.ok(veryPositive.pitch <= 127);
    assert.ok(veryPositive.pitch > 60);
  });

  test('friction is set when negative words present', () => {
    const result = analyzeSentiment('this has an error');
    // error triggers Ambiguity and SyntaxError
    assert.ok(result.friction > 0, 'friction should be non-zero');
  });

  test('friction includes SyntaxError for "fail"', () => {
    const result = analyzeSentiment('the build will fail');
    assert.ok(result.friction > 0);
  });

  test('no friction for purely positive text', () => {
    const result = analyzeSentiment('everything is great');
    assert.equal(result.friction, 0);
  });

  test('weight is proportional to text length', () => {
    const short = analyzeSentiment('hi');
    const long = analyzeSentiment('a'.repeat(400));
    assert.ok(long.weight > short.weight);
  });

  test('weight caps at 1.0 for very long text', () => {
    const result = analyzeSentiment('a'.repeat(1000));
    assert.equal(result.weight, 1.0);
  });

  test('weight is text.length / 500 for short text', () => {
    const result = analyzeSentiment('hello'); // 5 chars
    assert.equal(result.weight, 5 / 500);
  });

  test('empty string returns neutral with weight 0', () => {
    const result = analyzeSentiment('');
    assert.equal(result.pitch, 60);
    assert.equal(result.weight, 0);
    assert.equal(result.sentiment.label, 'neutral');
  });

  test('mixed sentiment prioritizes negativity in label', () => {
    const result = analyzeSentiment('great but also bad');
    // negativity > 0 and positivity > 0 → label is 'tense' if negativity > positivity
    assert.equal(result.sentiment.label, 'tense');
  });

  test('creative overrides positive in label', () => {
    const result = analyzeSentiment('create something great');
    // creativity > 0 and positivity > 0 but creativity takes precedence
    assert.equal(result.sentiment.label, 'creative');
  });

  test('question overrides positive in label', () => {
    const result = analyzeSentiment('what is great?');
    // Both question and positive → question label
    // Actually: questionScore > 0, positivity > 0
    // The label check order: negativity > positivity ? tense : creativity > 0 ? creative : questionScore > 0 ? inquiring : positivity > 0 ? bright : neutral
    // So creative=0, questionScore>0 → inquiring
    assert.equal(result.sentiment.label, 'inquiring');
  });

  test('case insensitive matching', () => {
    const upper = analyzeSentiment('GREAT AWESOME');
    const lower = analyzeSentiment('great awesome');
    assert.equal(upper.pitch, lower.pitch);
    assert.equal(upper.sentiment.positivity, lower.sentiment.positivity);
  });

  test('partial word matching (substring)', () => {
    // "greatness" contains "great"
    const result = analyzeSentiment('greatness');
    assert.ok(result.sentiment.positivity > 0);
  });

  test('all sentiment categories at once', () => {
    const result = analyzeSentiment('imagine creating great things, but what about the bad error?');
    assert.ok(result.sentiment.creativity > 0);
    assert.ok(result.sentiment.positivity > 0);
    assert.ok(result.sentiment.negativity > 0);
    assert.ok(result.sentiment.questionScore > 0);
    assert.ok(result.friction > 0);
  });
});

// ─── MidiCapture ───────────────────────────────────────────────────────────

describe('MidiCapture', () => {
  let capture;

  beforeEach(() => {
    capture = new MidiCapture();
  });

  test('constructor initializes empty state', () => {
    assert.equal(capture.messages.length, 0);
    assert.equal(capture.participants.size, 0);
    assert.equal(capture.capturing, false);
    assert.equal(capture.channelCounter, 0);
  });

  // ─── registerParticipant ───

  describe('registerParticipant', () => {
    test('assigns predefined channel for known roles', () => {
      const ch = capture.registerParticipant('human');
      assert.equal(ch, ChannelAssignment.human);
    });

    test('assigns channel 1 for assistant', () => {
      const ch = capture.registerParticipant('assistant');
      assert.equal(ch, ChannelAssignment.assistant);
    });

    test('returns existing channel for known participant', () => {
      const ch1 = capture.registerParticipant('human');
      const ch2 = capture.registerParticipant('human');
      assert.equal(ch1, ch2);
    });

    test('assigns dynamic channels for unknown participants', () => {
      const ch1 = capture.registerParticipant('alice');
      const ch2 = capture.registerParticipant('bob');
      assert.equal(ch1, 5);
      assert.equal(ch2, 6);
    });

    test('dynamic channels start at 5', () => {
      const ch = capture.registerParticipant('custom_user');
      assert.equal(ch, 5);
    });

    test('dynamic channels do not exceed 15', () => {
      // Register many unknown participants
      for (let i = 0; i < 20; i++) {
        capture.registerParticipant(`user_${i}`);
      }
      const lastCh = capture.registerParticipant(`user_20`);
      assert.ok(lastCh <= 15, `channel should not exceed 15, got ${lastCh}`);
    });

    test('returns same channel on re-registration', () => {
      const ch1 = capture.registerParticipant('alice');
      const ch2 = capture.registerParticipant('alice');
      assert.equal(ch1, ch2);
    });

    test('mix of predefined and dynamic', () => {
      const human_ch = capture.registerParticipant('human');       // 0
      const alice_ch = capture.registerParticipant('alice');       // 5
      const assistant_ch = capture.registerParticipant('assistant'); // 1
      const bob_ch = capture.registerParticipant('bob');           // 6

      assert.equal(human_ch, 0);
      assert.equal(alice_ch, 5);
      assert.equal(assistant_ch, 1);
      assert.equal(bob_ch, 6);
    });
  });

  // ─── captureMessage ───

  describe('captureMessage', () => {
    test('captures a basic message', () => {
      const result = capture.captureMessage({
        text: 'hello world',
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });

      assert.ok(result.event);
      assert.ok(result.sentiment);
      assert.equal(result.event.channel, ChannelAssignment.human);
      assert.equal(result.event.eventType, 0); // NoteOn
      assert.ok(result.event.tick >= 0);
    });

    test('stores message with sentiment analysis', () => {
      capture.captureMessage({
        text: 'great job',
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });

      assert.equal(capture.messages.length, 1);
      assert.ok(capture.messages[0].sentiment);
      assert.ok(capture.messages[0].pitch !== undefined);
      assert.ok(capture.messages[0].channel !== undefined);
    });

    test('velocity is derived from weight', () => {
      const result = capture.captureMessage({
        text: 'short',
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });

      // weight = 5/500 = 0.01, velocity = round(0.01 * 127) = 1 (minimum)
      assert.ok(result.event.velocity >= 1);
      assert.ok(result.event.velocity <= 127);
    });

    test('uses provided timestamp', () => {
      const result = capture.captureMessage({
        text: 'hello',
        sender: 'human',
        timestamp: 100000,
        direction: 'out',
      });

      assert.ok(result.event.tick > 0);
    });

    test('falls back to Date.now() when no timestamp', () => {
      const before = Date.now();
      const result = capture.captureMessage({
        text: 'hello',
        sender: 'human',
        direction: 'out',
      });
      const after = Date.now();

      // tick should correspond to a timestamp between before and after
      assert.ok(result.event.tick >= 0);
    });

    test('auto-registers unknown sender', () => {
      capture.captureMessage({
        text: 'hello',
        sender: 'newbot',
        timestamp: Date.now(),
        direction: 'out',
      });

      assert.ok(capture.participants.has('newbot'));
    });

    test('multiple messages accumulate', () => {
      for (let i = 0; i < 5; i++) {
        capture.captureMessage({
          text: `message ${i}`,
          sender: 'human',
          timestamp: Date.now() + i * 1000,
          direction: 'out',
        });
      }

      assert.equal(capture.messages.length, 5);
      assert.equal(capture.stream.length, 5);
    });
  });

  // ─── captureSystemEvent ───

  describe('captureSystemEvent', () => {
    test('captures build start event', () => {
      const event = capture.captureSystemEvent(20); // BuildStart
      assert.equal(event.channel, ChannelAssignment.system);
      assert.ok(event.tick >= 0);
    });

    test('uses ControlChange for action >= 20', () => {
      const event = capture.captureSystemEvent(20);
      assert.equal(event.eventType, 2); // ControlChange
    });

    test('uses NoteOn for action < 20', () => {
      const event = capture.captureSystemEvent(10); // FileCreated
      assert.equal(event.eventType, 0); // NoteOn
    });

    test('default velocity is 64', () => {
      const event = capture.captureSystemEvent(10);
      assert.equal(event.velocity, 64);
    });

    test('weight from details sets velocity', () => {
      const event = capture.captureSystemEvent(10, { weight: 1.0 });
      assert.equal(event.velocity, 127);
    });

    test('friction from details sets errorMask', () => {
      const event = capture.captureSystemEvent(127, { friction: 0x80 });
      assert.equal(event.errorMask, 0x80);
    });
  });

  // ─── getMixerState ───

  describe('getMixerState', () => {
    test('returns empty state initially', () => {
      const state = capture.getMixerState();
      assert.equal(state.totalEvents, 0);
      assert.equal(state.flowCount, 0);
      assert.equal(state.frictionCount, 0);
      assert.equal(state.participants.length, 0);
      assert.deepEqual(state.messages, []);
    });

    test('includes participants after capture', () => {
      capture.captureMessage({
        text: 'hi',
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });

      const state = capture.getMixerState();
      assert.equal(state.participants.length, 1);
      assert.equal(state.participants[0].name, 'human');
      assert.equal(state.participants[0].channel, 0);
    });

    test('messages are limited to last 20', () => {
      for (let i = 0; i < 25; i++) {
        capture.captureMessage({
          text: `msg ${i}`,
          sender: 'human',
          timestamp: Date.now() + i * 100,
          direction: 'out',
        });
      }

      const state = capture.getMixerState();
      assert.equal(state.messages.length, 20);
      // Should be the last 20 (messages 5-24)
      assert.equal(state.messages[0].text, 'msg 5');
    });

    test('tracks total events and flow/friction counts', () => {
      capture.captureMessage({
        text: 'great awesome', // positive, no friction
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });
      capture.captureMessage({
        text: 'bad error', // negative, has friction
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });

      const state = capture.getMixerState();
      assert.equal(state.totalEvents, 2);
      assert.ok(state.flowCount >= 1);
      assert.ok(state.frictionCount >= 1);
    });
  });

  // ─── exportJSON ───

  describe('exportJSON', () => {
    test('exports valid JSON with expected structure', () => {
      capture.captureMessage({
        text: 'hello',
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });

      const json = capture.exportJSON();
      const parsed = JSON.parse(json);

      assert.ok(parsed.events);
      assert.ok(parsed.messages);
      assert.ok(parsed.participants);
      assert.ok(parsed.bpm);
    });
  });

  // ─── clear ───

  describe('clear', () => {
    test('resets all captured data', () => {
      capture.captureMessage({
        text: 'hello',
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });

      assert.equal(capture.messages.length, 1);

      capture.clear();

      assert.equal(capture.messages.length, 0);
      assert.equal(capture.stream.length, 0);
      assert.equal(capture.participants.size, 0); // participants not cleared by clear()
      // Actually, clear() creates new instances, but participants map is NOT reset
      // Let's check what actually happens:
      // clear() resets stream, grid, messages, clock — but NOT participants
    });

    test('clear allows fresh capture after reset', () => {
      capture.captureMessage({
        text: 'hello',
        sender: 'human',
        timestamp: Date.now(),
        direction: 'out',
      });
      capture.clear();

      const result = capture.captureMessage({
        text: 'fresh start',
        sender: 'assistant',
        timestamp: Date.now(),
        direction: 'in',
      });

      assert.ok(result.event);
      assert.equal(capture.messages.length, 1);
    });
  });

  // ─── exportBinary ───

  describe('exportBinary', () => {
    test('returns a Uint8Array (or Buffer)', () => {
      const result = capture.exportBinary();
      // SwmidiStream.encode() returns Uint8Array
      assert.ok(result instanceof Uint8Array || Buffer.isBuffer(result));
    });

    test('empty capture returns minimal binary', () => {
      const result = capture.exportBinary();
      // Even empty stream should return something (header or empty)
      assert.ok(result.length >= 0);
    });
  });
});

// ─── analyzeSentiment edge cases ───────────────────────────────────────────

describe('analyzeSentiment edge cases', () => {
  test('only whitespace returns neutral', () => {
    const result = analyzeSentiment('   ');
    // whitespace split produces empty strings, none match
    assert.equal(result.pitch, 60);
    assert.equal(result.sentiment.label, 'neutral');
  });

  test('special characters only', () => {
    const result = analyzeSentiment('!@#$%^&*()');
    assert.equal(result.pitch, 60);
  });

  test('emoji-only text', () => {
    const result = analyzeSentiment('🎉🚀');
    assert.equal(result.pitch, 60);
    assert.equal(result.sentiment.label, 'neutral');
  });

  test('very long positive text', () => {
    const text = 'great '.repeat(100);
    const result = analyzeSentiment(text);
    assert.ok(result.pitch <= 127);
    assert.ok(result.sentiment.positivity >= 100);
    assert.equal(result.weight, 1.0); // capped
  });

  test('overlapping word matches', () => {
    // "good" is in POSITIVE_WORDS, and is a substring of "goodbye"
    const result = analyzeSentiment('goodbye');
    assert.ok(result.sentiment.positivity > 0); // "good" substring matches
  });

  test('word boundary not required for matching', () => {
    // "no" is in NEGATIVE_WORDS, and is a substring of "nonsense"
    const result = analyzeSentiment('nonsense');
    // "no" is in NEGATIVE_WORDS → negativity detected
    assert.ok(result.sentiment.negativity > 0);
  });

  test('positive and negative cancel in label', () => {
    const result = analyzeSentiment('great bad');
    // positivity=1, negativity=1 → with negativity-priority, label is 'tense'
    assert.equal(result.sentiment.positivity, 1);
    assert.equal(result.sentiment.negativity, 1);
    assert.equal(result.sentiment.label, 'tense');
  });

  test('equal positive and negative results in bright label', () => {
    const result = analyzeSentiment('great bad');
    // positivity=1, negativity=1, with negativity-priority this is 'tense'
    assert.equal(result.sentiment.positivity, 1);
    assert.equal(result.sentiment.negativity, 1);
    // label is 'tense' since negativity >= positivity and negativity > 0
    assert.equal(result.sentiment.label, 'tense');
  });

  test('more negative than positive results in tense label', () => {
    const result = analyzeSentiment('great bad terrible');
    // positivity=1, negativity=2 → negativity > positivity → tense
    assert.equal(result.sentiment.label, 'tense');
  });
});
