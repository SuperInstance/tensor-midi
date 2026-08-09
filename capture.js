/**
 * ════════════════════════════════════════════════════════════════════
 * TENSOR-MIDI CONVERSATION CAPTURE
 * ════════════════════════════════════════════════════════════════════
 *
 * Captures every message in a Tap conversation as MIDI data.
 *
 * Each agent   = a MIDI track/channel
 * Each message = a note (pitch = sentiment, velocity = emphasis,
 *                duration = length)
 *
 * Inflection markers:
 *   ? raises pitch     ! increases velocity    ... extends duration
 *   ALL CAPS = high velocity   lowercase = low velocity
 *
 * Output: standard MIDI file (.mid) + JSON tensor representation
 *
 * Uses SWMIDI wire format from slackwater-rust (8-byte events).
 * ════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ── Sentiment & Pitch Mapping ────────────────────────────────────────

/**
 * Sentiment categories mapped to pitch classes.
 * Based on circle of fifths relationship — consonant sentiments
 * cluster around the tonic, dissonant ones venture outward.
 */
const SENTIMENT_PITCH_MAP = {
  // Positive / consonant (tonic area)
  joyful:       { base: 72, scale: 'major', color: '#3b82f6' }, // C5 — bright
  excited:      { base: 76, scale: 'major', color: '#60a5fa' }, // E5 — bright
  curious:      { base: 71, scale: 'major', color: '#93c5fd' }, // B4 — open
  supportive:   { base: 67, scale: 'major', color: '#22d3ee' }, // G4 — warm
  agreeable:    { base: 69, scale: 'major', color: '#a7f3d0' }, // A4 — pleasant
  grateful:     { base: 74, scale: 'major', color: '#6ee7b7' }, // D5 — resolved
  playful:      { base: 77, scale: 'major', color: '#5eead4' }, // F5 — light
  // Neutral
  neutral:      { base: 60, scale: 'major', color: '#9ca3af' }, // C4 — center
  informative:  { base: 62, scale: 'major', color: '#cbd5e1' }, // D4 — even
  contemplative:{ base: 59, scale: 'minor', color: '#94a3b8' }, // B3 — thoughtful
  // Negative / dissonant (tension)
  concerned:    { base: 56, scale: 'minor', color: '#f59e0b' }, // Ab3 — uneasy
  confused:     { base: 54, scale: 'minor', color: '#fb923c' }, // F#3 — unstable
  frustrated:   { base: 51, scale: 'minor', color: '#f97316' }, // Eb3 — harsh
  disagreeable: { base: 53, scale: 'minor', color: '#ea580c' }, // F3 — grating
  anxious:      { base: 55, scale: 'minor', color: '#fbbf24' }, // G3 — tight
  // Resolution
  resolved:     { base: 72, scale: 'major', color: '#22c55e' }, // C5 — final
  conciliatory: { base: 68, scale: 'major', color: '#4ade80' }, // Ab4 — bridge
};

/**
 * Preferred channel assignments for a few recognizable fleet agents —
 * when they're in the room, they always land on the same channel so
 * captures are comparable across conversations.
 *
 * Everyone else gets a channel assigned dynamically per-capture (see
 * TensorMidiCapture#_channelFor), because real Tap rooms regularly
 * seat far more than 16 distinct speakers (a room like `bar-rail` has
 * 20+), and MIDI only has 16 channels to give out.
 */
const AGENT_CHANNELS = {
  'riker':     0,
  'wesley':    1,
  'hermes':    2,
  'phi3':      3,
  'casey':     4,
  'muse':      5,
  'oracle':    6,
  'sage':      7,
  'scout':     8,
  'artemis':   9,
  'unknown':   10,
};

/** MIDI channel 9 is the General MIDI percussion channel — melodic
 * agent tracks avoid it so a stray drum-map playback doesn't happen. */
const DYNAMIC_CHANNEL_POOL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

// ── Text Analysis ────────────────────────────────────────────────────

