/**
 * PLATONIC RANDOMNESS GAME ENGINE
 * =================================
 *
 * A game system where the CHOICE of Platonic solid IS the game design decision.
 *
 *   Combat      → tetrahedron  (4-fold, fast, readable)
 *   Social      → icosahedron  (12-fold, matches the pulse grid)
 *   Weather     → dodecahedron (20-fold, complex, slow)
 *   Resources   → cube         (8-fold, steady)
 *   Exploration → octahedron   (6-fold, cardinal directions)
 *
 * Input is SWMIDI, the 8-byte wire format from slackwater-rust/crates/swmidi,
 * implemented in ../src/swmidi.js. Every event is exactly 8 bytes; there is no
 * variable-length encoding and no checksum beyond the format's own bounds.
 *
 * The engine interprets SWMIDI events as game actions:
 *
 *   Channel 0-4  → game system (combat, social, weather, resource, exploration)
 *   Channel 15   → meta events (turn end, state query, reset)
 *   NoteOn       → initiate an action in the channel's system
 *   NoteOff      → resolve / counter an action
 *   ControlChange→ adjust a parameter of the channel's system
 *   Meta         → system/meta events on channel 15
 *
 *   pitch        → player / source id (0-127)
 *   velocity     → intensity (0-127)
 *   errorMask    → condition flags (friction, weather warnings, etc.)
 *   tick         → timestamp
 *
 * The dice change the board (positions evolve), not the winner. Strategy wins.
 * Output is always { system, result, narrative } so data and story stay coupled.
 */

'use strict';

import {
  decodeEvent,
  decodeStream,
  encodeEvent,
  encodeStream,
  EventType,
  Friction,
} from '../src/swmidi.js';
import { PlatonicRNG, VERTEX_COUNTS } from './platonic-rng.js';

// ── Solid → System Mapping ────────────────────────────────────────────

export const SYSTEM_CHANNELS = {
  0: 'combat',
  1: 'social',
  2: 'weather',
  3: 'resource',
  4: 'exploration',
  15: 'meta',
};

export const CHANNEL_BY_SYSTEM = Object.fromEntries(
  Object.entries(SYSTEM_CHANNELS).map(([ch, sys]) => [sys, Number(ch)])
);

export const SOLID_MAP = {
  combat: 'tetrahedron',
  social: 'icosahedron',
  weather: 'dodecahedron',
  resource: 'cube',
  exploration: 'octahedron',
};

export const SOLID_INFO = {
  combat: { solid: 'tetrahedron', vertices: 4, desc: 'fast, readable, rapid feedback' },
  social: { solid: 'icosahedron', vertices: 12, desc: 'pulse grid, rhythmic, conversational' },
  weather: { solid: 'dodecahedron', vertices: 20, desc: 'complex, slow, emergent patterns' },
  resource: { solid: 'cube', vertices: 8, desc: 'steady, reliable, plannable' },
  exploration: { solid: 'octahedron', vertices: 6, desc: 'cardinal, spatial, directional' },
};

// ── Domain Tables ─────────────────────────────────────────────────────

export const COMBAT_MOVES = ['strike', 'parry', 'feint', 'riposte'];

// Tetrahedron dominance: each vertex beats the next two in the cycle.
// This is a 4-way rock-paper-scissors-lizard relationship.
const COMBAT_BEATS = {
  0: [1, 2], // strike beats parry, feint
  1: [2, 3], // parry beats feint, riposte
  2: [3, 0], // feint beats riposte, strike
  3: [0, 1], // riposte beats strike, parry
};

export const SOCIAL_ACTIONS = [
  'greet', 'compliment', 'listen', 'observe',      // 1-4  (quarter-note pulses)
  'share', 'negotiate', 'challenge',               // 5-7  (dotted-quarter feel)
  'reveal', 'confide',                             // 8-9
  'toast', 'reconcile', 'depart',                  // 10-12
];

