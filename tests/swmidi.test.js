// ═══════════════════════════════════════════════════════════════════
// Test Suite — SWMIDI Wire Format (tensor-midi)
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EventType, EVENT_NAMES, ActionType, Friction,
  encodeEvent, decodeEvent, encodeStream, decodeStream,
  hasFriction, isFlow,
  messageToEvent, SwmidiStream,
} from '../src/swmidi.js';

describe('EventType constants', () => {
  test('NoteOn = 0', () => assert.equal(EventType.NoteOn, 0));
  test('NoteOff = 1', () => assert.equal(EventType.NoteOff, 1));
  test('ControlChange = 2', () => assert.equal(EventType.ControlChange, 2));
  test('ProgramChange = 3', () => assert.equal(EventType.ProgramChange, 3));
  test('Meta = 4', () => assert.equal(EventType.Meta, 4));
});

describe('ActionType constants', () => {
  test('MessageSent = 0', () => assert.equal(ActionType.MessageSent, 0));
  test('MessageReceived = 1', () => assert.equal(ActionType.MessageReceived, 1));
  test('FileCreated = 10', () => assert.equal(ActionType.FileCreated, 10));
  test('BuildStart = 20', () => assert.equal(ActionType.BuildStart, 20));
  test('Error = 127', () => assert.equal(ActionType.Error, 127));
});

describe('Friction constants', () => {
  test('None = 0', () => assert.equal(Friction.None, 0));
  test('Timeout = 0x01', () => assert.equal(Friction.Timeout, 1));
  test('Conflict = 0x02', () => assert.equal(Friction.Conflict, 2));
  test('NetworkError = 0x80', () => assert.equal(Friction.NetworkError, 128));
  test('all flags are powers of 2', () => {
    // Each friction flag should be a single bit
    const flags = [Friction.Timeout, Friction.Conflict, Friction.RateLimit, Friction.Ambiguity,
                   Friction.ImportError, Friction.SyntaxError, Friction.TypeMismatch, Friction.NetworkError];
    for (const f of flags) {
      assert.equal(f & (f - 1), 0, `Friction ${f} is not a power of 2`);
      assert.ok(f > 0, `Friction flag should be > 0`);
    }
  });
  test('flags are composable via bitwise OR', () => {
    const combined = Friction.Timeout | Friction.Conflict | Friction.NetworkError;
    assert.equal(combined, 0x83);
  });
});

describe('encodeEvent / decodeEvent round-trip', () => {
  const sampleEvent = {
    eventType: EventType.NoteOn,
    channel: 3,
    pitch: 64,
    velocity: 100,
    errorMask: Friction.None,
    tick: 12345,
  };

  test('encoded length is 8 bytes', () => {
    const bytes = encodeEvent(sampleEvent);
    assert.equal(bytes.length, 8);
  });

  test('round-trip preserves all fields', () => {
    const bytes = encodeEvent(sampleEvent);
    const decoded = decodeEvent(bytes);
    assert.equal(decoded.eventType, sampleEvent.eventType);
    assert.equal(decoded.channel, sampleEvent.channel);
    assert.equal(decoded.pitch, sampleEvent.pitch);
    assert.equal(decoded.velocity, sampleEvent.velocity);
    assert.equal(decoded.errorMask, sampleEvent.errorMask);
    assert.equal(decoded.tick, sampleEvent.tick);
  });

  test('decode includes eventTypeLabel', () => {
    const bytes = encodeEvent(sampleEvent);
    const decoded = decodeEvent(bytes);
    assert.equal(decoded.eventTypeLabel, 'NoteOn');
  });

  test('channel max (15) round-trips', () => {
    const ev = { ...sampleEvent, channel: 15 };
    const decoded = decodeEvent(encodeEvent(ev));
    assert.equal(decoded.channel, 15);
  });

  test('pitch max (127) round-trips', () => {
    const ev = { ...sampleEvent, pitch: 127 };
    const decoded = decodeEvent(encodeEvent(ev));
    assert.equal(decoded.pitch, 127);
  });

  test('velocity max (127) round-trips', () => {
    const ev = { ...sampleEvent, velocity: 127 };
    const decoded = decodeEvent(encodeEvent(ev));
    assert.equal(decoded.velocity, 127);
  });

  test('large tick (4294967295) round-trips', () => {
    const ev = { ...sampleEvent, tick: 0xFFFFFFFF };
    const decoded = decodeEvent(encodeEvent(ev));
    assert.equal(decoded.tick, 0xFFFFFFFF);
  });

  test('zero tick round-trips', () => {
    const ev = { ...sampleEvent, tick: 0 };
    const decoded = decodeEvent(encodeEvent(ev));
    assert.equal(decoded.tick, 0);
  });

  test('friction flags survive round-trip', () => {
    const ev = { ...sampleEvent, errorMask: Friction.Timeout | Friction.NetworkError };
    const decoded = decodeEvent(encodeEvent(ev));
    assert.equal(decoded.errorMask, Friction.Timeout | Friction.NetworkError);
  });
});

