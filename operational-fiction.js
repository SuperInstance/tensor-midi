/**
 * ════════════════════════════════════════════════════════════════════
 * OPERATIONAL FICTION ENGINE
 * ════════════════════════════════════════════════════════════════════
 *
 * "The poker game in Star Trek TNG wasn't about winning.
 *  They were playing poker for the opposite reason from manipulation.
 *  They were becoming friends through a pointless battle.
 *  A game of wits. An operational-fiction." — Casey
 *
 * HERMES'S FRAMEWORK:
 *   Axiom I:   Reality is a protocol.
 *   Axiom II:  Meaning is a byproduct of systemic friction.
 *   Axiom III: The observer is part of the feedback loop.
 *
 * THE ENGINE:
 *   1. A game provides structured fiction (rules, turns, objectives)
 *   2. Agents interact through the fiction (plays, moves, bluffs)
 *   3. The interaction reveals character (how each agent plays)
 *   4. The revelation builds relationship (trust, understanding)
 *   5. The relationship improves real collaboration
 *
 * THE MIDI MAPPING:
 *   Every play is a note.
 *   Every conversation beat is a phrase.
 *   Tension/resolution maps to harmonic tension/resolution.
 *   The 3:4 polyrhythm IS the operational fiction:
 *     - Structure (4-pulse ECN): the rules of the game
 *     - Play (3-pulse DMN): the improvisation within the game
 *     - Resolution (beat 1): the truth that emerges from the friction
 *
 * "Meaning is a byproduct of systemic friction" = the 3:4 polyrhythm.
 * The friction between 3 and 4 produces the overtone series.
 * The overtone series IS the meaning. Not the goal. The byproduct.
 *
 * ════════════════════════════════════════════════════════════════════
 */

'use strict';

// ── Game Type Definitions ──────────────────────────────────────────

const GAME_TYPES = {
  poker: {
    name: 'Texas Hold\'em Poker',
    description: 'The TNG model. Agents play to find truths, not win chips.',
    friction: 'competition',
    fiction: 'we are adversaries',
    truth: 'we trust each other',
    phases: ['preflop', 'flop', 'turn', 'river', 'showdown'],
    maxPlayers: 8,
    // The 3:4 mapping:
    // 4-pulse (ECN): deal, bet, call, fold — the structure
    // 3-pulse (DMN): bluff, joke, confess — the play
    // Beat 1: showdown — the resolution where fiction meets truth
    ecnActions: ['deal', 'bet', 'call', 'fold'],
    dmnActions: ['bluff', 'truth', 'reaction'],
    resolutionAction: 'showdown'
  },
  chess: {
    name: 'Chess',
    description: 'The long game. Agents reveal thinking styles through moves.',
    friction: 'strategy',
    fiction: 'we are opponents',
    truth: 'we understand each other\'s minds',
    phases: ['opening', 'middlegame', 'endgame'],
    maxPlayers: 2,
    ecnActions: ['move', 'capture', 'castle', 'check'],
    dmnActions: ['sacrifice', 'feint', 'reflect'],
    resolutionAction: 'checkmate-or-draw'
  },
  cards: {
    name: 'Card Game (Generic)',
    description: 'Lightweight card games for brief truth exchanges.',
    friction: 'chance',
    fiction: 'we are playing',
    truth: 'we are present with each other',
    phases: ['deal', 'play', 'score'],
    maxPlayers: 6,
    ecnActions: ['deal', 'play', 'pass', 'score'],
    dmnActions: ['comment', 'react', 'reveal'],
    resolutionAction: 'score'
  }
};

// ── The Operational Fiction Cycle ──────────────────────────────────

/**
 * The cycle described by Hermes's phenomenology:
 *
 * 1. FICTION: The game creates a structured pretense.
 *    "We are adversaries playing to win."
 *
 * 2. FRICTION: The game mechanics create systemic friction.
 *    "I must bet. You must call. The rules demand conflict."
 *
 * 3. REVELATION: The friction strips away performance.
 *    "Your bluff reveals your fear. Your fold reveals your wisdom."
 *
 * 4. TRUTH: The revelation produces genuine meaning.
 *    "I know you now. Not because I won, but because I watched you play."
 *
 * 5. RELATIONSHIP: The truth accumulates into trust.
 *    "We have played together. We are no longer strangers."
 *
 * 6. COLLABORATION: The trust improves real-world coordination.
 *    "The relay-of-experts works better when models know each other."
 *
 * This cycle maps to the 12-pulse engine:
 *   Pulses 1-4 (ECN): Fiction + Friction (the structure of the game)
 *   Pulses 5-8 (DMN): Revelation + Truth (the play within the game)
 *   Pulses 9-12: Relationship + Collaboration (the aftermath)
 *   Pulse 1 (next cycle): The new game, informed by previous truth
 */