export const WEATHER_STATES = [
  'clear', 'cloudy', 'overcast', 'drizzle',
  'rain', 'heavy rain', 'thunderstorm', 'fog',
  'dense fog', 'frost', 'snow', 'blizzard',
  'heat wave', 'drought', 'windy', 'gale',
  'haboob', 'aurora', 'eclipse', 'anomaly',
];

export const RESOURCE_TYPES = ['wood', 'stone', 'food', 'gold', 'iron', 'herbs', 'water', 'influence'];

export const DIRECTIONS = ['north', 'south', 'east', 'west', 'ascend', 'descend'];

const DISCOVERIES = [
  'a hidden grove',
  'an abandoned outpost',
  'a strange crystal formation',
  'ancient ruins',
  'a natural spring',
  'a forgotten cache',
  'a breathtaking vista',
  'a mysterious signal',
];

export const META_COMMANDS = {
  TURN_END: 0,
  STATE_QUERY: 1,
  RESET: 2,
};

// ── Engine ────────────────────────────────────────────────────────────

export class PlatonicEngine {
  constructor(seed = 'platonic-engine-default') {
    this.masterSeed = seed;
    this.turn = 0;

    // One RNG per system, each shaped by its solid. Different backends are
    // chosen so the orbits have distinct textures even with the same seed.
    this.rngs = {
      combat: new PlatonicRNG(`${seed}-combat`, 'tetrahedron', 'mulberry32'),
      social: new PlatonicRNG(`${seed}-social`, 'icosahedron', 'mulberry32'),
      weather: new PlatonicRNG(`${seed}-weather`, 'dodecahedron', 'splitMix32'),
      resource: new PlatonicRNG(`${seed}-resource`, 'cube', 'mulberry32'),
      exploration: new PlatonicRNG(`${seed}-exploration`, 'octahedron', 'xorshift32'),
    };

    // Board positions — these EVOLVE. Like Catan: the roll changes what's
    // available, not who wins. Players must read the new state and adapt.
    this.positions = {
      combat: this._initPositions('combat', 4),
      social: this._initPositions('social', 12),
      weather: this._initPositions('weather', 20, { oneHot: true }),
      resource: this._initPositions('resource', 8),
      exploration: this._initPositions('exploration', 6),
    };

    // Explicit orbit tracking per system.
    this.orbits = {
      combat: 0,
      social: 0,
      weather: 0,
      resource: 0,
      exploration: 0,
    };

    this.eventLog = [];
    this.players = new Map();
  }

  _initPositions(system, count, options = {}) {
    const positions = [];
    for (let i = 0; i < count; i++) {
      positions.push({
        index: i,
        value: options.oneHot ? (i === 0 ? 1 : 0) : Math.floor(this.rngs[system].range(1, 6)),
        owner: null,
        history: [],
      });
    }
    return positions;
  }

  // ── Players ───────────────────────────────────────────────────────────

  addPlayer(id, name) {
    if (this.players.has(id)) {
      throw new Error(`Player ${id} already exists`);
    }
    const player = {
      id,
      name,
      resources: { wood: 0, stone: 0, food: 0, gold: 0, influence: 0 },
      position: { x: 0, y: 0 },
      social: { reputation: 50, alliances: [] },
      combat: { health: 100, attack: 10, defense: 5 },
      explored: new Set(),
      score: 0,
    };
    this.players.set(id, player);
    return player;
  }

  getPlayer(id) {
    return this.players.get(id) || null;
  }

  // ── SWMIDI Input ──────────────────────────────────────────────────────

  /**
   * Process a single SWMIDI event.
   * Accepts a Uint8Array(8), a decoded event object, or a plain 8-element array.
   * Returns { system, result, narrative }.
   */
  processEvent(input) {
    let event;
    if (input instanceof Uint8Array || Array.isArray(input)) {
      event = decodeEvent(input);
    } else if (input && typeof input === 'object' && 'eventType' in input) {
      event = input;
    } else {
      throw new Error('processEvent expects an 8-byte SWMIDI event or decoded event object');
    }
    return this._processDecoded(event);
  }

