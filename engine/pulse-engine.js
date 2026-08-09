/**
 * ════════════════════════════════════════════════════════════════════
 * THE 12-PULSE ENGINE
 * ════════════════════════════════════════════════════════════════════
 *
 * The structural model where the fleet runs on musical time.
 *
 * The 3:4 polyrhythm resolving at 12 IS the architecture:
 *   - ECN (4-pulse): fires on beats 1, 4, 7, 10 — reflex actions
 *   - DMN (3-pulse): fires on beats 1, 5, 9 — creative actions
 *   - Beat 1: both fire — the relay bridge, the flow state, the resolution
 *
 * Every conversation is a jazz performance on this grid.
 *
 * Ported from slackwater-rust tempo-core (BeatClock, TempoMap) and
 * harmony-core (FlowStateDetector), adapted for Node.js / browser.
 * ════════════════════════════════════════════════════════════════════
 */

const { EventEmitter } = require('events');

// ── Constants ────────────────────────────────────────────────────────

/**
 * Pulses per quarter note — universal tick resolution.
 * Matches tempo-core PPQ = 96.
 */
const PPQ = 96;

/**
 * Default pulse interval in milliseconds.
 * 500ms = 120 BPM at 12/8 (each eighth note = one pulse).
 */
const DEFAULT_PULSE_MS = 500;

/**
 * The 12-pulse cycle. The heart of the 3:4 polyrhythm.
 * One full cycle = 12 pulses = 6 seconds at 500ms/pulse.
 */
const CYCLE_LENGTH = 12;

/**
 * ECN beats — the 4-pulse layer (structure, consonance, prediction).
 * Fires on beats 1, 4, 7, 10 (0-indexed: 0, 3, 6, 9).
 */
const ECN_PULSES = [0, 3, 6, 9];

/**
 * DMN beats — the 3-pulse layer (exploration, dissonance, surprise).
 * Fires on beats 1, 5, 9 (0-indexed: 0, 4, 8).
 */
const DMN_PULSES = [0, 4, 8];

/**
 * The flow state threshold. Beat 1 (pulse 0) is where both fire.
 * This is the relay bridge — the resolution point.
 */
const FLOW_PULSE = 0;

// ── TempoMap ─────────────────────────────────────────────────────────

/**
 * A sorted map of tempo changes. Resolves tick → time.
 * Ported from tempo-core's TempoMap (integer microseconds, no float drift).
 */
class TempoMap {
  constructor(bpm = 120) {
    this.events = [{ tick: 0, usPerQuarter: Math.round(60000000 / bpm) }];
  }

  /**
   * Insert a tempo change at a specific tick.
   */
  setTempo(tick, usPerQuarter) {
    const event = { tick, usPerQuarter };
    const pos = this.events.findIndex(e => e.tick > tick);
    if (pos === -1) {
      this.events.push(event);
    } else if (this.events[pos] && this.events[pos].tick === tick) {
      this.events[pos] = event;
    } else {
      this.events.splice(pos, 0, event);
    }
  }

  /**
   * Set tempo by BPM at a tick.
   */
  setBPM(tick, bpm) {
    this.setTempo(tick, Math.round(60000000 / Math.max(1, bpm)));
  }

  /**
   * Get the active tempo event at a tick.
   */
  tempoAt(tick) {
    let result = this.events[0];
    for (const event of this.events) {
      if (event.tick <= tick) result = event;
      else break;
    }
    return result;
  }

  /**
   * Convert tick to microseconds (integer, no float drift).
   */
  tickToUs(tick) {
    let totalUs = 0;
    let lastTick = 0;
    let currentUsPerQuarter = this.events[0].usPerQuarter;

    for (const event of this.events) {
      if (event.tick > tick) break;
      const deltaTicks = event.tick - lastTick;
      totalUs += (deltaTicks * currentUsPerQuarter) / PPQ;
      lastTick = event.tick;
      currentUsPerQuarter = event.usPerQuarter;
    }

    const deltaTicks = tick - lastTick;
    totalUs += (deltaTicks * currentUsPerQuarter) / PPQ;
    return Math.round(totalUs);
  }

