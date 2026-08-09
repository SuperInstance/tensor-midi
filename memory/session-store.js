// ════════════════════════════════════════════════════════════════════
// SESSION STORE — The Memory Layer for Tensor-MIDI Conversations
// ════════════════════════════════════════════════════════════════════
//
// A conversation is not a log. It's a composition with movements.
// Each session is a piece of music: it has a key, a tempo, a mood,
// moments of tension and release, and it references other pieces.
//
// This module treats captured sessions as musical compositions:
//   - Sessions are stored as JSON with SWMIDI events + narrative
//   - Sessions can reference (quote) messages from other sessions
//   - Cross-session patterns form the fleet's musical memory
//
// "The score remembers what the performer forgets."
//
// ════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants (shared with engine) ───────────────────────────────────

const PPQ = 96;
const TICKS_PER_PULSE = 48;
const TICKS_PER_BAR = 576;
const PACKED_SIZE = 8;

// ── Session Schema ───────────────────────────────────────────────────

/**
 * A Session is a complete captured conversation, treated as a musical
 * composition. It contains:
 *
 *   - metadata: title, timestamps, participants, key, mode
 *   - movements: sections of the conversation (like movements in a suite)
 *   - events: raw SWMIDI events (the notes)
 *   - messages: the narrative text (the story behind the notes)
 *   - quotes: references to messages in other sessions
 *   - analysis: computed jazz metrics (tension, energy, complexity)
 *
 * @typedef {Object} Session
 * @property {string} id — Unique session identifier (slug)
 * @property {string} title — Human-readable title
 * @property {number} createdAt — Start timestamp (ms epoch)
 * @property {number} endedAt — End timestamp (ms epoch), or null
 * @property {string[]} participants — Who played
 * @property {string} key — Musical key (e.g., "C", "F#", derived from pitch distribution)
 * @property {string} mode — Musical mode (Groove, Tension, Building, etc.)
 * @property {number} bpm — Average tempo
 * @property {Movement[]} movements — Sections of the conversation
 * @property {CapturedEvent[]} events — Raw SWMIDI events
 * @property {CapturedMessage[]} messages — Narrative messages
 * @property {Quote[]} quotes — Cross-session references
 * @property {SessionAnalysis} analysis — Computed metrics
 */

/**
 * A movement is a section of the conversation — like a movement in a
 * classical suite. Each movement has its own character.
 *
 * @typedef {Object} Movement
 * @property {string} name — Movement name (e.g., "Overture", "Development")
 * @property {number} startTick — When this movement begins
 * @property {number} endTick — When it ends
 * @property {string} mood — Emotional character
 * @property {number[]} eventIndices — Indices into the events array
 */

/**
 * @typedef {Object} CapturedEvent
 * @property {number} channel — MIDI channel (participant)
 * @property {number} pitch — 0-127
 * @property {number} velocity — 0-127
 * @property {number} tick — Position on the 96 PPQ grid
 * @property {number} errorMask — Friction bitfield
 * @property {string} sentiment — Sentiment label
 * @property {string} speaker — Who sent this
 * @property {string} text — The message text
 * @property {number} timestamp — Wall clock
 */

/**
 * @typedef {Object} Quote
 * @property {string} fromSessionId — Session being quoted
 * @property {number} fromEventIndex — Event index in that session
 * @property {number} inEventIndex — Where in this session the quote appears
 * @property {string} note — Why this quote matters
 */

/**
 * @typedef {Object} SessionAnalysis
 * @property {number} tension — 0-100
 * @property {number} energy — 0-100
 * @property {number} complexity — 0-100
 * @property {string} dominantMode — GROOVE, TENSION, BUILDING, etc.
 * @property {string} dominantChord — Maj7, m7, Dom7, etc.
 * @property {number} flowRatio — Fraction of events in flow state
 * @property {number[]} pitchHistogram — Count per pitch (0-127)
 * @property {Object} speakerStats — Per-speaker statistics
 */

// ── SessionStore Class ───────────────────────────────────────────────

