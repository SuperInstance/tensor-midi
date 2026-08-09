// ════════════════════════════════════════════════════════════════════
// REPLAY ENGINE — Hear the Conversation Again
// ════════════════════════════════════════════════════════════════════
//
// Load a saved session and replay it through the mixer.
// Like putting on a record — the performance lives again.
//
// The replay engine can:
//   - Play a session back in real-time (or sped up / slowed down)
//   - Play a specific movement (section) of a session
//   - Layer two sessions on top of each other (duet mode)
//   - Emit events that the mixer/UI can consume
//
// "The recording doesn't know it's a recording. It plays the same
//  notes with the same weight. The life is in the listening."
//
// ════════════════════════════════════════════════════════════════════

'use strict';

const { EventEmitter } = require('events');
const { SessionStore } = require('./session-store');

const TICKS_PER_PULSE = 48;
const TICKS_PER_BAR = 576;
const PPQ = 96;

// ── ReplayEngine ─────────────────────────────────────────────────────

class ReplayEngine extends EventEmitter {
  /**
   * @param {SessionStore} store — Session store to load from
   * @param {Object} opts — { tempoMultiplier, startFromTick, endAtTick }
   */
  constructor(store, opts = {}) {
    super();
    this.setMaxListeners(50);

    this.store = store;
    this.tempoMultiplier = opts.tempoMultiplier || 1.0;
    this.startFromTick = opts.startFromTick || 0;
    this.endAtTick = opts.endAtTick || Infinity;

    this.playing = false;
    this.paused = false;
    this.currentEventIndex = 0;
    this.session = null;
    this.events = [];
    this.startTime = 0;
    this.timeoutId = null;

    // Callback for each event (alternative to EventEmitter)
    this.onEvent = null;
    this.onComplete = null;
  }

  // ── Loading ──────────────────────────────────────────────────────

