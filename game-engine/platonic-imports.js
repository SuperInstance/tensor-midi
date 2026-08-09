/**
 * Shim to import the PlatonicRNG library from TypeScript source.
 * This provides a CommonJS-compatible require() for the engine.
 */

const fs = require('fs');
const path = require('path');

// Since the source is TypeScript, we need to either:
// 1. Use a TypeScript runtime (ts-node)
// 2. Transpile first
// 3. Provide a JS reimplementation

// For the game engine, we'll provide a JS-compatible version of the core classes.
// This mirrors the TypeScript implementation in platonic-randomness/src/index.ts

const SOLID_VERTICES = {
  tetrahedron: [
    [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
  ],
  cube: [
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
  ],
  octahedron: [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ],
  dodecahedron: [
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
    [0, 0.618, 1.618], [0, 0.618, -1.618], [0, -0.618, 1.618], [0, -0.618, -1.618],
    [0.618, 1.618, 0], [0.618, -1.618, 0], [-0.618, 1.618, 0], [-0.618, -1.618, 0],
    [1.618, 0, 0.618], [1.618, 0, -0.618], [-1.618, 0, 0.618], [-1.618, 0, -0.618],
  ],
  icosahedron: [
    [0, 1, 1.236], [0, 1, -1.236], [0, -1, 1.236], [0, -1, -1.236],
    [1, 1.236, 0], [1, -1.236, 0], [-1, 1.236, 0], [-1, -1.236, 0],
    [1.236, 0, 1], [1.236, 0, -1], [-1.236, 0, 1], [-1.236, 0, -1],
  ],
};

const VERTEX_COUNTS = {
  tetrahedron: 4, cube: 8, octahedron: 6, dodecahedron: 20, icosahedron: 12,
};

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
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function splitMix32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x9e3779b9) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}

function xorshift32(seed) {
  let x = seed >>> 0;
  if (x === 0) x = 0x1;
  return function () {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

class PlatonicRNG {
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
  }

  advance() {
    const v = this.vertices[this.stepCount % this.vertexCount];
    this.state = (this.state ^ Math.imul(v[0] * 1000 + v[1] * 100 + v[2] * 10, 0x9e3779b9)) >>> 0;
    this.stepCount++;
    const raw = this.backend();
    const mixed = ((raw * 4294967296) ^ this.state) >>> 0;
    return mixed / 4294967296;
  }

  next() { return this.advance(); }
  range(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  bool(prob = 0.5) { return this.next() < prob; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  array(n) { const r = new Array(n); for (let i = 0; i < n; i++) r[i] = this.next(); return r; }
  gaussian(mean = 0, stddev = 1) {
    const u1 = this.next() || 1e-10;
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stddev + mean;
  }
  weighted(weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
    return weights.length - 1;
  }
  get steps() { return this.stepCount; }
  resetSteps() { this.stepCount = 0; }
}

function rng(seed, solid, backend) { return new PlatonicRNG(seed, solid, backend); }

module.exports = { PlatonicRNG, rng, SOLID_VERTICES, VERTEX_COUNTS, xmur3, mulberry32, splitMix32, xorshift32 };
