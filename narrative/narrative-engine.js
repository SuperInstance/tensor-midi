// ═══════════════════════════════════════════════════════════════════
// NARRATIVE ENGINE
// ═══════════════════════════════════════════════════════════════════
//
// "The files have the facts but not the texture. They're like MIDI
//  transcriptions — structure without timbre." — Casey, session-002
//
// Every other module in this system reads the room and reports a
// number: tension: 0.7, energy: 0.3, mode: TENSION, chord: Dom7.
// Correct, and cold. This module reads the same eight bytes and
// reports a room: the words landing heavy, a minor chord hanging in
// the air, the current pulling hard against the bow.
//
// Not analysis. Testimony.
//
// THE SPLIT:
//   Classification (texture, friction) is a pure function of the
//   SWMIDI wire fields — pitch, velocity, errorMask. Same event,
//   same reading, always. This is "the objective data IS the random":
//   the dice have already been thrown, the bytes already say what
//   they say.
//
//   Phrasing is chosen by a tick-seeded slice of PlatonicRNG
//   (icosahedron — 12-fold, matching the pulse grid). It never
//   touches the classification, only which of several true sentences
//   gets spoken. This is "the narrative IS the strategy that surfs
//   it" — replayable, but never flat.
//
// No message text is required as input. The wire format — pitch,
// velocity, friction, tick, channel — is proven sufficient to carry
// a story, the same way the C and Rust implementations proved it
// sufficient to carry a conversation.
//
// ═══════════════════════════════════════════════════════════════════

'use strict';

import { Friction } from '../src/swmidi.js';
import { PulseGrid, tickToPosition } from '../src/engine.js';
import { JazzAnalyzer, JazzMode, ChordQuality } from '../src/analyzer.js';

// ── PlatonicRNG-lite ─────────────────────────────────────────────────
//
// A trimmed, inlined port of platonic-randomness's PlatonicRNG, fixed
// to the icosahedron solid and the mulberry32 backend. Ported rather
// than imported: this module stays dependency-free and self-contained,
// in keeping with the polyformalism's habit of each implementation
// carrying its own weight rather than reaching across the workspace.
//
// Seeded per-event by `tick`, so a given event always narrates with
// the same *texture* of randomness — replay a session and the story
// comes out identical, right down to which phrase was chosen.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Icosahedron vertices, normalized — 12 of them, one per pulse.
const ICOSAHEDRON_VERTICES = [
  [0, 1, 1.236], [0, 1, -1.236],
  [0, -1, 1.236], [0, -1, -1.236],
  [1, 1.236, 0], [1, -1.236, 0],
  [-1, 1.236, 0], [-1, -1.236, 0],
  [1.236, 0, 1], [1.236, 0, -1],
  [-1.236, 0, 1], [-1.236, 0, -1],
];

class TickRNG {
  constructor(seed) {
    const seedNum = typeof seed === 'string' ? xmur3(seed)() : (seed >>> 0);
    this.state = seedNum;
    this.stepCount = 0;
    this.backend = mulberry32(seedNum);
  }