describe('decodeEvent errors', () => {
  test('fewer than 8 bytes throws', () => {
    assert.throws(() => decodeEvent(new Uint8Array([0, 1, 2, 3, 4, 5, 6])), /Truncated/);
  });
  test('invalid event type throws', () => {
    // Event type 5-15 are invalid; encode with raw byte
    const bytes = new Uint8Array([0x50, 0, 0, 0, 0, 0, 0, 0]); // type=5
    assert.throws(() => decodeEvent(bytes), /Invalid event type/);
  });
});

describe('encodeStream / decodeStream', () => {
  test('empty stream', () => {
    const bytes = encodeStream([]);
    assert.equal(bytes.length, 0);
    assert.deepEqual(decodeStream(bytes), []);
  });

  test('single event stream', () => {
    const events = [{
      eventType: EventType.NoteOn, channel: 0, pitch: 0,
      velocity: 0, errorMask: 0, tick: 0,
    }];
    const bytes = encodeStream(events);
    assert.equal(bytes.length, 8);
    assert.equal(decodeStream(bytes).length, 1);
  });

  test('multi-event stream length is n * 8', () => {
    const events = [
      { eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 0 },
      { eventType: 1, channel: 1, pitch: 64, velocity: 100, errorMask: 0, tick: 96 },
      { eventType: 2, channel: 2, pitch: 32, velocity: 50, errorMask: 2, tick: 192 },
    ];
    const bytes = encodeStream(events);
    assert.equal(bytes.length, 24);
  });

  test('stream round-trip preserves order', () => {
    const events = [
      { eventType: 0, channel: 0, pitch: 10, velocity: 50, errorMask: 0, tick: 100 },
      { eventType: 1, channel: 1, pitch: 20, velocity: 60, errorMask: 1, tick: 200 },
      { eventType: 3, channel: 5, pitch: 40, velocity: 80, errorMask: 0, tick: 300 },
    ];
    const decoded = decodeStream(encodeStream(events));
    assert.equal(decoded.length, 3);
    assert.equal(decoded[0].pitch, 10);
    assert.equal(decoded[1].pitch, 20);
    assert.equal(decoded[2].pitch, 40);
  });

  test('non-multiple-of-8 stream throws', () => {
    assert.throws(() => decodeStream(new Uint8Array(7)), /Truncated/);
    assert.throws(() => decodeStream(new Uint8Array(9)), /Truncated/);
  });
});

describe('hasFriction / isFlow', () => {
  test('no friction → isFlow true', () => {
    const ev = { errorMask: 0 };
    assert.equal(isFlow(ev), true);
    assert.equal(hasFriction(ev), false);
  });

  test('any friction flag → hasFriction true', () => {
    const ev = { errorMask: Friction.Timeout };
    assert.equal(hasFriction(ev), true);
    assert.equal(isFlow(ev), false);
  });

  test('multiple friction flags', () => {
    const ev = { errorMask: Friction.Conflict | Friction.RateLimit | Friction.SyntaxError };
    assert.equal(hasFriction(ev), true);
    assert.equal(isFlow(ev), false);
  });
});