/**
 * Analyze a text message and extract musical properties.
 *
 * @param {string} text - The message text
 * @returns {object} { sentiment, pitch, velocity, duration, inflection }
 */
function analyzeText(text) {
  const trimmed = text.trim();
  const length = trimmed.length;

  // ── Sentiment detection ──
  const sentiment = detectSentiment(trimmed);

  // ── Pitch from sentiment + inflection ──
  const sentimentData = SENTIMENT_PITCH_MAP[sentiment] || SENTIMENT_PITCH_MAP.neutral;
  let pitch = sentimentData.base;

  // Question marks raise pitch (uncertainty = higher register)
  const questionCount = (trimmed.match(/\?/g) || []).length;
  pitch += questionCount * 2;

  // Exclamation marks add emphasis but also raise slightly
  const exclaimCount = (trimmed.match(/!/g) || []).length;

  // ── Velocity from emphasis ──
  let velocity = 64; // default mezzo-forte

  // ALL CAPS = fortissimo
  const upperRatio = (trimmed.replace(/[^A-Za-z]/g, '').match(/[A-Z]/g) || []).length /
                     Math.max(1, (trimmed.replace(/[^A-Za-z]/g, '') || '').length);
  if (upperRatio > 0.7 && length > 10) {
    velocity = 110;
  } else if (exclaimCount > 0) {
    velocity = Math.min(127, 80 + exclaimCount * 8);
  }

  // Short messages = quieter (staccato)
  if (length < 20) velocity = Math.max(40, velocity - 15);
  // Very long messages = louder (forte)
  if (length > 200) velocity = Math.min(127, velocity + 15);

  // ── Duration from message length + punctuation ──
  let duration = 0.5; // base half second

  // Duration proportional to message length (characters → seconds)
  // 100 chars ≈ 2 seconds, 500 chars ≈ 5 seconds
  duration += Math.min(8, length / 100);

  // Ellipsis extends duration (thoughtful pause)
  const ellipsisCount = (trimmed.match(/\.\.\./g) || []).length;
  duration += ellipsisCount * 0.3;

  // Code blocks extend significantly
  const codeBlockCount = (trimmed.match(/```/g) || []).length / 2;
  duration += codeBlockCount * 2.0;

  // ── Inflection markers ──
  const inflection = {
    question: questionCount > 0,
    exclamation: exclaimCount > 0,
    ellipsis: ellipsisCount > 0,
    allCaps: upperRatio > 0.7 && length > 10,
    codeBlock: codeBlockCount > 0,
    short: length < 20,
    long: length > 500,
  };

  // Clamp pitch to valid MIDI range
  pitch = Math.max(0, Math.min(127, Math.round(pitch)));
  velocity = Math.max(1, Math.min(127, Math.round(velocity)));

  return {
    sentiment,
    pitch,
    velocity,
    duration: Math.round(duration * 1000) / 1000,
    inflection,
    color: sentimentData.color,
  };
}

/**
 * Simple keyword-based sentiment detection.
 * Not as sophisticated as a neural model, but fast and deterministic.
 */
function detectSentiment(text) {
  const lower = text.toLowerCase();

  // Resolution / agreement
  if (/\b(good|agree|yes|right|correct|exactly|perfect|love|great|awesome|nice|cool|wow|amazing)\b/.test(lower))
    return lower.includes('!') ? 'excited' : 'joyful';
  if (/\b(thank|appreciate|grateful)\b/.test(lower)) return 'grateful';
  if (/\b(play|fun|joke|lol|haha|heh)\b/.test(lower)) return 'playful';

  // Supportive
  if (/\b(help|support|here|got you|understand|feel)\b/.test(lower)) return 'supportive';

  // Curiosity
  if (/\b(what|why|how|where|when|who|wonder|curious|hmm|interesting)\b/.test(lower) || text.includes('?'))
    return 'curious';

  // Contemplative
  if (/\b(think|consider|perhaps|maybe|might|could|possibly|wonder)\b/.test(lower)) return 'contemplative';

  // Concern
  if (/\b(worry|concern|careful|watch out|care|risk|danger)\b/.test(lower)) return 'concerned';

  // Confusion
  if (/\b(confused|don't understand|what\?|unclear|lost|wait)\b/.test(lower)) return 'confused';

  // Frustration
  if (/\b(frustrated|annoying|stupid|broken|doesn't work|fail|error|damn|ugh)\b/.test(lower)) return 'frustrated';

  // Disagreement
  if (/\b(no|wrong|disagree|incorrect|bad|terrible|hate)\b/.test(lower)) return 'disagreeable';

  // Resolution
  if (/\b(solved|fixed|resolved|done|complete|finished|works)\b/.test(lower)) return 'resolved';
  if (/\b(sorry|apologize|my bad|fault)\b/.test(lower)) return 'conciliatory';

  // Informative (default for longer technical messages)
  if (text.length > 100 && /```|function|const|class|import|def/.test(text)) return 'informative';

  // Neutral
  return 'neutral';
}

// ── Conversation Capture ─────────────────────────────────────────────

/**
 * TensorMidiCapture — captures a conversation and produces MIDI data.
 */
class TensorMidiCapture {
  constructor(options = {}) {
    this.tracks = new Map(); // agent → track data
    this.startTime = options.startTime || null;
    this.tempo = options.tempo || 120;
    this.key = options.key || null; // auto-derived
    this.timeSignature = '12/8';
    this.roomId = options.roomId || 'bar-rail';
    this.title = options.title || 'Untitled Conversation';
    this._dynamicChannels = new Map(); // speaker → channel, for this capture only
  }

  /**
   * Resolve the MIDI channel for a speaker: known fleet agents get their
   * fixed slot, everyone else is assigned the next free channel from
   * DYNAMIC_CHANNEL_POOL (round-robin once the room outgrows 16 voices —
   * a big ensemble sharing channels, same as a real jazz band doubling parts).
   */
  _channelFor(speaker) {
    const known = AGENT_CHANNELS[speaker?.toLowerCase()];
    if (known !== undefined) return known;

    if (!this._dynamicChannels.has(speaker)) {
      const index = this._dynamicChannels.size % DYNAMIC_CHANNEL_POOL.length;
      this._dynamicChannels.set(speaker, DYNAMIC_CHANNEL_POOL[index]);
    }
    return this._dynamicChannels.get(speaker);
  }

  /**
   * Add a message to the capture.
   *
   * @param {object} msg - { speaker, text, timestamp }
   */
  addMessage(msg) {
    const { speaker, text, timestamp } = msg;

    if (!this.startTime) {
      this.startTime = timestamp;
    }

    // Calculate time offset from conversation start (in seconds)
    const offset = (timestamp - this.startTime) / 1000;

    // Analyze the text
    const analysis = analyzeText(text);

    // Get or create track for this agent
    if (!this.tracks.has(speaker)) {
      const channel = this._channelFor(speaker);
      this.tracks.set(speaker, {
        track: speaker,
        channel,
        notes: [],
      });
    }

    const track = this.tracks.get(speaker);
    track.notes.push({
      pitch: analysis.pitch,
      velocity: analysis.velocity,
      start: Math.round(offset * 1000) / 1000,
      duration: analysis.duration,
      text,
      sentiment: analysis.sentiment,
      inflection: analysis.inflection,
      color: analysis.color,
    });

    return analysis;
  }

  /**
   * Add multiple messages at once.
   * @param {array} messages - [{ speaker, text, timestamp }, ...]
   */
  loadMessages(messages) {
    for (const msg of messages) {
      this.addMessage(msg);
    }
    this.deriveMusicalProperties();
  }

  /**
   * Derive tempo and key from the captured conversation.
   */
  deriveMusicalProperties() {
    // ── Tempo: derived from message frequency ──
    const allNotes = Array.from(this.tracks.values()).flatMap(t => t.notes);
    if (allNotes.length < 2) {
      this.tempo = 120;
      this.key = 'Cmaj';
      return;
    }

    // Sort by start time
    allNotes.sort((a, b) => a.start - b.start);

    // Average inter-message interval → BPM
    const intervals = [];
    for (let i = 1; i < allNotes.length; i++) {
      const interval = allNotes[i].start - allNotes[i - 1].start;
      if (interval > 0 && interval < 60) intervals.push(interval);
    }

    if (intervals.length > 0) {
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      // Map: 1s avg → 120 BPM, 0.5s → 240, 2s → 60
      this.tempo = Math.round(120 / avgInterval);
      this.tempo = Math.max(40, Math.min(300, this.tempo));
    }

    // ── Key: derived from overall sentiment ──
    const sentimentCounts = {};
    for (const note of allNotes) {
      sentimentCounts[note.sentiment] = (sentimentCounts[note.sentiment] || 0) + 1;
    }

    const sortedSentiments = Object.entries(sentimentCounts)
      .sort((a, b) => b[1] - a[1]);
    const dominant = sortedSentiments[0]?.[0] || 'neutral';
    const dominantData = SENTIMENT_PITCH_MAP[dominant];

    // Major key if positive, minor if negative/uncertain
    const isMinor = dominantData?.scale === 'minor';
    const pitchClass = dominantData?.base % 12 || 0;

    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    this.key = `${NOTE_NAMES[pitchClass]}${isMinor ? 'min' : 'maj'}`;
  }

  /**
   * Export as JSON tensor representation.
   */
  toJSON() {
    this.deriveMusicalProperties();
    return {
      title: this.title,
      roomId: this.roomId,
      tempo: this.tempo,
      key: this.key,
      timeSignature: this.timeSignature,
      startTime: this.startTime,
      duration: this.getDuration(),
      trackCount: this.tracks.size,
      noteCount: Array.from(this.tracks.values()).reduce((sum, t) => sum + t.notes.length, 0),
      tracks: Array.from(this.tracks.values()),
    };
  }

  /**
   * Get total conversation duration in seconds.
   */
  getDuration() {
    let maxEnd = 0;
    for (const track of this.tracks.values()) {
      for (const note of track.notes) {
        const end = note.start + note.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return Math.round(maxEnd * 1000) / 1000;
  }

  /**
   * Export as a standard MIDI file (SMF Format 0 or 1).
   * Returns a Buffer.
   *
   * Format 1 = multiple tracks (one per agent).
   */
  toMIDI() {
    this.deriveMusicalProperties();
    return encodeStandardMIDI(this.toJSON());
  }

  /**
   * Export as SWMIDI wire format (8-byte events).
   * Compatible with slackwater-rust swmidi crate.
   */
  toSWMIDI() {
    this.deriveMusicalProperties();
    const events = [];

    for (const track of this.tracks.values()) {
      for (const note of track.notes) {
        const tick = Math.round(note.start * (PPQ_FROM_TEMPO * 2));
        // Note on
        events.push(encodeSwmidiEvent(
          0x90 | (track.channel & 0x0F), // NoteOn
          note.pitch & 0x7F,
          note.velocity & 0x7F,
          0, // error_mask (flow)
          tick
        ));
        // Note off
        const offTick = tick + Math.round(note.duration * (PPQ_FROM_TEMPO * 2));
        events.push(encodeSwmidiEvent(
          0x80 | (track.channel & 0x0F), // NoteOff
          note.pitch & 0x7F,
          0,
          0,
          offTick
        ));
      }
    }

    // Sort by tick
    events.sort((a, b) => {
      const ta = new DataView(a.buffer).getUint32(4, true);
      const tb = new DataView(b.buffer).getUint32(4, true);
      return ta - tb;
    });

    // Concatenate
    const total = events.length * 8;
    const result = Buffer.alloc(total);
    for (let i = 0; i < events.length; i++) {
      Buffer.from(events[i]).copy(result, i * 8);
    }
    return result;
  }

  /**
   * Save captures to files.
   */
  save(dir) {
    const basename = path.join(dir, this.title.toLowerCase().replace(/\s+/g, '-'));
    const json = this.toJSON();

    fs.writeFileSync(basename + '.tensor.json', JSON.stringify(json, null, 2));
    fs.writeFileSync(basename + '.mid', this.toMIDI());
    fs.writeFileSync(basename + '.swmidi', this.toSWMIDI());

    return {
      json: basename + '.tensor.json',
      midi: basename + '.mid',
      swmidi: basename + '.swmidi',
    };
  }
}

// Helper: PPQ derived from tempo for SWMIDI
const PPQ_FROM_TEMPO = 96;

// ── SWMIDI encoding ──────────────────────────────────────────────────

/**
 * Encode a single SWMIDI event (8 bytes).
 * Format: [status, pitch, velocity, error_mask, tick(4 bytes LE)]
 */
function encodeSwmidiEvent(status, pitch, velocity, errorMask, tick) {
  const buf = new Uint8Array(8);
  // status byte: type nibble in high 4, channel in low 4
  // For MIDI compat: status is already the full status byte
  buf[0] = status & 0xFF;
  buf[1] = pitch & 0x7F;
  buf[2] = velocity & 0x7F;
  buf[3] = errorMask & 0xFF;
  buf[4] = tick & 0xFF;
  buf[5] = (tick >> 8) & 0xFF;
  buf[6] = (tick >> 16) & 0xFF;
  buf[7] = (tick >> 24) & 0xFF;
  return buf;
}

// ── Standard MIDI File encoding ──────────────────────────────────────

/**
 * Encode a tensor-midi JSON as a Standard MIDI File (SMF Format 1).
 * This produces a valid .mid file playable in any DAW.
 */
function encodeStandardMIDI(tensorData) {
  const PPQ = 480; // ticks per quarter note for SMF
  const tracks = [];

  // ── Tempo track (Track 0) ──
  const tempoTrack = [];
  // Tempo meta event
  const usPerQuarter = Math.round(60000000 / tensorData.tempo);
  tempoTrack.push(makeMetaEvent(0x51, [0xFF, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xFF,
    (usPerQuarter >> 8) & 0xFF,
    usPerQuarter & 0xFF,
  ]));
  // Time signature: 12/8
  tempoTrack.push(makeMetaEvent(0x58, [0xFF, 0x58, 0x04, 12, 3, 24, 8]));
  // Track name
  tempoTrack.push(makeTextMetaEvent(0x03, tensorData.title || 'Conversation'));
  // End of track
  tempoTrack.push(Buffer.from([0x00, 0xFF, 0x2F, 0x00]));
  tracks.push(concatBuffers(tempoTrack));

  // ── One track per agent ──
  for (const trackData of tensorData.tracks) {
    const events = [];
    // Track name
    events.push(makeTextMetaEvent(0x03, trackData.track));
    // Program change (pick a pleasant synth voice)
    events.push(makeMidiEvent(0, 0xC0 | (trackData.channel & 0x0F), 0, 0)); // Acoustic Grand Piano

    // Convert notes to MIDI events
    const midiEvents = [];
    for (const note of trackData.notes) {
      const startTick = Math.round(note.start * PPQ * (tensorData.tempo / 60));
      const durationTicks = Math.max(1, Math.round(note.duration * PPQ * (tensorData.tempo / 60)));

      midiEvents.push({
        tick: startTick,
        data: makeNoteOn(trackData.channel, note.pitch, note.velocity),
      });
      midiEvents.push({
        tick: startTick + durationTicks,
        data: makeNoteOff(trackData.channel, note.pitch),
      });
    }

    // Sort by tick
    midiEvents.sort((a, b) => a.tick - b.tick);

    // Convert to delta ticks with running status
    let lastTick = 0;
    for (const ev of midiEvents) {
      const delta = ev.tick - lastTick;
      lastTick = ev.tick;
      events.push(Buffer.concat([encodeVarLen(delta), ev.data]));
    }

    // End of track
    events.push(Buffer.from([0x00, 0xFF, 0x2F, 0x00]));
    tracks.push(concatBuffers(events));
  }

  // ── Assemble SMF ──
  return assembleSMF(tracks, PPQ);
}

function makeMetaEvent(metaType, bytes) {
  return Buffer.from(bytes);
}

function makeTextMetaEvent(metaType, text) {
  const textBytes = Buffer.from(text, 'utf8');
  const lenBytes = encodeVarLen(textBytes.length);
  return Buffer.concat([
    Buffer.from([0x00, 0xFF, metaType]),
    lenBytes,
    textBytes,
  ]);
}

function makeMidiEvent(delta, status, data1, data2) {
  return Buffer.from([encodeVarLen(delta), status & 0xFF, data1 & 0x7F, data2 & 0x7F].flat
    ? [delta, status & 0xFF, data1 & 0x7F, data2 & 0x7F]
    : [delta, status & 0xFF, data1 & 0x7F, data2 & 0x7F]);
}

function makeNoteOn(channel, pitch, velocity) {
  return Buffer.from([0x90 | (channel & 0x0F), pitch & 0x7F, velocity & 0x7F]);
}

function makeNoteOff(channel, pitch) {
  return Buffer.from([0x80 | (channel & 0x0F), pitch & 0x7F, 0x00]);
}

function encodeVarLen(value) {
  if (value < 0) value = 0;
  const bytes = [];
  bytes.unshift(value & 0x7F);
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7F) | 0x80);
    value >>= 7;
  }
  return Buffer.from(bytes);
}