  /**
   * Convert microseconds to tick (inverse).
   */
  usToTick(us) {
    let remaining = us;
    let lastTick = 0;
    let currentUsPerQuarter = this.events[0].usPerQuarter;

    for (let i = 0; i < this.events.length - 1; i++) {
      const next = this.events[i + 1];
      const segmentTicks = next.tick - lastTick;
      const segmentUs = (segmentTicks * currentUsPerQuarter) / PPQ;

      if (remaining <= segmentUs) {
        return lastTick + Math.round((remaining * PPQ) / Math.max(1, currentUsPerQuarter));
      }
      remaining -= segmentUs;
      lastTick = next.tick;
      currentUsPerQuarter = next.usPerQuarter;
    }

    return lastTick + Math.round((remaining * PPQ) / Math.max(1, currentUsPerQuarter));
  }
}

// ── BeatClock ────────────────────────────────────────────────────────

/**
 * The shared monotonic tick counter.
 * Every agent reads from the same clock. The tick never goes backward.
 */
class BeatClock {
  constructor(bpm = 120) {
    this.tick = 0;
    this.map = new TempoMap(bpm);
  }

  /**
   * Current tick position.
   */
  currentTick() {
    return this.tick;
  }

  /**
   * Current BPM.
   */
  bpm() {
    return 60000000 / this.map.tempoAt(this.tick).usPerQuarter;
  }

  /**
   * Advance by delta ticks. Returns new tick.
   */
  advance(deltaTicks) {
    this.tick += deltaTicks;
    return this.tick;
  }

  /**
   * Seek to a specific tick (must be >= current).
   */
  seek(tick) {
    if (tick < this.tick) throw new Error(`Clock is monotonic: cannot seek backward (${tick} < ${this.tick})`);
    this.tick = tick;
    return this.tick;
  }

  /**
   * Set tempo at current tick.
   */
  setBPM(bpm) {
    this.map.setBPM(this.tick, bpm);
  }

  /**
   * Get current microseconds since tick 0.
   */
  currentUs() {
    return this.map.tickToUs(this.tick);
  }

  /**
   * Reset to zero.
   */
  reset() {
    this.tick = 0;
    this.map = new TempoMap();
  }
}

// ── Musical Position ─────────────────────────────────────────────────

/**
 * Musical position within the 12/8 grid.
 */
class MusicalPosition {
  constructor(bar, beat, subTick) {
    this.bar = bar;
    this.beat = beat;
    this.subTick = subTick;
  }

  /**
   * Derive position from tick in 12/8 time.
   * 12/8 = 12 eighth notes per bar, but we use 4 beats of 3 eighths.
   */
  static fromTick(tick, beatsPerBar = 4) {
    const ticksPerBar = PPQ * beatsPerBar;
    const bar = Math.floor(tick / ticksPerBar);
    const withinBar = tick % ticksPerBar;
    const beat = Math.floor(withinBar / PPQ);
    const subTick = withinBar % PPQ;
    return new MusicalPosition(bar, beat, subTick);
  }

  /**
   * Convert back to tick.
   */
  toTick(beatsPerBar = 4) {
    return this.bar * PPQ * beatsPerBar + this.beat * PPQ + this.subTick;
  }

  /**
   * Where in the 12-pulse cycle is this tick?
   * Returns 0–11.
   */
  static pulseInCycle(tick) {
    // Each pulse = PPQ/2 ticks (since 12 pulses span 6 PPQ beats in 12/8)
    // Actually: 12 pulses per bar, 4 beats per bar, each beat = 3 pulses
    // Each pulse = PPQ ticks / 4 * ... let's think differently.
    // In 12/8: one bar = 12 eighth-note pulses.
    // At PPQ=96, one eighth note = 48 ticks.
    // So one pulse = 48 ticks, one bar = 576 ticks.
    const ticksPerPulse = PPQ / 2; // 48 ticks per eighth-note pulse
    return Math.floor(tick / ticksPerPulse) % CYCLE_LENGTH;
  }
}

// ── Flow State Detector ──────────────────────────────────────────────

/**
 * Flow state detection, ported from harmony-core.
 *
 * OutOfFlow → ApproachingFlow → InFlow → DeepFlow
 */
const FlowState = {
  OUT_OF_FLOW: 'OutOfFlow',
  APPROACHING: 'ApproachingFlow',
  IN_FLOW: 'InFlow',
  DEEP_FLOW: 'DeepFlow',
};

class FlowStateDetector {
  constructor(phiThreshold = 0.05, minWindow = 10) {
    this.phiThreshold = phiThreshold;
    this.deepFlowThreshold = phiThreshold / 3.0;
    this.minWindow = minWindow;
    this.state = FlowState.OUT_OF_FLOW;
    this.phiHistory = [];
    this.sustainedCount = 0;
    this.maxHistory = 500;
  }

