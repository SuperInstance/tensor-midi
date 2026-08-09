// ── Platonic Randomness (JavaScript port) ─────────────────────────────
// Mirrors /home/eileen/projects/platonic-randomness/src/index.ts
// without TypeScript syntax so the game engine can import it directly.

/** The five Platonic solids. */
export const SOLID_NAMES = ['tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron'];

/** Vertices for each Platonic solid, normalized to the unit sphere. */
export const SOLID_VERTICES = {
  tetrahedron: [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ],
  cube: [
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
  ],
  octahedron: [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ],
  dodecahedron: [
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
    [0, 0.618, 1.618], [0, 0.618, -1.618], [0, -0.618, 1.618], [0, -0.618, -1.618],
    [0.618, 1.618, 0], [0.618, -1.618, 0], [-0.618, 1.618, 0], [-0.618, -1.618, 0],
    [1.618, 0, 0.618], [1.618, 0, -0.618], [-1.618, 0, 0.618], [-1.618, 0, -0.618],
  ],
  icosahedron: [
    [0, 1, 0.618 * 2], [0, 1, -0.618 * 2],
    [0, -1, 0.618 * 2], [0, -1, -0.618 * 2],
    [1, 0.618 * 2, 0], [1, -0.618 * 2, 0],
    [-1, 0.618 * 2, 0], [-1, -0.618 * 2, 0],
    [0.618 * 2, 0, 1], [0.618 * 2, 0, -1],
    [-0.618 * 2, 0, 1], [-0.618 * 2, 0, -1],
  ],
};

/** Number of vertices per solid. */
export const VERTEX_COUNTS = {
  tetrahedron: 4,
  cube: 8,
  octahedron: 6,
  dodecahedron: 20,
  icosahedron: 12,
};

/**
 * xmur3 string hash — produces a 32-bit unsigned integer seed.
 */
export function xmur3(str) {
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

/** Mulberry32 — fast 32-bit PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** SplitMix32 — high quality 32-bit PRNG. */
export function splitMix32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x9e3779b9) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}

/** Xorshift32 — small-state PRNG. */
export function xorshift32(seed) {
  let x = seed >>> 0;
  if (x === 0) x = 0x1;
  return function () {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/**
 * Deterministic PRNG whose internal state is rotated through the vertices
 * of a chosen Platonic solid. The symmetry of the solid shapes the orbit
 * structure of the state space.
 */
export class PlatonicRNG {
  constructor(seed, solid = 'icosahedron', backend = 'mulberry32') {
    const seedNum = typeof seed === 'string' ? xmur3(seed)() : seed >>> 0;
    this.state = seedNum;
    this.vertices = SOLID_VERTICES[solid];
    this.vertexCount = VERTEX_COUNTS[solid];
    this.stepCount = 0;
    this.backend =
      backend === 'splitMix32' ? splitMix32(seedNum)
      : backend === 'xorshift32' ? xorshift32(seedNum)
      : mulberry32(seedNum);
    this.solid = solid;
  }

  /** Current orbit vertex index (0 .. vertexCount - 1). */
  get orbit() {
    return this.stepCount % this.vertexCount;
  }

  /** Advance one step, mixing the current state with the next vertex. */
  advance() {
    const v = this.vertices[this.orbit];
    this.state = (this.state ^ Math.imul(v[0] * 1000 + v[1] * 100 + v[2] * 10, 0x9e3779b9)) >>> 0;
    this.stepCount++;
    const raw = this.backend();
    const mixed = ((raw * 4294967296) ^ this.state) >>> 0;
    return mixed / 4294967296;
  }

  next() { return this.advance(); }
  range(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  bool(probability = 0.5) { return this.next() < probability; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  array(n) {
    const result = new Array(n);
    for (let i = 0; i < n; i++) result[i] = this.next();
    return result;
  }

  gaussian(mean = 0, stddev = 1) {
    const u1 = this.next() || 1e-10;
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z * stddev + mean;
  }

  weighted(weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  get steps() { return this.stepCount; }
  resetSteps() { this.stepCount = 0; }
}

/** Factory helper. */
export function rng(seed, solid = 'icosahedron', backend = 'mulberry32') {
  return new PlatonicRNG(seed, solid, backend);
}

/** Generate n samples from a uniform distribution in [0, 1). */
export function uniform(n, seed) {
  return rng(seed).array(n);
}

/** Generate n samples from a Gaussian distribution. */
export function gaussian(n, seed, mean = 0, stddev = 1) {
  const r = rng(seed);
  const result = new Array(n);
  for (let i = 0; i < n; i++) result[i] = r.gaussian(mean, stddev);
  return result;
}

/** Generate n samples from an exponential distribution. */
export function exponential(n, seed, rate = 1) {
  const r = rng(seed);
  const result = new Array(n);
  for (let i = 0; i < n; i++) result[i] = -Math.log(1 - r.next()) / rate;
  return result;
}

/** Roll dice: nDice d-sided dice, return sum. */
export function diceRoll(nDice, sides, seed) {
  const r = rng(seed);
  let sum = 0;
  for (let i = 0; i < nDice; i++) sum += r.int(1, sides);
  return sum;
}

/** Roll 2d6 with the Catan triangular distribution. */
export function catan2d6(seed) {
  return diceRoll(2, 6, seed);
}

/** Generate n samples from a triangular distribution (sum of nDice uniform dice). */
export function pyramid(n, nDice, sides, seed) {
  const result = new Array(n);
  for (let i = 0; i < n; i++) result[i] = diceRoll(nDice, sides, `${seed}-roll-${i}`);
  return result;
}