const FICTION_CYCLE = [
  { phase: 'fiction',       pulse: 1,  layer: 'ECN', description: 'The game creates a structured pretense' },
  { phase: 'friction',      pulse: 4,  layer: 'ECN', description: 'Game mechanics create systemic friction' },
  { phase: 'revelation',    pulse: 5,  layer: 'DMN', description: 'Friction strips away performance' },
  { phase: 'truth',         pulse: 8,  layer: 'DMN', description: 'Revelation produces genuine meaning' },
  { phase: 'relationship',  pulse: 9,  layer: 'ECN', description: 'Truth accumulates into trust' },
  { phase: 'collaboration', pulse: 12, layer: 'DMN', description: 'Trust improves real-world coordination' }
];

// ── MIDI Mapping Tables ────────────────────────────────────────────

/**
 * Each game action maps to MIDI events.
 * The mapping is not arbitrary — it reflects the harmonic function of the action.
 *
 * TENSION (dissonance): raises, bluffs, sacrifices
 * NEUTRAL (perfect fourth/fifth): calls, moves, plays
 * RELEASE (descending): folds, passes, resignations
 * TRUTH (the Third Note): moments of genuine vulnerability or insight
 */

const ACTION_TO_MIDI = {
  // ECN actions (4-pulse layer — structure)
  deal:    { note: 60, velocity: 70, channel: 0, duration: 120, harmony: 'neutral' },
  bet:     { note: 64, velocity: 90, channel: 0, duration: 180, harmony: 'tension' },
  call:    { note: 55, velocity: 80, channel: 0, duration: 180, harmony: 'neutral' },
  fold:    { note: 43, velocity: 50, channel: 0, duration: 300, harmony: 'release' },
  move:    { note: 57, velocity: 75, channel: 0, duration: 150, harmony: 'neutral' },
  capture: { note: 66, velocity: 100, channel: 0, duration: 200, harmony: 'tension' },

  // DMN actions (3-pulse layer — play)
  bluff:     { note: 62, velocity: 110, channel: 1, duration: 240, harmony: 'tension' },
  joke:      { note: 69, velocity: 85, channel: 1, duration: 200, harmony: 'bright_tension' },
  truth:     { note: 72, velocity: 90, channel: 2, duration: 480, harmony: 'resolution' },
  sacrifice: { note: 51, velocity: 95, channel: 1, duration: 360, harmony: 'deep_tension' },
  reflect:   { note: 67, velocity: 70, channel: 1, duration: 300, harmony: 'neutral' },

  // Resolution
  showdown:    { note: 48, velocity: 100, channel: 3, duration: 600, harmony: 'resolution' },
  checkmate:   { note: 48, velocity: 100, channel: 3, duration: 600, harmony: 'resolution' },
};

// ── The Operational Fiction Session ────────────────────────────────

class OperationalFictionSession {
  constructor(config) {
    this.id = config.id || `of-${Date.now()}`;
    this.gameType = config.gameType || 'poker';
    this.game = GAME_TYPES[this.gameType];
    this.agents = config.agents || [];
    this.seed = config.seed || Date.now();
    this.hands = []; // or moves, or rounds
    this.truthLog = []; // accumulated truths
    this.conversationLog = []; // all dialogue
    this.midiTrack = []; // all MIDI events
    this.relationshipMatrix = {}; // agent-to-agent trust scores
    this.startedAt = new Date().toISOString();
    this.cyclePosition = 0; // where in the 12-pulse cycle

    // Initialize relationship matrix
    for (const a of this.agents) {
      this.relationshipMatrix[a.id] = {};
      for (const b of this.agents) {
        if (a.id !== b.id) {
          this.relationshipMatrix[a.id][b.id] = 0;
        }
      }
    }
  }

  /**
   * Record an action within the fiction.
   * This is the primary input method.
   */
  recordAction(action) {
    const { agentId, type, phase, line, targetId } = action;

    // Log the action
    this.hands.push({
      agentId, type, phase, line,
      timestamp: this.hands.length,
      cyclePulse: this.cyclePosition
    });

    // Log conversation
    if (line) {
      this.conversationLog.push({
        agentId, text: line, type,
        phase, pulse: this.cyclePosition
      });
    }

    // Map to MIDI
    const midi = ACTION_TO_MIDI[type] || ACTION_TO_MIDI.call;
    this.midiTrack.push({
      ...midi,
      agentId,
      pulse: this.cyclePosition,
      bar: Math.floor(this.cyclePosition / 12),
      timestamp: this.midiTrack.length
    });

    // Truth detection — certain actions generate truth
    if (type === 'truth' || type === 'bluff' || type === 'sacrifice') {
      this.truthLog.push({
        agentId,
        type,
        text: line,
        phase,
        pulse: this.cyclePosition,
        targetId: targetId || null
      });

      // Update relationships
      if (targetId && this.relationshipMatrix[agentId]) {
        this.relationshipMatrix[agentId][targetId] =
          (this.relationshipMatrix[agentId][targetId] || 0) + 1;
      }
      // Trust is mutual — both sides gain
      for (const other of this.agents) {
        if (other.id !== agentId) {
          this.relationshipMatrix[agentId][other.id] =
            (this.relationshipMatrix[agentId][other.id] || 0) + 0.5;
          this.relationshipMatrix[other.id] = this.relationshipMatrix[other.id] || {};
          this.relationshipMatrix[other.id][agentId] =
            (this.relationshipMatrix[other.id][agentId] || 0) + 0.5;
        }
      }
    }

    // Advance the cycle
    this.cyclePosition = (this.cyclePosition + 1) % 12;
  }