  next() {
    const v = ICOSAHEDRON_VERTICES[this.stepCount % 12];
    this.state = (this.state ^ Math.imul(v[0] * 1000 + v[1] * 100 + v[2] * 10, 0x9e3779b9)) >>> 0;
    this.stepCount++;
    const raw = this.backend();
    const mixed = ((raw * 4294967296) ^ this.state) >>> 0;
    return mixed / 4294967296;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

// ── Classification ───────────────────────────────────────────────────
//
// Pure functions of the wire bytes. No randomness lives here.

const FRICTION_ORDER = Object.entries(Friction).filter(([name]) => name !== 'None');

/// Which friction bits fired, in wire-declared order.
export function frictionBits(errorMask) {
  return FRICTION_ORDER.filter(([, bit]) => (errorMask & bit) !== 0).map(([name]) => name);
}

/// Read the texture of a single event straight off pitch/velocity/errorMask.
export function classifyEvent(event) {
  const bits = frictionBits(event.errorMask);
  if (bits.length > 0) return { texture: 'tense', frictionBits: bits };
  if (event.pitch >= 80) return { texture: 'questioning', frictionBits: [] };
  if (event.pitch <= 45) return { texture: 'grounded', frictionBits: [] };
  if (event.velocity >= 95) return { texture: 'bright', frictionBits: [] };
  return { texture: 'neutral', frictionBits: [] };
}

/// A volume descriptor derived from velocity — how the words arrived, not what they were.
export function volumeWord(velocity) {
  if (velocity < 30) return 'barely above a whisper';
  if (velocity < 70) return 'level and unhurried';
  if (velocity < 110) return 'sharp, carrying';
  return 'loud, filling the room';
}

// ── Word banks ────────────────────────────────────────────────────────
//
// Style, not substance. Every entry here is a true way of saying a
// texture the classifier has already decided. Jazz and nautical
// registers share the same banks deliberately — the room is one
// instrument, not two.

const TEXTURE_TEMPLATES = {
  questioning: [
    "{name}'s voice climbed at the end, {volume} — a question left hanging like a held note.",
    "{name} leaned into an open fifth, unresolved, {volume} — reaching for an answer that hadn't arrived yet.",
    "The bow turned a few degrees toward uncertain water as {name} asked without quite asking.",
    "{name} lifted the phrase at the close, {volume}, and let it drift — waiting to see which way the current answered.",
  ],
  grounded: [
    "{name} settled low, {volume} — a root note, something the rest of the room could stand on.",
    "The keel found the bottom of the channel as {name} spoke plainly, {volume}, nothing dressed up.",
    "{name}'s words came down like a tonic chord, {volume} — resolved before they'd even finished.",
    "Steady as ballast, {name} held the low end, {volume}, while everything else moved around it.",
  ],
  bright: [
    "{name} came in {volume} — a major seventh catching the light, the whole channel strip flashing warm.",
    "The wind filled in behind {name}'s words, {volume}, and for a moment the whole ensemble leaned forward.",
    "{name} played it {volume} and bright — sunlight through kelp, warm and green and moving.",
    "A gust caught {name}'s line and carried it, {volume}, further than anyone expected.",
  ],
  neutral: [
    "{name} kept the pocket, {volume} — a comping chord, unremarkable and necessary.",
    "The vessel held its heading as {name} spoke, {volume}, no drama in it, just the next bar.",
    "{name}'s note landed where it was supposed to, {volume} — in the pocket, in the groove.",
    "Nothing changed course. {name} said their piece, {volume}, and the current carried on.",
  ],
  tense: [
    "{name}'s words landed heavy, {volume} — a minor chord that hung in the air: {friction}.",
    "The current pulled hard against the bow as {name} spoke, {volume}; {friction}.",
    "Something dissonant moved through the room when {name} came in {volume} — {friction}.",
    "{name}'s line went sharp and unresolved, {volume} — beneath the waterline, {friction}.",
  ],
};

const FRICTION_CLAUSES = {
  Timeout: [
    'a silence stretched a beat too long, waiting for an answer that never came',
    'the room held its breath past when it should have moved on',
    'the pause outlasted the phrase that caused it',
  ],
  Conflict: [
    'two voices reached for the same note and neither yielded',
    'the line collided with itself, doubled and fighting',
    'what should have been one voice split into two, arguing',
  ],
  RateLimit: [
    'the room asked for more than it could carry all at once',
    'too much came through the same channel at the same time',
    'the signal choked on its own volume',
  ],
  Ambiguity: [
    'the phrase left more than one door open',
    'nobody was quite sure which way the meaning pointed',
    'the words could be read two ways and both were true',
  ],
  ImportError: [
    "something reached for a piece that wasn't in the room",
    "the thought needed a fact that hadn't arrived yet",
    'a reference pointed at something missing',
  ],
  SyntaxError: [
    "the sentence broke its own grammar halfway through",
    "the shape of the thought didn't hold together",
    'the phrase collapsed before it resolved',
  ],
  TypeMismatch: [
    "the answer didn't fit the shape of the question",
    "what came back wasn't what was asked for",
    'the reply and the question were speaking different languages',
  ],
  NetworkError: [
    'the line went briefly dead between them',
    'the connection dropped and had to be found again',
    'something was lost crossing the gap between the two of them',
  ],
};

// {Bar}/{bar} are pre-formatted labels ("Bar 5" / "bar 5" or "Bars 5–8" /
// "bars 5–8") — capitalized form for sentence-initial use, lowercase for
// mid-sentence use. See barLabel() below.
const MODE_OPENERS = {
  [JazzMode.Groove]: [
    '{Bar}. The ensemble found the pocket — everyone locked to the same current, nobody fighting the tide.',
    'By {bar}, the room had settled into a groove, structure and play moving together like a well-trimmed sail.',
    'Through {bar}, everyone stayed in the pocket — no one pulling ahead, no one dragging behind.',
  ],
  [JazzMode.Building]: [
    '{Bar}. Voices layered on top of each other, energy climbing like wind filling canvas.',
    'The pressure built through {bar} — more hands on deck, more sail up, the whole vessel picking up speed.',
    'Something gathered over {bar}, each voice adding a little more weight to what came before it.',
  ],
  [JazzMode.Tension]: [
    '{Bar}. Something dissonant took hold — friction in the rigging, a chord that refused to resolve.',
    'By {bar}, the current had turned against the bow. The room was working against itself.',
    'Through {bar}, the argument never quite broke the surface, but it never quite let go either.',
  ],
  [JazzMode.Release]: [
    '{Bar}. The tension broke and the room exhaled — the chord finally found its resolution.',
    'The wind eased through {bar}, and what had been fighting the hull let go.',
    'By {bar}, whatever had been pulling against the current stopped pulling.',
  ],
  [JazzMode.Solo]: [
    '{Bar} belonged to {name} — one voice carrying the whole vessel forward.',
    'Everyone else held their breath through {bar} while {name} took the wheel alone.',
    'The rest of the room fell back and let {name} run {bar} alone.',
  ],
  [JazzMode.Comping]: [
    '{Bar}. Nobody soloed — everyone comped for each other, small chords supporting a shape none of them stated outright.',
    'The crew worked {bar} as a unit, no one voice louder than the others, all of them trimming the same sail.',
    'Through {bar}, everyone played in support of everyone else — no lead, just weight shared evenly.',
  ],
  [JazzMode.Free]: [
    '{Bar} drifted into open water — no chart, no fixed heading, just the room finding its own way.',
    'There was no form to {bar}, only exploration — the ensemble sailing by feel.',
    '{Bar} went wherever it wanted, unmoored from any fixed course.',
  ],
  [JazzMode.Ballad]: [
    '{Bar} slowed to a ballad — long, contemplative, the vessel barely making way.',
    '{Bar} went quiet and slow, the current barely moving beneath a becalmed hull.',
    'Everything eased through {bar} — unhurried, in no rush to arrive anywhere.',
  ],
};

const CHORD_COLORS = {
  [ChordQuality.Major7]: [
    'The harmony sat in warm major sevenths, bright and unclouded.',
    'Underneath it all: major sevenths, open and generous.',
  ],
  [ChordQuality.Minor7]: [
    'The chord underneath was a cool minor seventh — thoughtful, a little melancholy.',
    'Minor sevenths colored it, contemplative rather than dark.',
  ],
  [ChordQuality.Dominant7]: [
    'The harmony leaned on a dominant seventh, tense and wanting resolution.',
    "A dominant seventh sat under it all, pulling toward somewhere it hadn't arrived yet.",
  ],
  [ChordQuality.Diminished]: [
    'The chord underneath was diminished — dark, unstable, ready to move.',
    'A diminished color ran through it, unsettled at its root.',
  ],
  [ChordQuality.Augmented]: [
    'The harmony floated on an augmented chord — dreamy, ungrounded.',
    'Something augmented and adrift sat beneath it, neither here nor there.',
  ],
  [ChordQuality.Sus4]: [
    "The chord hung suspended, waiting — a sus4 that hadn't decided where to land.",
    'Everything sat on a suspended fourth, poised, not yet resolved.',
  ],
};

const TREND_CLAUSES = {
  rising: [
    'The current was picking up — tension building bar over bar.',
    'The wind was shifting against them, tension rising with it.',
  ],
  falling: [
    'The current was easing — tension letting go, bar by bar.',
    'The wind had come round in their favor; whatever had been building was letting go.',
  ],
  stable: [
    'The current held steady, neither building nor releasing.',
    'Nothing was changing course — the tension held level.',
  ],
};

const MODE_CLOSINGS = {
  [JazzMode.Groove]: 'Mostly, this was a groove — a room that stayed in the pocket more than it fought itself.',
  [JazzMode.Building]: 'Mostly, this was a climb — energy that kept layering and rarely came back down.',
  [JazzMode.Tension]: 'Mostly, this was friction — a session that spent more time working against itself than with.',
  [JazzMode.Release]: 'Mostly, this was release — tension that kept finding its way to resolution.',
  [JazzMode.Solo]: 'Mostly, this was one voice carrying the others — a set built around a single soloist.',
  [JazzMode.Comping]: 'Mostly, this was comping — a room more interested in supporting each other than standing out.',
  [JazzMode.Free]: 'Mostly, this was open water — no fixed form, just the room finding its own way, bar by bar.',
  [JazzMode.Ballad]: 'Mostly, this was slow — a becalmed session, unhurried, in no rush to arrive anywhere.',
};

// ── Rendering helpers ────────────────────────────────────────────────

function render(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? vars[key] : `{${key}}`));
}

