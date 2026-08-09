/**
 * PLATONIC RANDOMNESS GAME ENGINE
 * ==================================
 * 
 * A game system where the CHOICE of Platonic solid IS the game design decision.
 * 
 * Combat     → tetrahedron  (4-fold, fast, readable)
 * Social     → icosahedron  (12-fold, matches pulse grid)
 * Weather    → dodecahedron (20-fold, complex, slow)
 * Resources  → cube         (8-fold, steady)
 * Exploration→ octahedron   (6-fold, cardinal directions)
 * 
 * Accepts events as SWMIDI (8-byte format).
 * Uses Platonic solids to shape the randomness orbit.
 * Tracks positions that evolve (Catan-style: dice change the board, not the winner).
 * Outputs game state as both data AND narrative.
 * 
 * Provenance: Sax (KimiCode K3) — Jazz Session, Cycle 2
 */

'use strict';

const { PlatonicRNG, rng, SOLID_VERTICES, VERTEX_COUNTS } = require('./platonic-imports');

// ── SWMIDI Event Format (8 bytes) ─────────────────────────────────────
// Byte 0: status (0x80=noteOff, 0x90=noteOn, 0xB0=controlChange, 0xC0=gameEvent)
// Byte 1: channel (0-15)
// Byte 2: data1 (note/controller/event-type)
// Byte 3: data2 (velocity/value/intensity)
// Byte 4: timestamp_hi (high byte of millisecond timestamp)
// Byte 5: timestamp_lo (low byte)
// Byte 6: source_id (which agent/player sent this)
// Byte 7: checksum (XOR of bytes 0-6)

const SWMIDI_STATUS = {
  NOTE_OFF: 0x80,
  NOTE_ON: 0x90,
  CONTROL_CHANGE: 0xB0,
  GAME_EVENT: 0xC0,
};

const SWMIDI_GAME_EVENTS = {
  COMBAT: 0x01,
  SOCIAL: 0x02,
  WEATHER: 0x03,
  RESOURCE: 0x04,
  EXPLORATION: 0x05,
  TURN_END: 0x10,
  STATE_QUERY: 0x20,
};

// ── Solid → System Mapping ────────────────────────────────────────────
const SOLID_MAP = {
  combat: 'tetrahedron',
  social: 'icosahedron',
  weather: 'dodecahedron',
  resource: 'cube',
  exploration: 'octahedron',
};

const SOLID_INFO = {
  combat: { solid: 'tetrahedron', vertices: 4, desc: 'fast, readable, rapid feedback' },
  social: { solid: 'icosahedron', vertices: 12, desc: 'pulse grid, rhythmic, conversational' },
  weather: { solid: 'dodecahedron', vertices: 20, desc: 'complex, slow, emergent patterns' },
  resource: { solid: 'cube', vertices: 8, desc: 'steady, reliable, plannable' },
  exploration: { solid: 'octahedron', vertices: 6, desc: 'cardinal, spatial, directional' },
};

// ── Game State ────────────────────────────────────────────────────────

/**
 * The Platonic Game Engine.
 * 
 * Each system (combat, social, weather, resource, exploration) has its own
 * PlatonicRNG shaped by its corresponding solid. The dice change the board
 * state — positions evolve, odds shift — but the dice don't determine the
 * winner. Strategy determines the winner. The dice determine *what the
 * strategy must adapt to*.
 */
class PlatonicEngine {
  constructor(seed = 'platonic-engine-default') {
    this.masterSeed = seed;
    this.turn = 0;
    
    // One RNG per system, each shaped by its solid
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
      weather: this._initPositions('weather', 20),
      resource: this._initPositions('resource', 8),
      exploration: this._initPositions('exploration', 6),
    };
    
    // Event log for narrative generation
    this.eventLog = [];
    
