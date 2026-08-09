// ═══════════════════════════════════════════════════════════════════
// The 12-Pulse Engine
// Port of slackwater-rust/crates/tempo-core adapted for 12/8 jazz time
// ═══════════════════════════════════════════════════════════════════
//
// In 12/8 time, there are 12 eighth-note pulses per bar.
// Each pulse is a "slot" where something can happen.
// The engine maps conversation events to pulses and drives the mixer.
//
// 96 PPQ means:
//   1 quarter note = 96 ticks
//   1 eighth note  = 48 ticks
//   1 bar (12/8)   = 12 × 48 = 576 ticks
//
// The 12 pulses form a circle — like a clock face.
// Conversation events land on pulses based on their timing.
// The pattern of filled/empty pulses creates the rhythm of the conversation.

export const PPQ = 96;
export const PULSES_PER_BAR = 12;
export const TICKS_PER_PULSE = PPQ / 2;  // 48 ticks per eighth-note pulse
export const TICKS_PER_BAR = PULSES_PER_BAR * TICKS_PER_PULSE; // 576

/// Default tempo: 120 BPM = 500,000 microseconds per quarter note
export const DEFAULT_US_PER_QUARTER = 500_000;

/// Convert BPM to microseconds per quarter
export function bpmToUsPerQuarter(bpm) {
  return Math.round(60_000_000 / Math.max(1, bpm));
}

/// Convert microseconds per quarter to BPM
export function usPerQuarterToBpm(us) {
  return 60_000_000 / Math.max(1, us);
}

/// Musical position within a 12/8 bar
export function tickToPosition(tick) {
  const bar = Math.floor(tick / TICKS_PER_BAR);
  const withinBar = tick % TICKS_PER_BAR;
  const pulse = Math.floor(withinBar / TICKS_PER_PULSE);
  const subTick = withinBar % TICKS_PER_PULSE;
  return { bar, pulse, subTick };
}

/// Convert position back to tick
export function positionToTick(bar, pulse, subTick = 0) {
  return bar * TICKS_PER_BAR + pulse * TICKS_PER_PULSE + subTick;
}

/// The BeatClock — shared temporal spine
export class BeatClock {
  constructor(bpm = 120) {
    this.tick = 0;
    this.usPerQuarter = bpmToUsPerQuarter(bpm);
    this.tempoChanges = [{ tick: 0, usPerQuarter: this.usPerQuarter }];
    this.startTime = null;
  }
  
  get bpm() {
    return usPerQuarterToBpm(this.usPerQuarter);
  }
  
  setBpm(bpm) {
    this.usPerQuarter = bpmToUsPerQuarter(bpm);
    this.tempoChanges.push({ tick: this.tick, usPerQuarter: this.usPerQuarter });
    this.tempoChanges.sort((a, b) => a.tick - b.tick);
  }
  
  advance(ticks) {
    this.tick = (this.tick + ticks) >>> 0;
  }
  
  /// Convert tick to microseconds (accounting for tempo changes)
  tickToUs(tick) {
    let us = 0;
    let prevTick = 0;
    let prevUsPerQ = DEFAULT_US_PER_QUARTER;
    
    for (const change of this.tempoChanges) {
      if (change.tick > tick) break;
      us += (change.tick - prevTick) * (prevUsPerQ / PPQ);
      prevTick = change.tick;
      prevUsPerQ = change.usPerQuarter;
    }
    us += (tick - prevTick) * (prevUsPerQ / PPQ);
    return Math.round(us);
  }
  
  /// Convert microseconds to tick
  usToTick(us) {
    let tick = 0;
    let remainingUs = us;
    
    for (let i = 0; i < this.tempoChanges.length; i++) {
      const change = this.tempoChanges[i];
      const nextChange = this.tempoChanges[i + 1];
      const nextTick = nextChange ? nextChange.tick : Infinity;
      const usPerTick = change.usPerQuarter / PPQ;
      const maxTicksInSegment = nextTick - change.tick;
      const ticksFromUs = Math.floor(remainingUs / usPerTick);
      
      if (ticksFromUs <= maxTicksInSegment) {
        return (change.tick + ticksFromUs) >>> 0;
      }
      
      tick = change.tick + maxTicksInSegment;
      remainingUs -= maxTicksInSegment * usPerTick;
    }
    
    return tick >>> 0;
  }
  
  start() {
    this.startTime = performance.now();
  }
  
  /// Get the current wall-clock tick
  get currentTick() {
    if (!this.startTime) return this.tick;
    const elapsedMs = performance.now() - this.startTime;
    const elapsedUs = elapsedMs * 1000;
    return this.usToTick(elapsedUs);
  }
}

/// The 12-Pulse Grid — maps events to the 12 pulses of a bar
export class PulseGrid {
  constructor() {
    // Each bar has 12 pulses, each pulse can hold multiple events
    this.bars = new Map(); // barNumber -> array of 12 pulse slots
  }
  
  /// Add an event at a specific tick
  addEvent(event) {
    const { bar, pulse } = tickToPosition(event.tick);
    if (!this.bars.has(bar)) {
      this.bars.set(bar, Array(12).fill(null).map(() => []));
    }
    this.bars.get(bar)[pulse].push(event);
  }
  
  /// Get all events at a specific pulse in a bar
  getPulse(bar, pulse) {
    const barData = this.bars.get(bar);
    if (!barData) return [];
    return barData[pulse] || [];
  }
  
  /// Get a bar's pulse pattern (which pulses are filled)
  getBarPattern(bar) {
    const barData = this.bars.get(bar);
    if (!barData) return new Array(12).fill(false);
    return barData.map(pulse => pulse.length > 0);
  }
  
  /// Analyze the rhythmic density of a bar (0-1)
  getBarDensity(bar) {
    const pattern = this.getBarPattern(bar);
    const filled = pattern.filter(Boolean).length;
    return filled / 12;
  }
  
  /// Get all bars that have events
  get activeBars() {
    return [...this.bars.keys()].sort((a, b) => a - b);
  }
  
  /// Get the total number of events
  get totalEvents() {
    let count = 0;
    for (const bar of this.bars.values()) {
      for (const pulse of bar) {
        count += pulse.length;
      }
    }
    return count;
  }
  
  /// Clear all events
  clear() {
    this.bars.clear();
  }
}

/// Convert wall-clock time to a tick based on BPM
export function timeToTick(timestampMs, bpm) {
  const usPerQuarter = bpmToUsPerQuarter(bpm);
  const usPerTick = usPerQuarter / PPQ;
  const elapsedUs = timestampMs * 1000;
  return Math.floor(elapsedUs / usPerTick) >>> 0;
}

/// The conversation tempo detector — infers BPM from message frequency
export function detectTempo(messages) {
  if (messages.length < 2) return 120; // default
  
  const timestamps = messages.map(m => m.timestamp).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  
  // Median interval
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  
  // Map median interval to BPM: faster messages = higher tempo
  // 500ms per message → ~120 BPM (matching default)
  // 250ms → ~240 BPM (fast)
  // 1000ms → ~60 BPM (slow)
  if (median < 100) return 240;
  if (median < 250) return 180;
  if (median < 500) return 140;
  if (median < 1000) return 120;
  if (median < 2000) return 90;
  if (median < 5000) return 60;
  return 40;
}