class SessionStore {
  /**
   * Create a session store backed by a directory of JSON files.
   * @param {string} storageDir — Directory to store session files
   */
  constructor(storageDir) {
    this.storageDir = storageDir;
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this._index = null; // lazy-loaded
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  /**
   * Create a new session.
   * @param {Object} opts — { title, bpm }
   * @returns {Session}
   */
  create(opts = {}) {
    const id = this._generateId(opts.title);
    const now = Date.now();
    return {
      id,
      title: opts.title || `Session ${new Date().toLocaleString()}`,
      createdAt: now,
      endedAt: null,
      participants: [],
      key: 'C',
      mode: 'BALLAD',
      bpm: opts.bpm || 120,
      movements: [],
      events: [],
      messages: [],
      quotes: [],
      analysis: null,
    };
  }

  /**
   * Save a session to disk.
   * @param {Session} session
   */
  save(session) {
    if (!session || !session.id) throw new Error('Session must have an id');
    const filePath = path.join(this.storageDir, `${session.id}.json`);
    session.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    this._index = null; // invalidate cache
    return session;
  }

  /**
   * Load a session by id.
   * @param {string} id
   * @returns {Session|null}
   */
  load(id) {
    const filePath = path.join(this.storageDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  }

  /**
   * Delete a session.
   * @param {string} id
   */
  delete(id) {
    const filePath = path.join(this.storageDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this._index = null;
      return true;
    }
    return false;
  }

  /**
   * List all sessions (metadata only, lightweight).
   * @returns {SessionMeta[]}
   */
  list() {
    this._ensureIndex();
    return this._index;
  }

  // ── Capturing ────────────────────────────────────────────────────

  /**
   * Capture a message into a session as a SWMIDI event + narrative.
   * @param {Session} session
   * @param {Object} msg — { text, speaker, timestamp, pitch, vel, sentiment, tick }
   * @returns {CapturedEvent}
   */
  capture(session, msg) {
    if (!session.events) session.events = [];
    if (!session.messages) session.messages = [];
    if (!session.participants.includes(msg.speaker)) {
      session.participants.push(msg.speaker);
    }

    // Find or assign channel
    const channelIdx = session.participants.indexOf(msg.speaker);

    const event = {
      channel: channelIdx,
      pitch: msg.pitch || 60,
      velocity: msg.vel || 64,
      tick: msg.tick !== undefined ? msg.tick : session.events.length * TICKS_PER_PULSE,
      errorMask: msg.errorMask || (msg.sentiment === 'tense' ? 1 : 0),
      sentiment: msg.sentiment || 'neutral',
      speaker: msg.speaker,
      text: msg.text,
      timestamp: msg.timestamp || Date.now(),
    };

    session.events.push(event);
    session.messages.push({
      text: msg.text,
      speaker: msg.speaker,
      timestamp: event.timestamp,
      sentiment: event.sentiment,
      pitch: event.pitch,
      tick: event.tick,
    });

    return event;
  }

  /**
   * End a session: compute analysis, detect movements, set endedAt.
   * @param {Session} session
   */
  finalize(session) {
    session.endedAt = Date.now();
    session.analysis = this.analyze(session);
    session.movements = this.detectMovements(session);
    session.key = this.detectKey(session);
    session.mode = session.analysis.dominantMode;
    this.save(session);
    return session;
  }

  // ── Analysis ─────────────────────────────────────────────────────

  /**
   * Compute full session analysis.
   * @param {Session} session
   * @returns {SessionAnalysis}
   */
  analyze(session) {
    const events = session.events || [];
    if (events.length === 0) {
      return {
        tension: 0, energy: 0, complexity: 0,
        dominantMode: 'SILENCE', dominantChord: 'N/A',
        flowRatio: 1.0,
        pitchHistogram: new Array(128).fill(0),
        speakerStats: {},
      };
    }

    // Tension: fraction of tense events
    const tenseCount = events.filter(e => e.sentiment === 'tense').length;
    const tension = Math.round((tenseCount / events.length) * 100);

    // Energy: average velocity
    const avgVel = events.reduce((s, e) => s + e.velocity, 0) / events.length;
    const energy = Math.round((avgVel / 127) * 100);

    // Complexity: channels used × pitch range
    const channels = new Set(events.map(e => e.channel));
    const pitches = events.map(e => e.pitch);
    const pitchRange = pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0;
    const complexity = Math.round(
      (channels.size / 8) * 50 + (pitchRange / 72) * 50
    );

    // Mode detection
    let dominantMode = 'GROOVE';
    if (tension > 40) dominantMode = 'TENSION';
    else if (channels.size >= 3 && energy > 50) dominantMode = 'BUILDING';
    else if (channels.size >= 3 && tension < 10) dominantMode = 'COMPING';
    else if (events.length < 5) dominantMode = 'BALLAD';
    else if (channels.size <= 1) dominantMode = 'SOLO';

    // Chord detection
    let dominantChord = 'Maj7';
    if (tension > 30) dominantChord = 'Dom7';
    else if (tension > 10) dominantChord = 'm7';
    else if (energy < 30) dominantChord = 'Aug';

    // Flow ratio
    const flowCount = events.filter(e => e.errorMask === 0).length;
    const flowRatio = flowCount / events.length;

    // Pitch histogram
    const pitchHistogram = new Array(128).fill(0);
    for (const e of events) {
      if (e.pitch >= 0 && e.pitch < 128) pitchHistogram[e.pitch]++;
    }

    // Speaker stats
    const speakerStats = {};
    for (const e of events) {
      if (!speakerStats[e.speaker]) {
        speakerStats[e.speaker] = {
          count: 0, totalPitch: 0, totalVel: 0,
          sentiments: { tense: 0, bright: 0, creative: 0, inquiring: 0, neutral: 0 },
          pitches: [],
        };
      }
      const s = speakerStats[e.speaker];
      s.count++;
      s.totalPitch += e.pitch;
      s.totalVel += e.velocity;
      s.sentiments[e.sentiment] = (s.sentiments[e.sentiment] || 0) + 1;
      s.pitches.push(e.pitch);
    }

    // Finalize speaker stats with averages
    for (const name of Object.keys(speakerStats)) {
      const s = speakerStats[name];
      s.avgPitch = s.count > 0 ? Math.round(s.totalPitch / s.count) : 0;
      s.avgVelocity = s.count > 0 ? Math.round(s.totalVel / s.count) : 0;
      s.dominantSentiment = Object.entries(s.sentiments)
        .sort((a, b) => b[1] - a[1])[0][0];
    }

    return {
      tension, energy, complexity,
      dominantMode, dominantChord,
      flowRatio, pitchHistogram, speakerStats,
    };
  }

  /**
   * Detect movements within a session — sections of coherent character.
   * Like movements in a suite: Overture, Development, Climax, Coda.
   * @param {Session} session
   * @returns {Movement[]}
   */
  detectMovements(session) {
    const events = session.events || [];
    if (events.length < 3) return [];

    const movements = [];
    const windowSize = Math.max(5, Math.floor(events.length / 6));

    let currentMovement = {
      name: 'Overture',
      startTick: events[0].tick,
      endTick: 0,
      mood: events[0].sentiment,
      eventIndices: [],
    };

    let lastSentiment = events[0].sentiment;
    let changeCount = 0;

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      currentMovement.eventIndices.push(i);
      currentMovement.endTick = e.tick;

      // Detect mood shifts
      if (e.sentiment !== lastSentiment) {
        changeCount++;
        lastSentiment = e.sentiment;
      }

      // Start a new movement when sentiment shifts significantly
      if (changeCount >= 3 && i - currentMovement.eventIndices[0] >= windowSize) {
        currentMovement.name = this._nameMovement(currentMovement, movements.length);
        movements.push(currentMovement);
        currentMovement = {
          name: '',
          startTick: e.tick,
          endTick: e.tick,
          mood: e.sentiment,
          eventIndices: [],
        };
        changeCount = 0;
      }
    }

    // Push final movement
    if (currentMovement.eventIndices.length > 0) {
      currentMovement.name = this._nameMovement(currentMovement, movements.length);
      movements.push(currentMovement);
    }

    return movements;
  }

  /**
   * Name a movement based on its character and position.
   * @private
   */
  _nameMovement(movement, index) {
    const names = [
      'Overture', 'Exposition', 'Development', 'Climax',
      'Interlude', 'Recapitulation', 'Coda', 'Finale',
    ];

    // Name by sentiment character
    if (movement.mood === 'tense') return `Tension ${index + 1}`;
    if (movement.mood === 'creative') return `Flight ${index + 1}`;
    if (movement.mood === 'bright') return `Light ${index + 1}`;
    if (movement.mood === 'inquiring') return `Question ${index + 1}`;

    // Default: position-based
    return names[Math.min(index, names.length - 1)];
  }

  /**
   * Detect the musical key of a session based on pitch distribution.
   * Uses a simplified key-finding algorithm: find the pitch class with
   * the highest weight, then check the major/minor triad fit.
   * @param {Session} session
   * @returns {string}
   */
  detectKey(session) {
    const events = session.events || [];
    if (events.length === 0) return 'C';

    const pitchClassWeights = new Array(12).fill(0);
    for (const e of events) {
      pitchClassWeights[e.pitch % 12] += e.velocity / 127;
    }

    // Find the strongest pitch class
    let maxIdx = 0;
    let maxWeight = 0;
    for (let i = 0; i < 12; i++) {
      if (pitchClassWeights[i] > maxWeight) {
        maxWeight = pitchClassWeights[i];
        maxIdx = i;
      }
    }

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Check major vs minor triad
    const majorTriad = [0, 4, 7];
    const minorTriad = [0, 3, 7];
    let majorSum = 0, minorSum = 0;
    for (const interval of majorTriad) {
      majorSum += pitchClassWeights[(maxIdx + interval) % 12];
    }
    for (const interval of minorTriad) {
      minorSum += pitchClassWeights[(maxIdx + interval) % 12];
    }

    return minorSum > majorSum * 1.1
      ? `${noteNames[maxIdx]}m`
      : noteNames[maxIdx];
  }

  // ── Cross-Session References (Quoting) ──────────────────────────

  /**
   * Create a quote: a message in one session references a message in another.
   * Like a jazz musician quoting another solo mid-improvisation.
   * @param {Session} fromSession — The session doing the quoting
   * @param {number} inEventIndex — Event index in fromSession
   * @param {Session} toSession — The session being quoted
   * @param {number} toEventIndex — Event index in toSession
   * @param {string} note — Why this quote exists
   */
  addQuote(fromSession, inEventIndex, toSession, toEventIndex, note = '') {
    if (!fromSession.quotes) fromSession.quotes = [];
    fromSession.quotes.push({
      fromSessionId: toSession.id,
      fromEventIndex: toEventIndex,
      inEventIndex,
      note,
    });
    return fromSession;
  }

  /**
   * Find sessions that quote a given session.
   * @param {string} sessionId
   * @returns {Object[]} — Array of { sessionId, quote }
   */
  findQuotesTo(sessionId) {
    const results = [];
    const sessions = this.list();
    for (const meta of sessions) {
      const session = this.load(meta.id);
      if (!session || !session.quotes) continue;
      for (const quote of session.quotes) {
        if (quote.fromSessionId === sessionId) {
          results.push({ sessionId: session.id, quote });
        }
      }
    }
    return results;
  }

  /**
   * Find sessions that a given session quotes.
   * @param {Session} session
   * @returns {Object[]} — Array of { toSession, toEvent }
   */
  findQuotesFrom(session) {
    const results = [];
    if (!session.quotes) return results;
    for (const quote of session.quotes) {
      const toSession = this.load(quote.fromSessionId);
      if (toSession) {
        const toEvent = toSession.events[quote.fromEventIndex];
        results.push({ toSession, toEvent, quote });
      }
    }
    return results;
  }

  // ── Search ───────────────────────────────────────────────────────

  /**
   * Search sessions by various criteria.
   * @param {Object} query — { speaker, sentiment, mode, text, minEnergy, maxTension }
   * @returns {SessionMeta[]}
   */
  search(query = {}) {
    const all = this.list();
    return all.filter(meta => {
      if (query.mode && meta.mode !== query.mode) return false;
      if (query.speaker && !(meta.participants || []).includes(query.speaker)) return false;
      if (query.minEnergy && (meta.energy || 0) < query.minEnergy) return false;
      if (query.maxTension && (meta.tension || 0) > query.maxTension) return false;
      return true;
    });
  }

  /**
   * Find sessions similar to a given session (by pitch distribution).
   * @param {Session} session
   * @param {number} limit
   * @returns {Object[]} — Sorted by similarity, { session, similarity }
   */
  findSimilar(session, limit = 5) {
    const target = session.analysis?.pitchHistogram;
    if (!target) return [];

    const all = this.list()
      .filter(m => m.id !== session.id)
      .map(m => {
        const s = this.load(m.id);
        if (!s?.analysis?.pitchHistogram) return null;
        const similarity = this._cosineSimilarity(
          target,
          s.analysis.pitchHistogram
        );
        return { session: s, similarity };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity);

    return all.slice(0, limit);
  }

  // ── Export Formats ──────────────────────────────────────────────

  /**
   * Export a session as a human-readable musical score.
   * @param {Session} session
   * @returns {string}
   */
  toScore(session) {
    const lines = [];
    lines.push(`╔══════════════════════════════════════════════════╗`);
    lines.push(`║  ${session.title.padEnd(46)} ║`);
    lines.push(`║  Key: ${session.key}  Mode: ${session.mode}  BPM: ${session.bpm}     ║`);
    lines.push(`║  Players: ${session.participants.join(', ').padEnd(38)} ║`);
    lines.push(`╚══════════════════════════════════════════════════╝`);
    lines.push('');

    if (session.movements && session.movements.length > 0) {
      for (const m of session.movements) {
        lines.push(`── ${m.name} ── mood: ${m.mood} ── ${m.eventIndices.length} events ──`);
        for (const idx of m.eventIndices) {
          const e = session.events[idx];
          if (!e) continue;
          const bars = Math.floor(e.tick / TICKS_PER_BAR) + 1;
          const beat = Math.floor((e.tick % TICKS_PER_BAR) / PPQ) + 1;
          lines.push(
            `  bar ${String(bars).padStart(3)} | beat ${beat} | ` +
            `ch ${e.channel} | pitch ${String(e.pitch).padStart(3)} ` +
            `| vel ${String(e.velocity).padStart(3)} | ${e.sentiment.padEnd(8)} | ` +
            `${e.speaker}: "${e.text.substring(0, 60)}${e.text.length > 60 ? '...' : ''}"`
          );
        }
        lines.push('');
      }
    } else {
      for (const e of session.events) {
        const bars = Math.floor(e.tick / TICKS_PER_BAR) + 1;
        lines.push(
          `  bar ${String(bars).padStart(3)} | ch ${e.channel} | ` +
          `pitch ${String(e.pitch).padStart(3)} | ${e.sentiment.padEnd(8)} | ` +
          `${e.speaker}: "${e.text.substring(0, 60)}${e.text.length > 60 ? '...' : ''}"`
        );
      }
    }

    if (session.quotes && session.quotes.length > 0) {
      lines.push('── Quotes ──');
      for (const q of session.quotes) {
        lines.push(`  event ${q.inEventIndex} ← session ${q.fromSessionId} [${q.note}]`);
      }
      lines.push('');
    }

    if (session.analysis) {
      const a = session.analysis;
      lines.push('── Analysis ──');
      lines.push(`  Tension: ${a.tension}%  Energy: ${a.energy}%  Complexity: ${a.complexity}%`);
      lines.push(`  Mode: ${a.dominantMode}  Chord: ${a.dominantChord}  Flow: ${(a.flowRatio * 100).toFixed(0)}%`);
      if (a.speakerStats) {
        for (const [name, s] of Object.entries(a.speakerStats)) {
          lines.push(`  ${name}: ${s.count} events, avg pitch ${s.avgPitch}, ${s.dominantSentiment}`);
        }
      }
    }

    return lines.join('\n');
  }

  // ── Private Utilities ───────────────────────────────────────────

  /**
   * Generate a session ID from title and timestamp.
   * @private
   */
  _generateId(title) {
    const date = new Date().toISOString().slice(0, 10);
    const slug = (title || 'session')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30);
    const rand = Math.random().toString(36).substring(2, 6);
    return `${date}-${slug}-${rand}`;
  }

  /**
   * Build (or rebuild) the session index.
   * @private
   */
  _ensureIndex() {
    if (this._index) return;
    const files = fs.readdirSync(this.storageDir)
      .filter(f => f.endsWith('.json'));
    this._index = files.map(f => {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(this.storageDir, f), 'utf8')
        );
        return {
          id: data.id,
          title: data.title,
          createdAt: data.createdAt,
          endedAt: data.endedAt,
          participants: data.participants || [],
          key: data.key,
          mode: data.mode,
          bpm: data.bpm,
          eventCount: (data.events || []).length,
          tension: data.analysis?.tension ?? 0,
          energy: data.analysis?.energy ?? 0,
          complexity: data.analysis?.complexity ?? 0,
          dominantMode: data.analysis?.dominantMode ?? 'UNKNOWN',
        };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /**
   * Cosine similarity between two vectors.
   * @private
   */
  _cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom > 0 ? dot / denom : 0;
  }
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = { SessionStore };