  /**
   * Load a session for replay.
   * @param {string} sessionId
   * @param {Object} opts — { movementIndex, filter }
   */
  load(sessionId, opts = {}) {
    this.session = this.store.load(sessionId);
    if (!this.session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let events = this.session.events || [];

    // Filter by movement
    if (opts.movementIndex !== undefined && this.session.movements) {
      const movement = this.session.movements[opts.movementIndex];
      if (movement) {
        events = movement.eventIndices.map(i => this.session.events[i]);
      }
    }

    // Filter by tick range
    if (this.startFromTick > 0 || this.endAtTick < Infinity) {
      events = events.filter(e =>
        e.tick >= this.startFromTick &&
        e.tick <= this.endAtTick
      );
    }

    // Custom filter
    if (opts.filter) {
      events = events.filter(opts.filter);
    }

    // Sort by tick
    this.events = events.slice().sort((a, b) => a.tick - b.tick);
    this.currentEventIndex = 0;

    return this;
  }

  /**
   * Load events from two sessions for duet/layered replay.
   * Events are merged by tick position.
   * @param {string} sessionIdA
   * @param {string} sessionIdB
   * @param {Object} opts — { offsetB: tick offset for session B }
   */
  loadDuet(sessionIdA, sessionIdB, opts = {}) {
    const offsetB = opts.offsetB || 0;
    const sessionA = this.store.load(sessionIdA);
    const sessionB = this.store.load(sessionIdB);

    if (!sessionA || !sessionB) {
      throw new Error('One or both sessions not found');
    }

    const eventsA = (sessionA.events || []).map(e => ({
      ...e, sourceSession: sessionIdA,
    }));
    const eventsB = (sessionB.events || []).map(e => ({
      ...e,
      tick: e.tick + offsetB,
      sourceSession: sessionIdB,
    }));

    this.events = [...eventsA, ...eventsB].sort((a, b) => a.tick - b.tick);
    this.session = sessionA;
    this.session.title = `Duet: ${sessionA.title} × ${sessionB.title}`;
    this.currentEventIndex = 0;

    return this;
  }

  // ── Playback ─────────────────────────────────────────────────────

  /**
   * Start replaying events.
   * Emits 'event' for each, 'end' when done.
   */
  play() {
    if (this.playing) return;
    if (this.events.length === 0) return;

    this.playing = true;
    this.paused = false;
    this.startTime = Date.now();
    this._scheduleNext();
  }

  /**
   * Pause replay.
   */
  pause() {
    this.paused = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Resume from pause.
   */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this._scheduleNext();
  }

  /**
   * Stop and rewind to beginning.
   */
  stop() {
    this.playing = false;
    this.paused = false;
    this.currentEventIndex = 0;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Seek to a specific event index.
   * @param {number} index
   */
  seek(index) {
    this.currentEventIndex = Math.max(0, Math.min(index, this.events.length - 1));
  }

  /**
   * Replay at maximum speed (no delays) — for analysis/batch processing.
   * Emits all events synchronously.
   */
  playInstant() {
    for (let i = this.currentEventIndex; i < this.events.length; i++) {
      const event = this.events[i];
      this.emit('event', event, i);
      if (this.onEvent) this.onEvent(event, i);
    }
    this.emit('end');
    if (this.onComplete) this.onComplete();
  }

  // ── Info ─────────────────────────────────────────────────────────

  /**
   * Get current replay state.
   */
  state() {
    return {
      playing: this.playing,
      paused: this.paused,
      currentEvent: this.currentEventIndex,
      totalEvents: this.events.length,
      progress: this.events.length > 0
        ? this.currentEventIndex / this.events.length
        : 0,
      sessionId: this.session?.id,
      sessionTitle: this.session?.title,
    };
  }

  /**
   * Get a preview of upcoming events.
   * @param {number} count
   */
  peek(count = 5) {
    const result = [];
    for (let i = 0; i < count && this.currentEventIndex + i < this.events.length; i++) {
      result.push(this.events[this.currentEventIndex + i]);
    }
    return result;
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * Schedule the next event for playback.
   * The delay between events is based on tick differences and tempo.
   * @private
   */
  _scheduleNext() {
    if (!this.playing || this.paused) return;
    if (this.currentEventIndex >= this.events.length) {
      this.playing = false;
      this.emit('end');
      if (this.onComplete) this.onComplete();
      return;
    }

    const event = this.events[this.currentEventIndex];
    const prevTick = this.currentEventIndex > 0
      ? this.events[this.currentEventIndex - 1].tick
      : event.tick;
    const tickDelta = Math.max(0, event.tick - prevTick);

    // Convert tick delta to milliseconds
    // At PPQ=96, one tick = (60000 / BPM / PPQ) ms
    const bpm = this.session?.bpm || 120;
    const msPerTick = (60000 / bpm / PPQ) / this.tempoMultiplier;
    const delayMs = Math.round(tickDelta * msPerTick);

    this.timeoutId = setTimeout(() => {
      this.emit('event', event, this.currentEventIndex);
      if (this.onEvent) this.onEvent(event, this.currentEventIndex);
      this.currentEventIndex++;
      this._scheduleNext();
    }, Math.min(delayMs, 5000)); // Cap at 5s per event
  }
}

// ── BatchReplayer — Replay multiple sessions ─────────────────────────

class BatchReplayer {
  /**
   * Replay multiple sessions in sequence.
   * @param {SessionStore} store
   */
  constructor(store) {
    this.store = store;
    this.engine = new ReplayEngine(store);
  }

  /**
   * Play sessions in order, with optional gap between them.
   * @param {string[]} sessionIds
   * @param {number} gapMs — Gap between sessions in ms
   * @returns {Promise<void>}
   */
  async playSequence(sessionIds, gapMs = 1000) {
    for (let i = 0; i < sessionIds.length; i++) {
      const sessionId = sessionIds[i];
      await new Promise((resolve) => {
        this.engine.load(sessionId);
        this.engine.onComplete = resolve;
        this.engine.play();
      });
      if (i < sessionIds.length - 1) {
        await new Promise(r => setTimeout(r, gapMs));
      }
    }
  }

  /**
   * Analyze a session's replay without playing it in real-time.
   * Returns a timeline of events with computed metrics.
   * @param {string} sessionId
   * @returns {Object[]} — Timeline of events with running metrics
   */
  analyzeTimeline(sessionId) {
    const session = this.store.load(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const events = (session.events || []).slice().sort((a, b) => a.tick - b.tick);
    const timeline = [];

    let runningTension = 0;
    let runningEnergy = 0;
    let runningChannels = new Set();

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      runningChannels.add(e.channel);

      const tensionInc = e.sentiment === 'tense' ? 1 : 0;
      runningTension += tensionInc;
      runningEnergy += e.velocity / 127;

      const tension = runningTension / (i + 1);
      const energy = runningEnergy / (i + 1);

      timeline.push({
        eventIndex: i,
        tick: e.tick,
        bar: Math.floor(e.tick / TICKS_PER_BAR) + 1,
        beat: Math.floor((e.tick % TICKS_PER_BAR) / PPQ) + 1,
        speaker: e.speaker,
        pitch: e.pitch,
        velocity: e.velocity,
        sentiment: e.sentiment,
        text: e.text.substring(0, 80),
        runningTension: Math.round(tension * 100),
        runningEnergy: Math.round(energy * 100),
        activeChannels: runningChannels.size,
      });
    }

    return timeline;
  }
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = { ReplayEngine, BatchReplayer };