  /**
   * Process a stream of SWMIDI events (Uint8Array whose length is a multiple of 8).
   * Returns an array of { system, result, narrative } in tick order.
   */
  processStream(input) {
    const events = decodeStream(input);
    events.sort((a, b) => a.tick - b.tick);
    return events.map((ev) => this._processDecoded(ev));
  }

  _processDecoded(event) {
    const { eventType, channel, pitch, velocity, errorMask, tick } = event;
    const system = SYSTEM_CHANNELS[channel];

    if (!system) {
      return {
        system: 'unknown',
        result: { event },
        narrative: `A signal arrives on channel ${channel}, but no system listens there.`,
      };
    }

    if (system === 'meta') {
      return this._processMeta(eventType, pitch, velocity, errorMask, tick);
    }

    const playerId = pitch;
    const intensity = velocity;
    const conditions = errorMask;

    let result;
    switch (eventType) {
      case EventType.NoteOn:
        result = this._rollAction(system, playerId, intensity, conditions, tick);
        break;
      case EventType.NoteOff:
        result = this._resolveAction(system, playerId, intensity, conditions, tick);
        break;
      case EventType.ControlChange:
        result = this._adjustSystem(system, playerId, intensity, conditions, tick);
        break;
      case EventType.ProgramChange:
        result = this._changeStance(system, playerId, intensity, conditions, tick);
        break;
      case EventType.Meta:
        result = this._processMetaOnSystem(system, playerId, intensity, conditions, tick);
        break;
      default:
        return {
          system: 'unknown',
          result: { event },
          narrative: `Unknown event type ${eventType} on channel ${channel}.`,
        };
    }

    const entry = {
      turn: this.turn,
      system,
      playerId,
      eventType,
      intensity,
      conditions,
      tick,
      result,
    };
    this.eventLog.push(entry);

    return {
      system,
      result,
      narrative: this._generateNarrative(system, result, playerId),
    };
  }

  _advanceOrbit(system) {
    const r = this.rngs[system];
    r.next();
    this.orbits[system] = r.orbit;
    return this.orbits[system];
  }

  // ── Combat (Tetrahedron, 4-fold) ─────────────────────────────────────

  _rollCombat(playerId, intensity, conditions, tick) {
    const r = this.rngs.combat;
    const player = this.players.get(playerId);
    const orbit = this._advanceOrbit('combat');

    const playerChoice = r.int(0, 3);
    const opponentChoice = r.int(0, 3);

    let outcome;
    if (playerChoice === opponentChoice) {
      outcome = 'clash';
    } else if (COMBAT_BEATS[playerChoice].includes(opponentChoice)) {
      outcome = 'win';
    } else {
      outcome = 'lose';
    }

    // Friction from SWMIDI can turn a win into a clash.
    if (outcome === 'win' && (conditions & (Friction.Timeout | Friction.NetworkError))) {
      outcome = 'clash';
    }

    this.positions.combat[playerChoice].value += 1;
    this.positions.combat[playerChoice].history.push({ turn: this.turn, tick, outcome });

    const baseDamage = outcome === 'win' ? r.int(5, 15) : outcome === 'lose' ? r.int(2, 8) : r.int(1, 4);
    const damage = baseDamage + Math.floor(intensity / 16);

    if (player) {
      if (outcome === 'lose') {
        player.combat.health = Math.max(0, player.combat.health - damage);
      } else if (outcome === 'win') {
        player.score += 5;
      }
    }

    return {
      orbit,
      playerMove: COMBAT_MOVES[playerChoice],
      opponentMove: COMBAT_MOVES[opponentChoice],
      outcome,
      damage,
      playerHealth: player ? player.combat.health : null,
    };
  }

  _resolveCombat(playerId, intensity, conditions, tick) {
    const r = this.rngs.combat;
    const player = this.players.get(playerId);
    const orbit = this._advanceOrbit('combat');

    const recovery = r.int(2, 6) + Math.floor(intensity / 32);
    if (player) {
      player.combat.health = Math.min(100, player.combat.health + recovery);
    }

    return {
      orbit,
      action: 'recover',
      recovery,
      playerHealth: player ? player.combat.health : null,
    };
  }