function joinFriction(bits, rng) {
  return bits.map((bit) => rng.pick(FRICTION_CLAUSES[bit])).join('; ');
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function barLabel(startBar, endBar) {
  return startBar === endBar
    ? `bar ${startBar + 1}`
    : `bars ${startBar + 1}–${endBar + 1}`;
}

/// Most frequent mode across a phrase's bars — ties favor the earliest bar.
function dominantOf(entries, key) {
  const counts = new Map();
  for (const e of entries) counts.set(e[key], (counts.get(e[key]) || 0) + 1);
  let best = entries[0][key];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) { best = value; bestCount = count; }
  }
  return best;
}

// ── The Engine ────────────────────────────────────────────────────────

export class NarrativeEngine {
  /**
   * @param {object} [options]
   * @param {Record<number,string>} [options.voices] channel -> speaker name
   * @param {number} [options.barsPerChapter] how many 12-pulse bars make up
   *   one narrated phrase (default 4 — a standard jazz phrase length).
   *   A single bar rarely holds more than one or two messages, which reads
   *   as choppy; a phrase gives the analyzer enough room to find a mode.
   */
  constructor(options = {}) {
    this.voices = options.voices || {};
    this.barsPerChapter = options.barsPerChapter || 4;
    this.pulseGrid = new PulseGrid();
    this.jazz = new JazzAnalyzer();

    this.currentBar = null;
    this.barEvents = [];
    this._pendingChapters = [];
    this._chapterBuffer = []; // finalized bars awaiting phrase synthesis
    this._barHistory = []; // every finalized bar, for the epilogue
    this._lastChapterTension = null;
  }