    // Player registry
    this.players = new Map();
  }
  
  _initPositions(system, vertexCount) {
    const positions = [];
    for (let i = 0; i < vertexCount; i++) {
      positions.push({
        index: i,
        value: Math.floor(this.rngs[system].range(1, 6)),
        owner: null,
        history: [],
      });
    }
    return positions;
  }
  
  // ── Player Management ──────────────────────────────────────────────
  
  addPlayer(id, name) {
    this.players.set(id, {
      id,
      name,
      resources: { wood: 0, stone: 0, food: 0, gold: 0, influence: 0 },
      position: { x: 0, y: 0 },
      social: { reputation: 50, alliances: [] },
      combat: { health: 100, attack: 10, defense: 5 },
      explored: new Set(),
      score: 0,
    });
    return this.players.get(id);
  }
  
  // ── SWMIDI Event Processing ────────────────────────────────────────
  
  /**
   * Process an 8-byte SWMIDI event.
   * Returns { system, result, narrative }.
   */
  processSWMIDI(bytes) {
    if (!Array.isArray(bytes) || bytes.length !== 8) {
      throw new Error(`SWMIDI events must be exactly 8 bytes, got ${bytes?.length}`);
    }
    
    // Verify checksum
    let checksum = 0;
    for (let i = 0; i < 7; i++) checksum ^= bytes[i];
    if (checksum !== bytes[7]) {
      throw new Error(`SWMIDI checksum mismatch: expected ${bytes[7]}, got ${checksum}`);
    }
    
    const [status, channel, data1, data2, tsHi, tsLo, sourceId] = bytes;
    const timestamp = (tsHi << 8) | tsLo;
    
    if (status === SWMIDI_STATUS.GAME_EVENT) {
      return this._processGameEvent(data1, data2, sourceId, timestamp, channel);
    } else if (status === SWMIDI_STATUS.NOTE_ON) {
      // Musical notes feed the social system — notes are conversation pulses
      return this._processSocialPulse(data1, data2, sourceId, timestamp);
    } else if (status === SWMIDI_STATUS.CONTROL_CHANGE) {
      // CC messages feed resource adjustments
      return this._processResourceCC(data1, data2, sourceId, timestamp);
    } else if (status === SWMIDI_STATUS.NOTE_OFF) {
      return { system: 'idle', result: { status: 'note_off', note: data1 }, narrative: 'A note fades.' };
    }
    
    return { system: 'unknown', result: { status, data1, data2 }, narrative: 'Unknown event.' };
  }
  
  _processGameEvent(eventType, intensity, sourceId, timestamp, channel) {
    let result;
    let system;
    
    switch (eventType) {
      case SWMIDI_GAME_EVENTS.COMBAT:
        system = 'combat';
        result = this._rollCombat(sourceId, intensity);
        break;
      case SWMIDI_GAME_EVENTS.SOCIAL:
        system = 'social';
        result = this._rollSocial(sourceId, intensity);
        break;
      case SWMIDI_GAME_EVENTS.WEATHER:
        system = 'weather';
        result = this._rollWeather(sourceId, intensity);
        break;
      case SWMIDI_GAME_EVENTS.RESOURCE:
        system = 'resource';
        result = this._rollResource(sourceId, intensity);
        break;
      case SWMIDI_GAME_EVENTS.EXPLORATION:
        system = 'exploration';
        result = this._rollExploration(sourceId, intensity);
        break;
      case SWMIDI_GAME_EVENTS.TURN_END:
        return this._endTurn();
      case SWMIDI_GAME_EVENTS.STATE_QUERY:
        return this._queryState();
      default:
        return { system: 'unknown', result: { eventType }, narrative: 'Unknown game event.' };
    }
    
    const entry = {
      turn: this.turn,
      system,
      sourceId,
      intensity,
      timestamp,
      result,
    };
    this.eventLog.push(entry);
    
    return {
      system,
      result,
      narrative: this._generateNarrative(system, result, sourceId),
    };
  }
  
  // ── Combat (Tetrahedron, 4-fold) ───────────────────────────────────
  // Fast, readable. 4 positions cycling quickly. Skilled players read the cycle.
  
  _rollCombat(sourceId, intensity) {
    const r = this.rngs.combat;
    const player = this.players.get(sourceId);
    
    // 4 positions — strike, parry, feint, riposte
    const positions = ['strike', 'parry', 'feint', 'riposte'];
    const playerChoice = r.int(0, 3);
    const opponentChoice = r.int(0, 3);
    
    // Tetrahedron: each vertex beats two others (rock-paper-scissors-lizard style)
    const beats = { 0: [1, 2], 1: [2, 3], 2: [3, 0], 3: [0, 1] };
    
    let outcome;
    if (playerChoice === opponentChoice) {
      outcome = 'clash';
    } else if (beats[playerChoice].includes(opponentChoice)) {
      outcome = 'win';
    } else {
      outcome = 'lose';
    }
    
    // Update combat positions
    this.positions.combat[playerChoice].value += 1;
    this.positions.combat[playerChoice].history.push({ turn: this.turn, outcome });
    
    const damage = outcome === 'win' ? r.int(5, 15) + intensity
                 : outcome === 'lose' ? r.int(2, 8)
                 : r.int(1, 4);
    
    if (player && outcome === 'lose') {
      player.combat.health = Math.max(0, player.combat.health - damage);
    }
    
    return {
      playerMove: positions[playerChoice],
      opponentMove: positions[opponentChoice],
      outcome,
      damage,
      playerHealth: player?.combat.health,
    };
  }
  
  // ── Social (Icosahedron, 12-fold) ──────────────────────────────────
  // Matches the pulse grid. Social dynamics are rhythmic — they have pulse.
  
  _rollSocial(sourceId, intensity) {
    const r = this.rngs.social;
    const player = this.players.get(sourceId);
    
    // 12 positions — one for each pulse in the bar
    const socialActions = [
      'greet', 'compliment', 'listen', 'observe',       // 1-4 (ECN quarter notes)
      'share', 'negotiate', 'challenge',                // 5-7 (DMN dotted quarters)
      'reveal', 'confide',                              // 8-9
      'toast', 'reconcile', 'depart',                   // 10-12
    ];
    
    const action = r.int(0, 11);
    const target = r.int(0, 11);
    const success = r.bool(0.4 + intensity * 0.05);
    
    // 12-fold orbit: the pulse position affects the outcome
    const pulsePosition = this.positions.social[action];
    pulsePosition.value += success ? 1 : -1;
    pulsePosition.value = Math.max(0, Math.min(20, pulsePosition.value));
    pulsePosition.history.push({ turn: this.turn, action: socialActions[action], success });
    
    const reputationChange = success ? r.int(1, 5) : -r.int(1, 3);
    
    if (player) {
      player.social.reputation = Math.max(0, Math.min(100, player.social.reputation + reputationChange));
    }
    
    return {
      action: socialActions[action],
      targetPulse: target + 1,
      success,
      reputationChange,
      playerReputation: player?.social.reputation,
    };
  }
  
  // ── Weather (Dodecahedron, 20-fold) ────────────────────────────────
  // Complex, slow, emergent. 20 positions cycling through rich patterns.
  
  _rollWeather(sourceId, intensity) {
    const r = this.rngs.weather;
    
    // 20 weather states organized by vertex
    const weatherStates = [
      'clear', 'cloudy', 'overcast', 'drizzle',
      'rain', 'heavy rain', 'thunderstorm', 'fog',
      'dense fog', 'frost', 'snow', 'blizzard',
      'heat wave', 'drought', 'windy', 'gale',
      'haboob', 'aurora', 'eclipse', 'anomaly',
    ];
    
    // Weather evolves — current state influences next state
    const currentIdx = this.positions.weather.findIndex(p => p.value > 0);
    const baseIdx = currentIdx >= 0 ? currentIdx : 0;
    
    // Dodecahedron: next state is near current state (slow orbit)
    const shift = r.int(-3, 3);
    const newIdx = ((baseIdx + shift) + 20) % 20;
    
    // Update weather positions
    this.positions.weather[baseIdx].value = 0;
    this.positions.weather[newIdx].value = 1;
    this.positions.weather[newIdx].history.push({ turn: this.turn, weather: weatherStates[newIdx] });
    
    // Severity scales with intensity
    const severity = r.range(0.3, 1.0) * (1 + intensity * 0.1);
    
    return {
      previous: weatherStates[baseIdx],
      current: weatherStates[newIdx],
      severity: Math.round(severity * 100) / 100,
      forecast: weatherStates[((newIdx + r.int(-2, 2)) + 20) % 20],
    };
  }
  
  // ── Resources (Cube, 8-fold) ───────────────────────────────────────
  // Steady, reliable. 8-beat cycles. Players can plan around this.
  
  _rollResource(sourceId, intensity) {
    const r = this.rngs.resource;
    const player = this.players.get(sourceId);
    
    // 8 resource nodes
    const resourceTypes = ['wood', 'stone', 'food', 'gold', 'iron', 'herbs', 'water', 'influence'];
    
    // Cube: steady production. 2d4 produces a triangular distribution (like Catan's 2d6 but smaller)
    const roll1 = r.int(1, 4);
    const roll2 = r.int(1, 4);
    const total = roll1 + roll2; // range: 2-8, mode: 5
    
    const resourceIdx = total - 2; // map to 0-6... but we have 8 resources
    const resourceIdxActual = (total - 2) % 8;
    const resourceType = resourceTypes[resourceIdxActual];
    
    const amount = r.int(1, 3) + Math.floor(intensity / 3);
    
    // Update resource positions
    this.positions.resource[resourceIdxActual].value += amount;
    this.positions.resource[resourceIdxActual].history.push({ turn: this.turn, resource: resourceType, amount });
    
    if (player) {
      const key = resourceType === 'iron' ? 'stone' : resourceType === 'herbs' ? 'food' : resourceType === 'water' ? 'food' : resourceType;
      if (key in player.resources) {
        player.resources[key] += amount;
      }
    }
    
    return {
      dice: [roll1, roll2],
      total,
      resource: resourceType,
      amount,
      playerResources: player?.resources,
    };
  }
  
  // ── Exploration (Octahedron, 6-fold) ───────────────────────────────
  // Cardinal directions. 6 vertices: N, S, E, W, Up, Down.
  
  _rollExploration(sourceId, intensity) {
    const r = this.rngs.exploration;
    const player = this.players.get(sourceId);
    
    const directions = ['north', 'south', 'east', 'west', 'ascend', 'descend'];
    const direction = r.int(0, 5);
    const distance = r.int(1, 3) + Math.floor(intensity / 4);
    
    // Discovery chance improves with exploration investment
    const discoveryChance = 0.2 + intensity * 0.05;
    const discovered = r.bool(discoveryChance);
    
    const discoveries = [
      'a hidden grove', 'an abandoned outpost', 'a strange crystal formation',
      'ancient ruins', 'a natural spring', 'a forgotten cache',
      'a breathtaking vista', 'a mysterious signal', 'nothing of note',
    ];
    
    const discovery = discovered ? r.pick(discoveries) : 'nothing of note';
    
    // Update positions
    const pos = this.positions.exploration[direction];
    pos.value += distance;
    pos.history.push({ turn: this.turn, direction: directions[direction], discovery });
    
    // Move player
    if (player) {
      const moves = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0], ascend: [0, 0.5], descend: [0, -0.5] };
      const [dx, dy] = moves[directions[direction]];
      player.position.x += dx * distance;
      player.position.y += dy * distance;
      
      if (discovered && discovery !== 'nothing of note') {
        player.explored.add(`${Math.round(player.position.x)},${Math.round(player.position.y)}`);
        player.score += 10;
      }
    }
    
    return {
      direction: directions[direction],
      distance,
      discovered,
      discovery,
      playerPosition: player ? { x: Math.round(player.position.x * 100) / 100, y: Math.round(player.position.y * 100) / 100 } : null,
    };
  }
  
  // ── Social Pulse (from NOTE_ON events) ─────────────────────────────
  
  _processSocialPulse(note, velocity, sourceId, timestamp) {
    const r = this.rngs.social;
    const pulse = (note % 12); // map to 12-fold grid
    const energy = velocity / 127;
    
    this.positions.social[pulse].value += Math.round(energy * 3);
    this.positions.social[pulse].value = Math.min(20, this.positions.social[pulse].value);
    
    return {
      system: 'social',
      result: {
        pulse: pulse + 1,
        energy: Math.round(energy * 100) / 100,
        note,
        velocity,
      },
      narrative: `Pulse ${pulse + 1} rings at ${Math.round(energy * 100)}% energy.`,
    };
  }
  
  // ── Resource CC ────────────────────────────────────────────────────
  
  _processResourceCC(controller, value, sourceId, timestamp) {
    const r = this.rngs.resource;
    const node = controller % 8;
    const adjustment = Math.floor(value / 16); // 0-7
    
    this.positions.resource[node].value = Math.max(0, this.positions.resource[node].value + adjustment - 3);
    
    return {
      system: 'resource',
      result: {
        node,
        adjustment: adjustment - 3,
        newValue: this.positions.resource[node].value,
      },
      narrative: `Resource node ${node} adjusted by ${adjustment - 3 > 0 ? '+' : ''}${adjustment - 3}.`,
    };
  }
  
  // ── Turn Management ────────────────────────────────────────────────
  
  _endTurn() {
    this.turn++;
    
    // Evolve weather (it changes every turn regardless of events)
    const r = this.rngs.weather;
    const currentIdx = this.positions.weather.findIndex(p => p.value > 0);
    if (currentIdx >= 0) {
      const shift = r.int(-1, 1);
      const newIdx = ((currentIdx + shift) + 20) % 20;
      this.positions.weather[currentIdx].value = 0;
      this.positions.weather[newIdx].value = 1;
    }
    
    return {
      system: 'meta',
      result: { turn: this.turn, message: 'Turn ended. Board state evolved.' },
      narrative: this._generateTurnNarrative(),
    };
  }
  
  _queryState() {
    const state = {
      turn: this.turn,
      positions: this.positions,
      players: Array.from(this.players.entries()).map(([id, p]) => ({
        id,
        name: p.name,
        score: p.score,
        health: p.combat.health,
        reputation: p.social.reputation,
        resources: p.resources,
        position: p.position,
        exploredCount: p.explored.size,
      })),
      eventCount: this.eventLog.length,
    };
    
    return {
      system: 'meta',
      result: state,
      narrative: this._generateStateNarrative(state),
    };
  }
  
  // ── Narrative Generation ───────────────────────────────────────────
  
  _generateNarrative(system, result, sourceId) {
    const player = this.players.get(sourceId);
    const name = player?.name || `Player ${sourceId}`;
    
    const templates = {
      combat: () => {
        const { playerMove, opponentMove, outcome, damage } = result;
        const outcomes = {
          win: `${name} executes a ${playerMove} that overpowers the opponent's ${opponentMove}, dealing ${damage} damage.`,
          lose: `${name}'s ${playerMove} is countered by the opponent's ${opponentMove}. ${damage} damage taken.`,
          clash: `${name} and the opponent both choose ${playerMove}. The attacks clash. ${damage} damage to both.`,
        };
        return outcomes[outcome];
      },
      social: () => {
        const { action, success, reputationChange } = result;
        return success
          ? `${name} attempts to ${action} and succeeds. Reputation ${reputationChange >= 0 ? '+' : ''}${reputationChange}.`
          : `${name} attempts to ${action} but stumbles. Reputation ${reputationChange}.`;
      },
      weather: () => {
        const { previous, current, severity } = result;
        return `The weather shifts from ${previous} to ${current} (severity: ${severity}).`;
      },
      resource: () => {
        const { dice, total, resource, amount } = result;
        return `Dice roll [${dice.join(', ')}] = ${total}. ${name} gathers ${amount} ${resource}.`;
      },
      exploration: () => {
        const { direction, distance, discovered, discovery } = result;
        return discovered
          ? `${name} travels ${distance} ${direction} and discovers ${discovery}.`
          : `${name} travels ${distance} ${direction}. The path is uneventful.`;
      },
    };
    
    return templates[system]?.() || JSON.stringify(result);
  }
  
  _generateTurnNarrative() {
    const weatherIdx = this.positions.weather.findIndex(p => p.value > 0);
    const weatherStates = ['clear', 'cloudy', 'overcast', 'drizzle', 'rain', 'heavy rain', 'thunderstorm', 'fog', 'dense fog', 'frost', 'snow', 'blizzard', 'heat wave', 'drought', 'windy', 'gale', 'haboob', 'aurora', 'eclipse', 'anomaly'];
    const weather = weatherIdx >= 0 ? weatherStates[weatherIdx] : 'unknown';
    
    return `Turn ${this.turn} begins. The weather is ${weather}. ${this.eventLog.filter(e => e.turn === this.turn - 1).length} events occurred last turn.`;
  }
  
  _generateStateNarrative(state) {
    const lines = [`=== Game State: Turn ${state.turn} ===`];
    lines.push(`Events logged: ${state.eventCount}`);
    for (const p of state.players) {
      lines.push(`  ${p.name}: Score ${p.score} | HP ${p.health} | Rep ${p.reputation} | Explored ${p.exploredCount}`);
    }
    return lines.join('\n');
  }
  
  // ── Serialization ──────────────────────────────────────────────────
  
  serialize() {
    return {
      seed: this.masterSeed,
      turn: this.turn,
      positions: this.positions,
      players: Array.from(this.players.entries()).map(([id, p]) => ({
        ...p,
        explored: Array.from(p.explored),
      })),
      eventLog: this.eventLog.slice(-100), // last 100 events
    };
  }
  
  // ── SWMIDI Encoding Helper ─────────────────────────────────────────
  
  static encodeSWMIDI(status, channel, data1, data2, sourceId, timestamp = Date.now() & 0xFFFF) {
    const bytes = [
      status & 0xFF,
      channel & 0x0F,
      data1 & 0x7F,
      data2 & 0x7F,
      (timestamp >> 8) & 0xFF,
      timestamp & 0xFF,
      sourceId & 0xFF,
      0, // checksum placeholder
    ];
    bytes[7] = bytes.slice(0, 7).reduce((a, b) => a ^ b, 0);
    return bytes;
  }
  
  static encodeGameEvent(eventType, intensity, sourceId, channel = 0) {
    return PlatonicEngine.encodeSWMIDI(
      SWMIDI_STATUS.GAME_EVENT,
      channel,
      eventType,
      intensity,
      sourceId
    );
  }
}

// ── Exports ───────────────────────────────────────────────────────────

module.exports = {
  PlatonicEngine,
  SWMIDI_STATUS,
  SWMIDI_GAME_EVENTS,
  SOLID_MAP,
  SOLID_INFO,
};