  // ── Social (Icosahedron, 12-fold) ────────────────────────────────────

  _rollSocial(playerId, intensity, conditions, tick) {
    const r = this.rngs.social;
    const player = this.players.get(playerId);
    const orbit = this._advanceOrbit('social');

    const actionIdx = r.int(0, 11);
    const targetPulse = r.int(0, 11);

    // Higher intensity → higher success chance; friction → lower.
    let successChance = 0.4 + intensity * 0.004;
    if (conditions & Friction.Ambiguity) successChance -= 0.15;
    if (conditions & Friction.Conflict) successChance -= 0.2;
    const success = r.bool(Math.max(0.05, Math.min(0.95, successChance)));

    const pulsePosition = this.positions.social[actionIdx];
    pulsePosition.value += success ? 1 : -1;
    pulsePosition.value = Math.max(0, Math.min(20, pulsePosition.value));
    pulsePosition.history.push({ turn: this.turn, tick, action: SOCIAL_ACTIONS[actionIdx], success });

    const reputationChange = success ? r.int(1, 5) : -r.int(1, 3);
    if (player) {
      player.social.reputation = Math.max(0, Math.min(100, player.social.reputation + reputationChange));
    }

    return {
      orbit,
      action: SOCIAL_ACTIONS[actionIdx],
      targetPulse: targetPulse + 1,
      success,
      reputationChange,
      playerReputation: player ? player.social.reputation : null,
    };
  }

  _resolveSocial(playerId, intensity, conditions, tick) {
    const r = this.rngs.social;
    const orbit = this._advanceOrbit('social');
    const pulse = r.int(0, 11);
    this.positions.social[pulse].value = Math.max(0, this.positions.social[pulse].value - 1);

    return {
      orbit,
      action: 'cool tensions',
      pulse: pulse + 1,
      newValue: this.positions.social[pulse].value,
    };
  }

  // ── Weather (Dodecahedron, 20-fold) ──────────────────────────────────

  _rollWeather(_playerId, intensity, conditions, tick) {
    const r = this.rngs.weather;
    const orbit = this._advanceOrbit('weather');

    const currentIdx = this.positions.weather.findIndex((p) => p.value > 0);
    const baseIdx = currentIdx >= 0 ? currentIdx : 0;

    // Dodecahedron: next state is usually near the current state (slow orbit).
    const range = intensity > 64 ? 4 : 2;
    let shift = r.int(-range, range);
    if (conditions & Friction.NetworkError) shift += r.int(2, 5); // disturbance
    const newIdx = ((baseIdx + shift) + 20) % 20;

    this.positions.weather[baseIdx].value = 0;
    this.positions.weather[newIdx].value = 1;
    this.positions.weather[newIdx].history.push({ turn: this.turn, tick, weather: WEATHER_STATES[newIdx] });

    const severity = r.range(0.3, 1.0) * (1 + intensity * 0.01);
    const forecastIdx = ((newIdx + r.int(-2, 2)) + 20) % 20;

    return {
      orbit,
      previous: WEATHER_STATES[baseIdx],
      current: WEATHER_STATES[newIdx],
      severity: Math.round(severity * 100) / 100,
      forecast: WEATHER_STATES[forecastIdx],
    };
  }

  _resolveWeather(_playerId, intensity, conditions, tick) {
    const r = this.rngs.weather;
    const orbit = this._advanceOrbit('weather');

    // A NoteOff on the weather channel means "the weather holds steady."
    const currentIdx = this.positions.weather.findIndex((p) => p.value > 0);
    return {
      orbit,
      action: 'hold steady',
      current: currentIdx >= 0 ? WEATHER_STATES[currentIdx] : 'unknown',
    };
  }

  // ── Resources (Cube, 8-fold) ─────────────────────────────────────────