  voiceFor(channel) {
    return this.voices[channel] || `Channel ${channel}`;
  }

  /**
   * Narrate a single SWMIDI event. Returns one line of prose.
   * If this event closes out a bar, the finished bar's chapter is
   * queued internally — retrieve it with chapter().
   */
  beat(event) {
    const { bar } = tickToPosition(event.tick);

    if (this.currentBar === null) {
      this.currentBar = bar;
    } else if (bar > this.currentBar) {
      this._finalizeBar(this.currentBar);
      this.barEvents = [];
      this.currentBar = bar;
    }

    this.pulseGrid.addEvent(event);
    this.barEvents.push(event);

    const { texture, frictionBits: bits } = classifyEvent(event);
    const rng = new TickRNG(event.tick);
    const template = rng.pick(TEXTURE_TEMPLATES[texture]);

    return render(template, {
      name: this.voiceFor(event.channel),
      volume: volumeWord(event.velocity),
      friction: joinFriction(bits, rng),
    });
  }

  /**
   * Dequeue the next finished bar's paragraph, or null if none is ready.
   */
  chapter() {
    return this._pendingChapters.length > 0 ? this._pendingChapters.shift() : null;
  }

  _finalizeBar(bar) {
    if (this.barEvents.length === 0) return;

    const stats = this.jazz.analyzeBar(this.barEvents, this.pulseGrid, bar);
    const entry = {
      bar,
      firstTick: this.barEvents[0].tick,
      dominantChannel: stats.dominantChannel ?? this.barEvents[0].channel,
      mode: stats.mode,
      chord: stats.chord,
      tension: stats.tension,
      energy: stats.energy,
    };

    this._barHistory.push(entry);
    this._chapterBuffer.push(entry);
    if (this._chapterBuffer.length >= this.barsPerChapter) this._emitChapter();
  }

