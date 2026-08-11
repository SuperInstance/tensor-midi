// ═══════════════════════════════════════════════════════════════════
// SWMIDI Wire Format Codec — JavaScript Implementation
// Port of slackwater-rust/crates/swmidi
// Every event is exactly 8 bytes. No variable-length encoding.
// ═══════════════════════════════════════════════════════════════════

export const EventType = {
  NoteOn: 0,
  NoteOff: 1,
  ControlChange: 2,
  ProgramChange: 3,
  Meta: 4,
};

export const EVENT_NAMES = {
  0: 'NoteOn',
  1: 'NoteOff',
  2: 'ControlChange',
  3: 'ProgramChange',
  4: 'Meta',
};

// Action types — what the "pitch" byte means for conversation events
export const ActionType = {
  // Conversation actions
  MessageSent: 0,
  MessageReceived: 1,
  TypingStart: 2,
  TypingStop: 3,
  UserJoin: 4,
  UserLeave: 5,
  // Build actions
  FileCreated: 10,
  FileModified: 11,
  FileDeleted: 12,
  BuildStart: 20,
  BuildComplete: 21,
  BuildFailed: 22,
  DeployStart: 30,
  DeployComplete: 31,
  // Creative actions
  IdeaProposed: 40,
  IdeaAccepted: 41,
  IdeaRejected: 42,
  // System actions
  AgentSpawn: 50,
  AgentComplete: 51,
  Heartbeat: 60,
  Error: 127,
};

// Friction bitfield — the "error_mask" byte
export const Friction = {
  None: 0x00,
  Timeout: 0x01,      // Agent took too long
  Conflict: 0x02,     // Two agents collided
  RateLimit: 0x04,    // API rate limited
  Ambiguity: 0x08,    // Unclear intent
  ImportError: 0x10,  // Missing dependency
  SyntaxError: 0x20,  // Code didn't parse
  TypeMismatch: 0x40, // Wrong type
  NetworkError: 0x80, // Network failure
};

/// Encode a single SWMIDI event to 8 bytes
export function encodeEvent(event) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  
  // byte 0: status = type(4 bits) | channel(4 bits)
  view.setUint8(0, ((event.eventType & 0x0F) << 4) | (event.channel & 0x0F));
  
  // byte 1: pitch (action type)
  view.setUint8(1, event.pitch & 0x7F);
  
  // byte 2: velocity (weight/confidence)
  view.setUint8(2, event.velocity & 0x7F);
  
  // byte 3: error_mask (friction bitfield)
  view.setUint8(3, event.errorMask & 0xFF);
  
  // bytes 4-7: tick (uint32, little-endian)
  view.setUint32(4, event.tick >>> 0, true);
  
  return new Uint8Array(buf);
}

/// Decode 8 bytes to a SWMIDI event
export function decodeEvent(bytes, offset = 0) {
  if (bytes.length - offset < 8) {
    throw new Error('Truncated: need at least 8 bytes');
  }
  
  const status = bytes[offset];
  const eventType = (status >> 4) & 0x0F;
  const channel = status & 0x0F;
  
  if (eventType > 4) {
    throw new Error(`Invalid event type: ${eventType}`);
  }
  
  return {
    eventType,
    eventTypeLabel: EVENT_NAMES[eventType] || 'Unknown',
    channel,
    pitch: bytes[offset + 1] & 0x7F,
    velocity: bytes[offset + 2] & 0x7F,
    errorMask: bytes[offset + 3],
    tick: (bytes[offset + 4]) |
          (bytes[offset + 5] << 8) |
          (bytes[offset + 6] << 16) |
          (bytes[offset + 7] << 24),
    // >>> 0 to keep unsigned
  };
}

/// Encode a stream of events
export function encodeStream(events) {
  const totalBytes = events.length * 8;
  const result = new Uint8Array(totalBytes);
  for (let i = 0; i < events.length; i++) {
    const encoded = encodeEvent(events[i]);
    result.set(encoded, i * 8);
  }
  return result;
}

/// Decode a byte stream to events
export function decodeStream(bytes) {
  if (bytes.length % 8 !== 0) {
    throw new Error('Truncated: byte length not multiple of 8');
  }
  const events = [];
  for (let i = 0; i < bytes.length; i += 8) {
    events.push(decodeEvent(bytes, i));
  }
  return events;
}

/// Check if an event has friction
export function hasFriction(event) {
  return event.errorMask !== 0;
}

/// Check if an event is flow (no friction)
export function isFlow(event) {
  return event.errorMask === 0;
}

/// Create a conversation event from a message
export function messageToEvent(message, channel, tick) {
  const actionType = message.direction === 'sent' ? ActionType.MessageSent : ActionType.MessageReceived;
  const velocity = Math.min(127, Math.max(1, Math.round(message.weight * 127)));
  const friction = message.friction || Friction.None;
  
  return {
    eventType: EventType.NoteOn,
    channel: channel & 0x0F,
    pitch: actionType & 0x7F,
    velocity,
    errorMask: friction,
    tick: tick >>> 0,
  };
}

/// SWMIDI Stream — a collection of events
export class SwmidiStream {
  constructor() {
    this.events = [];
  }
  
  /** Number of events in the stream */
  get length() {
    return this.events.length;
  }
  
  push(event) {
    this.events.push(event);
  }
  
  encode() {
    return encodeStream(this.events);
  }
  
  static decode(bytes) {
    const stream = new SwmidiStream();
    stream.events = decodeStream(bytes);
    return stream;
  }
  
  sort() {
    this.events.sort((a, b) => a.tick - b.tick);
  }
  
  inTickRange(start, end) {
    return this.events.filter(e => e.tick >= start && e.tick <= end);
  }
  
  flowCount() {
    return this.events.filter(e => isFlow(e)).length;
  }
  
  frictionCount() {
    return this.events.filter(e => hasFriction(e)).length;
  }
  
  get length() {
    return this.events.length;
  }
}
