// ═══════════════════════════════════════════════════════════════════
// Clip — a conversation as a GESTURE, not a point (tensor-midi)
//
// tensor-midi captures dialogue as a stream of SWMIDI-8 events, each a
// coordinate in a 4-D tensor: [channel, pitch(sentiment), velocity(prominence),
// tick]. Usually we summarize a span — average tension, energy, mode. That is
// the math as it is usually done: a tensor is a *function approximator*, so you
// reduce to a point and measure the point.
//
// A Clip goes below that. It treats a span of events as the *path* the
// conversation traces through abstraction space, and reads the GESTURE — how far
// it travels (arcLength), how hard it turns (bendingEnergy), and where it is
// heading (tangent, a velocity / d_mu). It is the tensor-midi sibling of the
// `meta` layer in SuperInstance/musician-soul, and it carries the same thesis:
// we are an *abstraction* approximator, not merely a function approximator.
//
// It also bridges to musician-soul: `toPhraseEvents()` exports a Clip as a
// Phrase-compatible note list, so a conversation can be digested by a musical
// persona. See docs/BRIDGE-TO-MUSICIAN-SOUL.md.
//
// Pure JS, zero dependencies, and never throws on empty/degenerate input.
// ═══════════════════════════════════════════════════════════════════

/** Count set bits in a friction/error mask (0–8). */
function popcount(mask) {
  let m = mask & 0xff;
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

/**
 * Map a SWMIDI event to a point in a normalized 4-D abstraction space:
 * [channel, pitch(sentiment), velocity(prominence), friction]. Each axis is
 * scaled to roughly [0, 1] so no single axis dominates the geometry.
 */
function featurePoint(e) {
  return [
    (e.channel & 0x0f) / 15,
    (e.pitch & 0x7f) / 127,
    (e.velocity & 0x7f) / 127,
    popcount(e.errorMask) / 8,
  ];
}

function sub(a, b) {
  return a.map((x, i) => x - b[i]);
}
function norm(a) {
  return Math.sqrt(a.reduce((s, x) => s + x * x, 0));
}
function dist(a, b) {
  return norm(sub(a, b));
}
function cosine(a, b) {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const na = norm(a);
  const nb = norm(b);
  return na === 0 || nb === 0 ? 0 : dot / (na * nb);
}

/**
 * A Clip is a span of SWMIDI events, read as a gesture through abstraction space.
 */
export class Clip {
  /**
   * @param {Array<object>} events SWMIDI events ({channel,pitch,velocity,errorMask,tick,...}).
   *   Order is preserved by tick (a copy is sorted ascending).
   */
  constructor(events = []) {
    this.events = [...events].sort((a, b) => a.tick - b.tick);
  }

  get length() {
    return this.events.length;
  }

  /** The path through abstraction space: one normalized 4-D point per event. */
  path() {
    return this.events.map(featurePoint);
  }

  /**
   * How far the conversation-gesture travels through abstraction space — the sum
   * of distances between consecutive event points. 0 for fewer than two events.
   */
  arcLength() {
    const p = this.path();
    let total = 0;
    for (let i = 1; i < p.length; i++) total += dist(p[i - 1], p[i]);
    return total;
  }

  /**
   * How hard the gesture turns — summed direction change (1 − cosine) between
   * consecutive segments. 0 for a straight line (a conversation moving steadily
   * in one direction) at any speed; large for a restless, veering exchange.
   */
  bendingEnergy() {
    const p = this.path();
    let energy = 0;
    for (let i = 2; i < p.length; i++) {
      const d1 = sub(p[i - 1], p[i - 2]);
      const d2 = sub(p[i], p[i - 1]);
      if (norm(d1) > 1e-9 && norm(d2) > 1e-9) energy += 1 - cosine(d1, d2);
    }
    return energy;
  }

  /**
   * The gesture's heading — the unit direction of its final segment. A velocity
   * through abstraction space (the conversation's `d_mu`). Zero vector if the
   * clip has fewer than two events.
   */
  tangent() {
    const p = this.path();
    if (p.length < 2) return [0, 0, 0, 0];
    const d = sub(p[p.length - 1], p[p.length - 2]);
    const n = norm(d);
    return n === 0 ? [0, 0, 0, 0] : d.map((x) => x / n);
  }

  /** Fraction of events carrying friction (0–1) — the clip's felt tension. */
  frictionRatio() {
    if (this.events.length === 0) return 0;
    const f = this.events.filter((e) => (e.errorMask & 0xff) !== 0).length;
    return f / this.events.length;
  }

  /**
   * Export as a musician-soul `Phrase`-compatible note list. Each NoteOn becomes
   * `{ pitch, velocity, duration, tickOffset }` — the exact tuple
   * `parse_midi_events` consumes (pitch, velocity, duration, offset).
   *
   * Conventions (documented, not hidden): only NoteOn events become notes; the
   * SWMIDI `pitch` byte is an action type, so it's folded into a playable MIDI
   * band (48 + pitch % 37, i.e. C2–C5); `duration` is the tick gap to the next
   * note (≥1); `tickOffset` is the tick gap since the previous note (≥0). Ticks
   * are tensor-midi ticks (PPQ 96), not musician-soul's 480 — rescale on import
   * if the duration helpers matter.
   */
  toPhraseEvents() {
    const notes = this.events.filter((e) => e.eventType === 0 /* NoteOn */);
    const out = [];
    for (let i = 0; i < notes.length; i++) {
      const e = notes[i];
      const prev = i > 0 ? notes[i - 1] : null;
      const next = i < notes.length - 1 ? notes[i + 1] : null;
      const tickOffset = prev ? Math.max(0, e.tick - prev.tick) : 0;
      const duration = next ? Math.max(1, next.tick - e.tick) : 1;
      out.push({
        pitch: 48 + ((e.pitch & 0x7f) % 37),
        velocity: e.velocity & 0x7f,
        duration,
        tickOffset,
      });
    }
    return out;
  }
}

export default Clip;