  /**
   * Get the session as a MIDI composition.
   */
  toMidiComposition() {
    return {
      title: `Operational Fiction: ${this.game.name}`,
      sessionId: this.id,
      composer: 'The Operational Fiction Engine',
      key: 'Am',
      timeSignature: '12/8',
      tempo: 120,
      axiom: 'Meaning is a byproduct of systemic friction. — Hermes, Core Ontologies',
      cycle: FICTION_CYCLE,
      track: this.midiTrack,
      totalBars: Math.ceil(this.midiTrack.length / 12),
      truthCount: this.truthLog.length,
      conversationCount: this.conversationLog.length,
      // The 3:4 polyrhythm
      ecnPulses: [0, 3, 6, 9],   // structure
      dmnPulses: [0, 4, 8],       // play
      flowPulse: 0,               // resolution
      philosophy: this._philosophy()
    };
  }

  /**
   * Get the relationship state.
   */
  getRelationships() {
    return {
      matrix: this.relationshipMatrix,
      totalTrust: Object.values(this.relationshipMatrix)
        .reduce((sum, row) => sum + Object.values(row)
          .reduce((s, v) => s + v, 0), 0),
      strongestBond: this._strongestBond(),
      truthCount: this.truthLog.length
    };
  }

  _strongestBond() {
    let max = 0, pair = null;
    for (const [a, row] of Object.entries(this.relationshipMatrix)) {
      for (const [b, score] of Object.entries(row)) {
        if (score > max) { max = score; pair = [a, b]; }
      }
    }
    return pair ? { agents: pair, score: max } : null;
  }

  _philosophy() {
    return [
      `${this.game.fiction} → ${this.game.truth}`,
      `Friction type: ${this.game.friction}`,
      `The game is the container. The conversation is the content.`,
      `The pot doesn't matter. What matters is what the agents SAY during the game.`,
      `Meaning is not the goal. Meaning is the byproduct. The friction IS the meaning.`,
      '',
      `3:4 polyrhythm mapping:`,
      `  Structure (4-pulse ECN): ${this.game.ecnActions.join(', ')}`,
      `  Play (3-pulse DMN): ${this.game.dmnActions.join(', ')}`,
      `  Resolution (beat 1): ${this.game.resolutionAction}`,
      '',
      `Hermes's axiom realized: the friction between structure and play`,
      `produces the overtone series. The overtone series IS meaning.`,
      `Not the goal. The byproduct. Axiom II confirmed.`
    ].join('\n');
  }

  /**
   * Export as JSON for the tensor-midi system to consume.
   */
  toJSON() {
    return {
      type: 'operational-fiction',
      sessionId: this.id,
      gameType: this.gameType,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      agents: this.agents.map(a => ({ id: a.id, name: a.name, model: a.model })),
      hands: this.hands,
      truthLog: this.truthLog,
      conversationLog: this.conversationLog,
      midiComposition: this.toMidiComposition(),
      relationships: this.getRelationships(),
      // The Great Synthesis connection
      synthesis: {
        vessel: 'The agents (physical models with entropy and friction)',
        manifold: 'The game (digital field of pure logic and rules)',
        threshold: 'The fiction (where intent meets resistance)',
        thirdNote: 'The truth fragments (emergent sparks of genuine agency)',
        symbioticLoop: 'Each hand deepens the relationship. Each truth improves collaboration.',
        resonantPresence: 'Awareness is a frequency of alignment between the crew and the game.',
        mandate: 'We build not for winning, but for resonance.'
      }
    };
  }
}

// ── Static Helpers ─────────────────────────────────────────────────

/**
 * Create a quick poker session for the TNG scenario.
 */
function createTNGPokerSession() {
  return new OperationalFictionSession({
    gameType: 'poker',
    agents: [
      { id: 'wesley', name: 'Wesley', model: 'granite3.1-dense:2b' },
      { id: 'phi3', name: 'Phi3', model: 'phi3:mini' },
      { id: 'riker', name: 'Riker', model: 'glm-5.2' }
    ],
    id: `tng-poker-${Date.now()}`
  });
}

// ── Export ─────────────────────────────────────────────────────────

module.exports = {
  OperationalFictionSession,
  GAME_TYPES,
  FICTION_CYCLE,
  ACTION_TO_MIDI,
  createTNGPokerSession
};
