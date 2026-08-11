// ═══════════════════════════════════════════════════════════════════
// MIDI Capture System — Conversation → MIDI
// ═══════════════════════════════════════════════════════════════════
//
// Captures conversation messages and converts them to SWMIDI events.
// Each participant is a channel. Each message is a note.
// The sentiment/intent determines pitch. The message weight determines velocity.
// The timing determines the tick position.
//
// This is the "microphone" of the jazz ensemble — it listens to the
// conversation and encodes it into the tensor-midi wire format.

import { EventType, ActionType, Friction, messageToEvent, SwmidiStream } from './swmidi.js';
import { BeatClock, PulseGrid, detectTempo, timeToTick, TICKS_PER_BAR } from './engine.js';

/// Channel assignments for conversation participants
export const ChannelAssignment = {
  human: 0,      // The user
  assistant: 1,  // The main AI
  subagent1: 2,  // Subagent slot 1
  subagent2: 3,  // Subagent slot 2
  subagent3: 4,  // Subagent slot 3
  system: 8,     // System messages
  tool: 9,       // Tool executions
  error: 15,     // Error channel
};

/// Sentiment analysis — lightweight, word-based
const POSITIVE_WORDS = ['great', 'awesome', 'love', 'perfect', 'excellent', 'wonderful', 'yes', 'good', 'amazing', 'fantastic', 'beautiful', 'brilliant'];
const NEGATIVE_WORDS = ['bad', 'error', 'fail', 'broken', 'hate', 'wrong', 'no', 'terrible', 'awful', 'crash', 'bug', 'issue'];
const QUESTION_WORDS = ['what', 'how', 'why', 'where', 'when', 'who', 'which', '?'];
const CREATIVE_WORDS = ['imagine', 'create', 'build', 'design', 'compose', 'paint', 'draw', 'write', 'dream', 'invent'];

export function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  
  let positivity = 0;
  let negativity = 0;
  let questionScore = 0;
  let creativity = 0;
  
  for (const word of words) {
    if (POSITIVE_WORDS.some(w => word.includes(w))) positivity++;
    if (NEGATIVE_WORDS.some(w => word.includes(w))) negativity++;
    if (QUESTION_WORDS.some(w => word.includes(w))) questionScore++;
    if (CREATIVE_WORDS.some(w => word.includes(w))) creativity++;
  }
  
  // Map to pitch (0-127)
  // Positive/creative → higher pitches
  // Negative → lower pitches
  // Questions → mid-range
  let pitch = 60; // Middle C
  
  if (creativity > 0) pitch += creativity * 8;
  if (positivity > 0) pitch += positivity * 5;
  if (negativity > 0) pitch -= negativity * 10;
  if (questionScore > 0) pitch = 72 + questionScore * 3; // D5+ for questions
  
  pitch = Math.max(0, Math.min(127, pitch));
  
  // Determine friction
  let friction = Friction.None;
  if (negativity > 0) friction |= Friction.Ambiguity;
  if (text.includes('error') || text.includes('fail')) friction |= Friction.SyntaxError;
  
  // Weight = message length normalized
  const weight = Math.min(1.0, text.length / 500);
  
  return { pitch, friction, weight, sentiment: {
    positivity, negativity, questionScore, creativity,
    label: negativity >= positivity && negativity > 0 ? 'tense' : creativity > 0 ? 'creative' : questionScore > 0 ? 'inquiring' : positivity > 0 ? 'bright' : 'neutral',
  }};
}

/// The Capture System — listens to conversation and produces SWMIDI events
export class MidiCapture {
  constructor() {
    this.stream = new SwmidiStream();
    this.grid = new PulseGrid();
    this.clock = new BeatClock();
    this.participants = new Map(); // name → channel
    this.messages = [];
    this.channelCounter = 0;
    this.capturing = false;
  }
  
  /// Register a participant and assign them a channel
  registerParticipant(name) {
    if (this.participants.has(name)) return this.participants.get(name);
    
    // Use predefined channels first, then dynamic
    let channel;
    if (ChannelAssignment[name] !== undefined) {
      channel = ChannelAssignment[name];
    } else {
      channel = Math.min(15, 5 + this.channelCounter++);
    }
    
    this.participants.set(name, channel);
    return channel;
  }
  
  /// Capture a conversation message
  captureMessage(message) {
    const { text, sender, timestamp, direction } = message;
    
    const channel = this.registerParticipant(sender);
    const sentiment = analyzeSentiment(text);
    const bpm = detectTempo(this.messages);
    this.clock.setBpm(bpm);
    
    const tick = timeToTick(timestamp || Date.now(), bpm);
    
    const event = {
      eventType: EventType.NoteOn,
      channel,
      pitch: sentiment.pitch,
      velocity: Math.max(1, Math.min(127, Math.round(sentiment.weight * 127))),
      errorMask: sentiment.friction,
      tick,
    };
    
    this.stream.push(event);
    this.grid.addEvent(event);
    
    // Store the message with analysis
    this.messages.push({
      ...message,
      sentiment: sentiment.sentiment,
      pitch: sentiment.pitch,
      channel,
      tick,
    });
    
    return { event, sentiment };
  }
  
  /// Capture a system event (build, deploy, error, etc.)
  captureSystemEvent(actionType, details = {}) {
    const tick = this.clock.tick;
    const event = {
      eventType: actionType >= 20 ? EventType.ControlChange : EventType.NoteOn,
      channel: ChannelAssignment.system,
      pitch: actionType,
      velocity: details.weight ? Math.round(details.weight * 127) : 64,
      errorMask: details.friction || Friction.None,
      tick,
    };
    
    this.stream.push(event);
    this.grid.addEvent(event);
    
    return event;
  }
  
  /// Get the current state for the mixer UI
  getMixerState() {
    const activeBars = this.grid.activeBars;
    const lastBar = activeBars.length > 0 ? activeBars[activeBars.length - 1] : 0;
    
    return {
      bpm: this.clock.bpm,
      tick: this.clock.tick,
      bar: Math.floor(this.clock.tick / TICKS_PER_BAR),
      totalEvents: this.stream.length,
      flowCount: this.stream.flowCount(),
      frictionCount: this.stream.frictionCount(),
      participants: [...this.participants.entries()].map(([name, ch]) => ({ name, channel: ch })),
      lastBarPattern: this.grid.getBarPattern(lastBar),
      messages: this.messages.slice(-20), // last 20 messages
    };
  }
  
  /// Export as binary SWMIDI
  exportBinary() {
    return this.stream.encode();
  }
  
  /// Export as JSON
  exportJSON() {
    return JSON.stringify({
      events: this.stream.events,
      messages: this.messages,
      participants: [...this.participants.entries()],
      bpm: this.clock.bpm,
    }, null, 2);
  }
  
  /// Clear all captured data
  clear() {
    this.stream = new SwmidiStream();
    this.grid.clear();
    this.messages = [];
    this.clock = new BeatClock();
    this.participants = new Map();
    this.channelCounter = 0;
  }
}