  _rollResource(playerId, intensity, conditions, tick) {
    const r = this.rngs.resource;
    const player = this.players.get(playerId);
    const orbit = this._advanceOrbit('resource');

    // Cube: steady production. 2d4 produces a triangular distribution (like
    // Catan's 2d6 but smaller and more plannable).
    const roll1 = r.int(1, 4);
    const roll2 = r.int(1, 4);
    const total = roll1 + roll2; // range 2-8, mode 5

    const resourceIdx = (total - 2) % 8;
    const resourceType = RESOURCE_TYPES[resourceIdx];
    const amount = r.int(1, 3) + Math.floor(intensity / 32);

    this.positions.resource[resourceIdx].value += amount;
    this.positions.resource[resourceIdx].history.push({ turn: this.turn, tick, resource: resourceType, amount });

    if (player) {
      const key =
        resourceType === 'iron' ? 'stone'
        : resourceType === 'herbs' || resourceType === 'water' ? 'food'
        : resourceType;
      if (key in player.resources) {
        player.resources[key] += amount;
      }
    }

    return {
      orbit,
      dice: [roll1, roll2],
      total,
      resource: resourceType,
      amount,
      playerResources: player ? { ...player.resources } : null,
    };
  }

  _resolveResource(playerId, intensity, conditions, tick) {
    const r = this.rngs.resource;
    const orbit = this._advanceOrbit('resource');

    // NoteOff on resource channel = spend/consume a little of every node.
    const node = r.int(0, 7);
    const amount = Math.max(0, r.int(1, 2) - Math.floor(intensity / 64));
    this.positions.resource[node].value = Math.max(0, this.positions.resource[node].value - amount);

    return {
      orbit,
      action: 'consume',
      node,
      resource: RESOURCE_TYPES[node],
      amount,
      newValue: this.positions.resource[node].value,
    };
  }

  // ── Exploration (Octahedron, 6-fold) ─────────────────────────────────

  _rollExploration(playerId, intensity, conditions, tick) {
    const r = this.rngs.exploration;
    const player = this.players.get(playerId);
    const orbit = this._advanceOrbit('exploration');

    const directionIdx = r.int(0, 5);
    const distance = r.int(1, 3) + Math.floor(intensity / 32);

    const discoveryChance = 0.2 + intensity * 0.004;
    const discovered = r.bool(discoveryChance);
    const discovery = discovered ? r.pick(DISCOVERIES) : 'nothing of note';

    const pos = this.positions.exploration[directionIdx];
    pos.value += distance;
    pos.history.push({ turn: this.turn, tick, direction: DIRECTIONS[directionIdx], discovery });

    if (player) {
      const moves = {
        north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0],
        ascend: [0, 0.5], descend: [0, -0.5],
      };
      const [dx, dy] = moves[DIRECTIONS[directionIdx]];
      player.position.x += dx * distance;
      player.position.y += dy * distance;

      if (discovered && discovery !== 'nothing of note') {
        player.explored.add(`${Math.round(player.position.x)},${Math.round(player.position.y)}`);
        player.score += 10;
      }
    }