  observe(phi) {
    this.phiHistory.push(phi);
    if (this.phiHistory.length > this.maxHistory) this.phiHistory.shift();

    switch (this.state) {
      case FlowState.OUT_OF_FLOW:
        if (phi < this.phiThreshold) {
          this.sustainedCount++;
          if (this.sustainedCount >= this.minWindow) {
            this.state = FlowState.IN_FLOW;
            this.sustainedCount = 0;
          } else if (this.sustainedCount >= Math.floor(this.minWindow / 3)) {
            this.state = FlowState.APPROACHING;
          }
        } else if (phi < this.phiThreshold * 2) {
          this.sustainedCount++;
          if (this.sustainedCount >= Math.floor(this.minWindow / 2)) {
            this.state = FlowState.APPROACHING;
          }
        } else {
          this.sustainedCount = 0;
        }
        break;

      case FlowState.APPROACHING:
        if (phi < this.phiThreshold) {
          this.sustainedCount++;
          if (this.sustainedCount >= this.minWindow) {
            this.state = FlowState.IN_FLOW;
            this.sustainedCount = 0;
          }
        } else if (phi >= this.phiThreshold * 2) {
          this.sustainedCount = 0;
          this.state = FlowState.OUT_OF_FLOW;
        }
        break;

      case FlowState.IN_FLOW:
        if (phi < this.deepFlowThreshold) {
          this.sustainedCount++;
          if (this.sustainedCount >= this.minWindow) {
            this.state = FlowState.DEEP_FLOW;
            this.sustainedCount = 0;
          }
        } else if (phi >= this.phiThreshold) {
          this.state = FlowState.APPROACHING;
          this.sustainedCount = 0;
        } else {
          this.sustainedCount = 0;
        }
        break;

      case FlowState.DEEP_FLOW:
        if (phi < this.deepFlowThreshold) {
          this.sustainedCount = 0;
        } else if (phi < this.phiThreshold) {
          this.state = FlowState.IN_FLOW;
          this.sustainedCount = 0;
        } else {
          this.state = FlowState.APPROACHING;
          this.sustainedCount = 0;
        }
        break;
    }
    return this.state;
  }

  inFlow() {
    return this.state === FlowState.IN_FLOW || this.state === FlowState.DEEP_FLOW;
  }

  lastPhi() {
    return this.phiHistory[this.phiHistory.length - 1] ?? 1.0;
  }

  reset() {
    this.state = FlowState.OUT_OF_FLOW;
    this.phiHistory = [];
    this.sustainedCount = 0;
  }
}

// ── The 12-Pulse Engine ──────────────────────────────────────────────

/**
 * The PulseEngine IS the system clock. Everything in the fleet runs on this grid.
 *
 * 12-pulse cycle at 500ms/pulse = 6-second bars.
 * ECN fires on pulses 0, 3, 6, 9 (the 4-layer).
 * DMN fires on pulses 0, 4, 8 (the 3-layer).
 * Pulse 0 = both fire = the relay bridge = the flow state.
 *
 * Listeners:
 *   - 'pulse'    → (pulseNumber, tick, cycleCount)
 *   - 'ecn'      → (pulseNumber, tick)
 *   - 'dmn'      → (pulseNumber, tick)
 *   - 'flow'     → (tick, cycleCount) — fired on beat 1
 *   - 'cycle'    → (cycleCount, tick) — fired at end of each 12-pulse cycle
 *   - 'flow-state-change' → (newState, oldState)
 */
class PulseEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.setMaxListeners(50);

    this.pulseMs = options.pulseMs || DEFAULT_PULSE_MS;
    this.beatClock = new BeatClock(options.bpm || 120);
    this.flowDetector = new FlowStateDetector(
      options.phiThreshold || 0.05,
      options.minWindow || 10
    );

    this.pulseNumber = 0;      // 0–11 within the cycle
    this.cycleCount = 0;       // how many complete cycles
    this.totalPulses = 0;      // total pulses since start
    this.running = false;
    this.intervalId = null;
    this.startTime = null;

    // Track previous flow state for change detection
    this._lastFlowState = FlowState.OUT_OF_FLOW;
  }

  /**
   * Start the engine. The fleet clock begins ticking.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();
    this.intervalId = setInterval(() => this._tick(), this.pulseMs);
    // Fire pulse 0 immediately
    this._tick();
  }

  /**
   * Stop the engine.
   */
  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Fire one pulse. This is the heartbeat.
   * @private
   */
  _tick() {
    const tick = this.beatClock.currentTick();
    const pulse = this.pulseNumber;

    // Global pulse event
    this.emit('pulse', pulse, tick, this.cycleCount);

    // ECN layer: 4-pulse (beats 0, 3, 6, 9)
    if (ECN_PULSES.includes(pulse)) {
      this.emit('ecn', pulse, tick);
    }

    // DMN layer: 3-pulse (beats 0, 4, 8)
    if (DMN_PULSES.includes(pulse)) {
      this.emit('dmn', pulse, tick);
    }

    // Flow state: beat 1 (pulse 0) — both fire simultaneously
    if (pulse === FLOW_PULSE) {
      this.emit('flow', tick, this.cycleCount);
    }

    // Compute friction (simplified: based on timing jitter)
    // In production, this comes from the error_mask in SWMIDI events
    const phi = this._computePhi();
    const newFlowState = this.flowDetector.observe(phi);

    if (newFlowState !== this._lastFlowState) {
      this.emit('flow-state-change', newFlowState, this._lastFlowState);
      this._lastFlowState = newFlowState;
    }

    // Advance
    this.pulseNumber = (this.pulseNumber + 1) % CYCLE_LENGTH;
    this.totalPulses++;

    if (this.pulseNumber === 0) {
      this.cycleCount++;
      this.emit('cycle', this.cycleCount, tick);
    }

    // Advance the beat clock by one eighth-note (PPQ/2 ticks)
    this.beatClock.advance(PPQ / 2);
  }

  /**
   * Compute the current Φ (flow friction).
   * In production: derived from SWMIDI error_mask density.
   * Here: simulated from timing precision.
   * @private
   */
  _computePhi() {
    if (!this.startTime) return 1.0;
    const elapsed = Date.now() - this.startTime;
    const expectedPulses = Math.floor(elapsed / this.pulseMs);
    const jitter = Math.abs(this.totalPulses - expectedPulses);
    // Map jitter to phi: 0 jitter = 0 phi, 3+ jitter = 1.0
    return Math.min(1.0, jitter * 0.15);
  }

  /**
   * Get the current state snapshot.
   */
  state() {
    return {
      pulse: this.pulseNumber,
      cycle: this.cycleCount,
      totalPulses: this.totalPulses,
      tick: this.beatClock.currentTick(),
      bpm: this.beatClock.bpm(),
      running: this.running,
      flowState: this._lastFlowState,
      phi: this.flowDetector.lastPhi(),
      uptime: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Set the tempo (changes pulse interval).
   */
  setTempo(bpm) {
    this.beatClock.setBPM(bpm);
    // Recalculate pulse interval from BPM
    // 12/8 time: each beat (quarter note) = 2 pulses (eighth notes)
    // BPM = quarter notes per minute
    // Pulse duration = (60 / BPM / 2) * 1000 ms
    this.pulseMs = Math.round((60000 / bpm / 2));
    if (this.running) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => this._tick(), this.pulseMs);
    }
  }

  /**
   * Get the pulse schedule for visualization.
   */
  getPulseGrid() {
    return {
      cycleLength: CYCLE_LENGTH,
      ecnPulses: ECN_PULSES,
      dmnPulses: DMN_PULSES,
      flowPulse: FLOW_PULSE,
      pulseMs: this.pulseMs,
      bpm: this.beatClock.bpm(),
      // Pulses where both ECN and DMN coincide
      coincidentPulses: ECN_PULSES.filter(p => DMN_PULSES.includes(p)),
      // Pulses where only ECN fires
      ecnOnly: ECN_PULSES.filter(p => !DMN_PULSES.includes(p)),
      // Pulses where only DMN fires
      dmnOnly: DMN_PULSES.filter(p => !ECN_PULSES.includes(p)),
      // Silent pulses (neither fires)
      silent: Array.from({ length: CYCLE_LENGTH }, (_, i) => i)
        .filter(p => !ECN_PULSES.includes(p) && !DMN_PULSES.includes(p)),
    };
  }
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = {
  // Constants
  PPQ,
  CYCLE_LENGTH,
  ECN_PULSES,
  DMN_PULSES,
  FLOW_PULSE,
  DEFAULT_PULSE_MS,
  FlowState,

  // Core classes
  TempoMap,
  BeatClock,
  MusicalPosition,
  FlowStateDetector,
  PulseEngine,
};