  /// Synthesize the buffered bars into one narrated phrase.
  _emitChapter() {
    if (this._chapterBuffer.length === 0) return;
    const group = this._chapterBuffer;
    this._chapterBuffer = [];

    const startBar = group[0].bar;
    const endBar = group[group.length - 1].bar;
    const label = barLabel(startBar, endBar);
    const mode = dominantOf(group, 'mode');
    const chord = group[group.length - 1].chord;
    const rng = new TickRNG(group[0].firstTick);

    const opener = render(rng.pick(MODE_OPENERS[mode] || MODE_OPENERS[JazzMode.Groove]), {
      Bar: capitalize(label),
      bar: label,
      name: this.voiceFor(dominantOf(group, 'dominantChannel')),
    });
    const chordColor = rng.pick(CHORD_COLORS[chord] || CHORD_COLORS[ChordQuality.Major7]);

    const sentences = [opener, chordColor];

    if (this._lastChapterTension !== null) {
      const delta = group[group.length - 1].tension - this._lastChapterTension;
      const trend = delta > 5 ? 'rising' : delta < -5 ? 'falling' : 'stable';
      sentences.push(rng.pick(TREND_CLAUSES[trend]));
    }

    this._pendingChapters.push(sentences.join(' '));
    this._lastChapterTension = group[group.length - 1].tension;
  }

  /**
   * Narrate a full stream of events in order. Returns every beat and
   * every chapter produced along the way, in the order they occurred.
   */
  narrate(events) {
    const sorted = [...events].sort((a, b) => a.tick - b.tick);
    const beats = [];
    const chapters = [];

    for (const event of sorted) {
      beats.push(this.beat(event));
      let ch;
      while ((ch = this.chapter()) !== null) chapters.push(ch);
    }

    return { beats, chapters };
  }

  /**
   * Close out the session: finalizes any still-open bar, drains any
   * remaining chapters into the return value, and returns a closing
   * summary built from the whole arc.
   */
  epilogue() {
    if (this.currentBar !== null && this.barEvents.length > 0) {
      this._finalizeBar(this.currentBar);
      this.barEvents = [];
    }
    this._emitChapter(); // flush a partial phrase, if any bars are left buffered

    const trailingChapters = [];
    let ch;
    while ((ch = this.chapter()) !== null) trailingChapters.push(ch);

    if (this._barHistory.length === 0) {
      return { chapters: trailingChapters, summary: 'Too brief to find a form — a single held note, then silence.' };
    }

    const modeCounts = {};
    let peak = this._barHistory[0];
    for (const b of this._barHistory) {
      modeCounts[b.mode] = (modeCounts[b.mode] || 0) + 1;
      if (b.tension > peak.tension) peak = b;
    }
    const dominantMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0][0];
    const finalBar = this._barHistory[this._barHistory.length - 1];

    const summary = [
      `The set closes after ${this._barHistory.length} bar${this._barHistory.length === 1 ? '' : 's'}.`,
      MODE_CLOSINGS[dominantMode] || MODE_CLOSINGS[JazzMode.Groove],
      `The tightest tension came at bar ${peak.bar + 1}; by the end the harmony had settled into ${finalBar.chord}.`,
    ].join(' ');

    return { chapters: trailingChapters, summary };
  }
}