describe('messageToEvent', () => {
  test('sent message → MessageSent action', () => {
    const msg = { direction: 'sent', weight: 0.5 };
    const ev = messageToEvent(msg, 0, 100);
    assert.equal(ev.pitch, ActionType.MessageSent);
    assert.equal(ev.eventType, EventType.NoteOn);
    assert.equal(ev.tick, 100);
  });

  test('received message → MessageReceived action', () => {
    const msg = { direction: 'received', weight: 0.8 };
    const ev = messageToEvent(msg, 1, 200);
    assert.equal(ev.pitch, ActionType.MessageReceived);
  });

  test('weight maps to velocity', () => {
    const msg = { direction: 'sent', weight: 1.0 };
    const ev = messageToEvent(msg, 0, 0);
    assert.equal(ev.velocity, 127);
  });

  test('zero weight maps to velocity 1 (min)', () => {
    const msg = { direction: 'sent', weight: 0 };
    const ev = messageToEvent(msg, 0, 0);
    assert.equal(ev.velocity, 1);
  });

  test('weight > 1 clamps to 127', () => {
    const msg = { direction: 'sent', weight: 5.0 };
    const ev = messageToEvent(msg, 0, 0);
    assert.equal(ev.velocity, 127);
  });

  test('friction from message is preserved', () => {
    const msg = { direction: 'sent', weight: 1.0, friction: Friction.Timeout };
    const ev = messageToEvent(msg, 0, 0);
    assert.equal(ev.errorMask, Friction.Timeout);
  });

  test('default friction is None', () => {
    const msg = { direction: 'sent', weight: 1.0 };
    const ev = messageToEvent(msg, 0, 0);
    assert.equal(ev.errorMask, 0);
  });
});

describe('SwmidiStream', () => {
  test('empty stream', () => {
    const stream = new SwmidiStream();
    assert.equal(stream.length, 0);
  });

  test('push adds events', () => {
    const stream = new SwmidiStream();
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 0 });
    stream.push({ eventType: 1, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 48 });
    assert.equal(stream.length, 2);
  });

  test('encode/decode round-trip', () => {
    const stream = new SwmidiStream();
    stream.push({ eventType: 0, channel: 0, pitch: 10, velocity: 50, errorMask: 0, tick: 0 });
    stream.push({ eventType: 1, channel: 0, pitch: 20, velocity: 60, errorMask: 1, tick: 96 });
    const bytes = stream.encode();
    const decoded = SwmidiStream.decode(bytes);
    assert.equal(decoded.length, 2);
    assert.equal(decoded.events[0].pitch, 10);
    assert.equal(decoded.events[1].pitch, 20);
  });

  test('sort orders by tick', () => {
    const stream = new SwmidiStream();
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 200 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 50 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 100 });
    stream.sort();
    assert.equal(stream.events[0].tick, 50);
    assert.equal(stream.events[1].tick, 100);
    assert.equal(stream.events[2].tick, 200);
  });

  test('inTickRange filters events', () => {
    const stream = new SwmidiStream();
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 50 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 100 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 150 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 200 });
    const range = stream.inTickRange(75, 175);
    assert.equal(range.length, 2);
  });

  test('flowCount counts non-friction events', () => {
    const stream = new SwmidiStream();
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 0 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 48 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 2, tick: 96 });
    assert.equal(stream.flowCount(), 2);
  });

  test('frictionCount counts friction events', () => {
    const stream = new SwmidiStream();
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 0 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 2, tick: 48 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 4, tick: 96 });
    assert.equal(stream.frictionCount(), 2);
  });

  test('flowCount + frictionCount = total', () => {
    const stream = new SwmidiStream();
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 0 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 1, tick: 48 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 0, tick: 96 });
    stream.push({ eventType: 0, channel: 0, pitch: 0, velocity: 0, errorMask: 2, tick: 144 });
    assert.equal(stream.flowCount() + stream.frictionCount(), stream.length);
  });
});