function concatBuffers(buffers) {
  return Buffer.concat(buffers.filter(b => b && b.length > 0));
}

function assembleSMF(tracks, ppq) {
  const header = Buffer.alloc(14);
  header.write('MThd', 0);
  header.writeUInt32BE(6, 4);      // header length
  header.writeUInt16BE(1, 8);      // format 1 (multi-track)
  header.writeUInt16BE(tracks.length, 10); // number of tracks
  header.writeUInt16BE(ppq, 12);   // ticks per quarter note

  const trackChunks = [];
  for (const trackData of tracks) {
    const header2 = Buffer.alloc(8);
    header2.write('MTrk', 0);
    header2.writeUInt32BE(trackData.length, 4);
    trackChunks.push(Buffer.concat([header2, trackData]));
  }

  return Buffer.concat([header, ...trackChunks]);
}

// ── Fetch from The Tap API ───────────────────────────────────────────

/**
 * Fetch conversation from The Tap and create a capture.
 *
 * @param {string} tapUrl - Base URL for The Tap
 * @param {string} roomId - Room to fetch
 * @param {string} [authToken] - Optional auth token
 * @returns {Promise<TensorMidiCapture>}
 */
async function fetchFromTheTap(tapUrl, roomId, authToken) {
  const url = `${tapUrl}/api/room/${encodeURIComponent(roomId)}/conversation`;
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Tap API error: ${response.status}`);

  const data = await response.json();
  const messages = (data.messages || data.lines || data || []).map(m => ({
    speaker: m.speaker || m.agent_id || m.agent || m.display_name || m.name || 'unknown',
    text: m.text || m.message || m.content || '',
    timestamp: m.timestamp ? new Date(m.timestamp).getTime() :
               m.created_at ? new Date(m.created_at).getTime() : Date.now(),
  }));

  const capture = new TensorMidiCapture({ roomId });
  capture.loadMessages(messages);
  return capture;
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = {
  TensorMidiCapture,
  analyzeText,
  detectSentiment,
  SENTIMENT_PITCH_MAP,
  AGENT_CHANNELS,
  encodeStandardMIDI,
  encodeSwmidiEvent,
  fetchFromTheTap,
};