    return {
      orbit,
      direction: DIRECTIONS[directionIdx],
      distance,
      discovered,
      discovery,
      playerPosition: player ? { x: Math.round(player.position.x * 100) / 100, y: Math.round(player.position.y * 100) / 100 } : null,
    };
  }

  _resolveExploration(playerId, intensity, conditions, tick) {
    const r = this.rngs.exploration;
    const orbit = this._advanceOrbit('exploration');

    // NoteOff = rest / make camp at current position.
    const player = this.players.get(playerId);
    return {
      orbit,
      action: 'make camp',
      playerPosition: player ? { x: Math.round(player.position.x * 100) / 100, y: Math.round(player.position.y * 100) / 100 } : null,
    };
  }

  // ── System Dispatch ───────────────────────────────────────────────────

  _rollAction(system, playerId, intensity, conditions, tick) {
    switch (system) {
      case 'combat': return this._rollCombat(playerId, intensity, conditions, tick);
      case 'social': return this._rollSocial(playerId, intensity, conditions, tick);
      case 'weather': return this._rollWeather(playerId, intensity, conditions, tick);
      case 'resource': return this._rollResource(playerId, intensity, conditions, tick);
      case 'exploration': return this._rollExploration(playerId, intensity, conditions, tick);
      default: return { action: 'none' };
    }
  }

  _resolveAction(system, playerId, intensity, conditions, tick) {
    switch (system) {
      case 'combat': return this._resolveCombat(playerId, intensity, conditions, tick);
      case 'social': return this._resolveSocial(playerId, intensity, conditions, tick);
      case 'weather': return this._resolveWeather(playerId, intensity, conditions, tick);
      case 'resource': return this._resolveResource(playerId, intensity, conditions, tick);
      case 'exploration': return this._resolveExploration(playerId, intensity, conditions, tick);
      default: return { action: 'none' };
    }
  }

  _adjustSystem(system, playerId, intensity, conditions, tick) {
    // ControlChange modulates a position directly.
    const node = playerId % VERTEX_COUNTS[SOLID_MAP[system]];
    const delta = Math.floor(intensity / 16) - 4; // range -4 .. +3
    const pos = this.positions[system][node];
    pos.value = Math.max(0, pos.value + delta);
    pos.history.push({ turn: this.turn, tick, adjustment: delta, newValue: pos.value });

    return {
      action: 'adjust',
      node,
      delta,
      newValue: pos.value,
    };
  }

  _changeStance(system, playerId, intensity, conditions, tick) {
    return {
      action: 'change stance',
      system,
      stance: intensity % 4,
    };
  }

  _processMetaOnSystem(system, playerId, intensity, conditions, tick) {
    // Meta on a non-meta channel resets that system's positions.
    this.positions[system] = this._initPositions(system, VERTEX_COUNTS[SOLID_MAP[system]]);
    return {
      action: 'reset system',
      system,
    };
  }

  // ── Meta Events ───────────────────────────────────────────────────────

  _processMeta(eventType, pitch, velocity, errorMask, tick) {
    if (eventType === EventType.NoteOn || eventType === EventType.Meta) {
      switch (pitch) {
        case META_COMMANDS.TURN_END:
          return this._endTurn(tick);
        case META_COMMANDS.STATE_QUERY:
          return this._queryState();
        case META_COMMANDS.RESET:
          return this._resetEngine();
        default:
          return {
            system: 'meta',
            result: { command: pitch },
            narrative: `Meta command ${pitch} echoes in the empty channel.`,
          };
      }
    }
    return {
      system: 'meta',
      result: { eventType, pitch },
      narrative: 'The conductor taps the stand, but nothing changes.',
    };
  }

  _endTurn(tick) {
    this.turn++;

    // Weather evolves every turn, slowly.
    const r = this.rngs.weather;
    const currentIdx = this.positions.weather.findIndex((p) => p.value > 0);
    if (currentIdx >= 0) {
      const shift = r.int(-1, 1);
      const newIdx = ((currentIdx + shift) + 20) % 20;
      this.positions.weather[currentIdx].value = 0;
      this.positions.weather[newIdx].value = 1;
      this.positions.weather[newIdx].history.push({ turn: this.turn, tick, weather: WEATHER_STATES[newIdx] });
    }

    // Social pulses decay slightly.
    for (const pos of this.positions.social) {
      pos.value = Math.max(0, pos.value - 1);
    }

    return {
      system: 'meta',
      result: { turn: this.turn, message: 'Turn ended. Board state evolved.' },
      narrative: this._generateTurnNarrative(),
    };
  }

  _queryState() {
    const state = this.getState();
    return {
      system: 'meta',
      result: state,
      narrative: this._generateStateNarrative(state),
    };
  }

  _resetEngine() {
    const seed = this.masterSeed;
    this.turn = 0;
    this.rngs = {
      combat: new PlatonicRNG(`${seed}-combat`, 'tetrahedron', 'mulberry32'),
      social: new PlatonicRNG(`${seed}-social`, 'icosahedron', 'mulberry32'),
      weather: new PlatonicRNG(`${seed}-weather`, 'dodecahedron', 'splitMix32'),
      resource: new PlatonicRNG(`${seed}-resource`, 'cube', 'mulberry32'),
      exploration: new PlatonicRNG(`${seed}-exploration`, 'octahedron', 'xorshift32'),
    };
    this.positions = {
      combat: this._initPositions('combat', 4),
      social: this._initPositions('social', 12),
      weather: this._initPositions('weather', 20, { oneHot: true }),
      resource: this._initPositions('resource', 8),
      exploration: this._initPositions('exploration', 6),
    };
    this.orbits = { combat: 0, social: 0, weather: 0, resource: 0, exploration: 0 };
    this.eventLog = [];
    this.players = new Map();

    return {
      system: 'meta',
      result: { reset: true },
      narrative: 'The board is wiped clean. A new game begins from the same seed.',
    };
  }

  // ── State Access ──────────────────────────────────────────────────────

  getState() {
    return {
      seed: this.masterSeed,
      turn: this.turn,
      orbits: { ...this.orbits },
      positions: this.positions,
      players: Array.from(this.players.entries()).map(([id, p]) => ({
        id,
        name: p.name,
        score: p.score,
        health: p.combat.health,
        reputation: p.social.reputation,
        resources: { ...p.resources },
        position: { ...p.position },
        exploredCount: p.explored.size,
      })),
      eventCount: this.eventLog.length,
    };
  }

  serialize() {
    return {
      seed: this.masterSeed,
      turn: this.turn,
      orbits: { ...this.orbits },
      positions: this.positions,
      players: Array.from(this.players.entries()).map(([id, p]) => ({
        ...p,
        explored: Array.from(p.explored),
      })),
      eventLog: this.eventLog.slice(-200),
    };
  }

  // ── Narrative Generation ──────────────────────────────────────────────

  _generateNarrative(system, result, playerId) {
    const player = this.players.get(playerId);
    const name = player ? player.name : `Source ${playerId}`;

    const templates = {
      combat: () => {
        if (result.action === 'recover') {
          return `${name} recovers ${result.recovery} health in a moment of calm.`;
        }
        const { playerMove, opponentMove, outcome, damage } = result;
        const outcomes = {
          win: `${name}'s ${playerMove} overwhelms the opponent's ${opponentMove}, dealing ${damage} damage.`,
          lose: `${name}'s ${playerMove} is countered by the opponent's ${opponentMove}; ${damage} damage slips through.`,
          clash: `${name} and the opponent both commit to ${playerMove}. The clash scrapes both sides for ${damage}.`,
        };
        return outcomes[outcome];
      },
      social: () => {
        if (result.action === 'cool tensions') {
          return `${name} lets pulse ${result.pulse} settle; its energy drops to ${result.newValue}.`;
        }
        const { action, success, reputationChange } = result;
        return success
          ? `${name} tries to ${action} and the room responds. Reputation ${reputationChange >= 0 ? '+' : ''}${reputationChange}.`
          : `${name} tries to ${action} but the rhythm breaks. Reputation ${reputationChange}.`;
      },
      weather: () => {
        if (result.action === 'hold steady') {
          return `The sky holds at ${result.current}; no front moves this beat.`;
        }
        const { previous, current, severity, forecast } = result;
        return `The weather turns from ${previous} to ${current} (severity ${severity}). The forecast whispers ${forecast}.`;
      },
      resource: () => {
        if (result.action === 'consume') {
          return `${name} spends ${result.amount} ${result.resource} from node ${result.node}; ${result.newValue} remain.`;
        }
        if (result.action === 'adjust') {
          const sign = result.delta >= 0 ? '+' : '';
          return `${name} adjusts node ${result.node} by ${sign}${result.delta}; it now holds ${result.newValue}.`;
        }
        const { dice, total, resource, amount } = result;
        return `${name} rolls the cube [${dice.join(', ')}] = ${total} and gathers ${amount} ${resource}.`;
      },
      exploration: () => {
        if (result.action === 'make camp') {
          return `${name} makes camp at (${result.playerPosition?.x}, ${result.playerPosition?.y}).`;
        }
        const { direction, distance, discovered, discovery } = result;
        return discovered
          ? `${name} travels ${distance} leagues ${direction} and finds ${discovery}.`
          : `${name} travels ${distance} leagues ${direction}. The land offers nothing remarkable.`;
      },
      meta: () => result.message || JSON.stringify(result),
      unknown: () => result.narrative || 'Something unnameable shifts.',
    };

    return (templates[system] || templates.unknown)();
  }

  _generateTurnNarrative() {
    const weatherIdx = this.positions.weather.findIndex((p) => p.value > 0);
    const weather = weatherIdx >= 0 ? WEATHER_STATES[weatherIdx] : 'unknown';
    const lastTurnEvents = this.eventLog.filter((e) => e.turn === this.turn - 1).length;
    return `Turn ${this.turn} begins under ${weather} skies. ${lastTurnEvents} events shaped the last turn.`;
  }

  _generateStateNarrative(state) {
    const lines = [`=== Game State: Turn ${state.turn} ===`];
    lines.push(`Events logged: ${state.eventCount}`);
    for (const p of state.players) {
      lines.push(`  ${p.name}: Score ${p.score} | HP ${p.health} | Rep ${p.reputation} | Explored ${p.exploredCount}`);
    }
    const weatherIdx = this.positions.weather.findIndex((x) => x.value > 0);
    lines.push(`Weather: ${weatherIdx >= 0 ? WEATHER_STATES[weatherIdx] : 'unknown'}`);
    return lines.join('\n');
  }

  // ── SWMIDI Encoding Helpers ───────────────────────────────────────────

  /**
   * Encode a game action as SWMIDI.
   *
   * @param {string} system    'combat' | 'social' | 'weather' | 'resource' | 'exploration'
   * @param {number} playerId  0-127 (maps to SWMIDI pitch)
   * @param {number} intensity 0-127 (maps to SWMIDI velocity)
   * @param {number} tick      Optional timestamp
   * @param {number} conditions Optional friction/condition flags (errorMask)
   */
  static encodeGameEvent(system, playerId, intensity, tick = 0, conditions = 0) {
    const channel = CHANNEL_BY_SYSTEM[system];
    if (channel === undefined) {
      throw new Error(`Unknown system: ${system}`);
    }
    return encodeEvent({
      eventType: EventType.NoteOn,
      channel,
      pitch: playerId & 0x7F,
      velocity: Math.max(0, Math.min(127, intensity)),
      errorMask: conditions & 0xFF,
      tick: tick >>> 0,
    });
  }

  /**
   * Encode a meta event.
   *
   * @param {number|string} command 'turnEnd' | 'stateQuery' | 'reset' or META_COMMANDS value
   */
  static encodeMetaEvent(command, tick = 0) {
    let pitch;
    if (typeof command === 'string') {
      const map = { turnEnd: 0, stateQuery: 1, reset: 2 };
      pitch = map[command];
      if (pitch === undefined) throw new Error(`Unknown meta command: ${command}`);
    } else {
      pitch = command & 0x7F;
    }
    return encodeEvent({
      eventType: EventType.Meta,
      channel: 15,
      pitch,
      velocity: 0,
      errorMask: 0,
      tick: tick >>> 0,
    });
  }

  /**
   * Encode a raw SWMIDI event. Convenience wrapper around ../src/swmidi.js.
   */
  static encodeSWMIDI(event) {
    return encodeEvent(event);
  }

  /**
   * Encode a stream of game events into a single Uint8Array.
   */
  static encodeStream(events) {
    return encodeStream(events);
  }
}
