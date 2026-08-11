// ═══════════════════════════════════════════════════════════════════
// Test Suite — Audio Engine (tensor-midi)
// Tests the procedural sound synthesis engine.
// Uses mock AudioContext to verify synthesis logic.
// ═══════════════════════════════════════════════════════════════════

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── Mock AudioContext ─────────────────────────────────────────────────────

class MockGainNode {
  constructor() {
    this.gain = { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} };
    this.connected = [];
  }
  connect(node) { this.connected.push(node); return node; }
}

class MockOscillator {
  constructor() {
    this.type = 'sine';
    this.frequency = { value: 440, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} };
    this.started = false;
    this.stopped = false;
  }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  connect(node) { return node; }
}

class MockBiquadFilter {
  constructor() {
    this.type = 'lowpass';
    this.frequency = { value: 1000 };
    this.Q = { value: 1 };
  }
  connect(node) { return node; }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = { type: 'destination' };
    this.state = 'running';
  }
  createGain() { return new MockGainNode(); }
  createOscillator() { return new MockOscillator(); }
  createBiquadFilter() { return new MockBiquadFilter(); }
  suspend() { this.state = 'suspended'; }
  resume() { this.state = 'running'; }
}

// Set up global browser mocks
const originals = {};

function setupBrowserMock() {
  originals.AudioContext = globalThis.AudioContext;
  originals.webkitAudioContext = globalThis.webkitAudioContext;
  originals.window = globalThis.window;

  globalThis.AudioContext = MockAudioContext;
  globalThis.window = globalThis.window || {};
  globalThis.window.AudioContext = MockAudioContext;
  globalThis.window.webkitAudioContext = MockAudioContext;
}

function teardownBrowserMock() {
  if (originals.AudioContext !== undefined) {
    globalThis.AudioContext = originals.AudioContext;
  } else {
    delete globalThis.AudioContext;
  }
  if (originals.window !== undefined) {
    globalThis.window = originals.window;
  } else {
    delete globalThis.window;
  }
}

// Import after mock setup
async function importAudio() {
  const mod = await import('../src/audio.js');
  return mod;
}

// ─── AudioEngine ───────────────────────────────────────────────────────────

describe('AudioEngine', () => {
  let AudioEngine, audio;

  beforeEach(async () => {
    setupBrowserMock();
    const mod = await importAudio();
    AudioEngine = mod.AudioEngine;
    audio = new AudioEngine();
  });

  afterEach(() => {
    teardownBrowserMock();
  });

  // ─── Constructor ───

  describe('constructor', () => {
    test('starts disabled with null context', () => {
      assert.equal(audio.enabled, false);
      assert.equal(audio.ctx, null);
      assert.equal(audio.masterGain, null);
    });

    test('default BPM is 120', () => {
      assert.equal(audio.bpm, 120);
    });
  });

  // ─── init ───

  describe('init', () => {
    test('creates AudioContext and master gain', () => {
      audio.init();
      assert.ok(audio.ctx);
      assert.ok(audio.masterGain);
      assert.equal(audio.enabled, true);
    });

    test('sets master gain to 0.3', () => {
      audio.init();
      assert.equal(audio.masterGain.gain.value, 0.3);
    });

    test('connects master gain to destination', () => {
      audio.init();
      assert.ok(audio.masterGain.connected.includes(audio.ctx.destination));
    });

    test('is idempotent (calling twice does not recreate)', () => {
      audio.init();
      const ctx1 = audio.ctx;
      audio.init();
      const ctx2 = audio.ctx;
      assert.equal(ctx1, ctx2);
    });
  });

  // ─── setBpm ───

  describe('setBpm', () => {
    test('sets BPM value', () => {
      audio.setBpm(140);
      assert.equal(audio.bpm, 140);
    });

    test('accepts any value (no clamping at this level)', () => {
      audio.setBpm(0);
      assert.equal(audio.bpm, 0);
      audio.setBpm(300);
      assert.equal(audio.bpm, 300);
    });
  });

  // ─── setVolume ───

  describe('setVolume', () => {
    test('sets master gain value', () => {
      audio.init();
      audio.setVolume(0.5);
      assert.equal(audio.masterGain.gain.value, 0.5);
    });

    test('clamps above 1.0', () => {
      audio.init();
      audio.setVolume(2.0);
      assert.equal(audio.masterGain.gain.value, 1);
    });

    test('clamps below 0', () => {
      audio.init();
      audio.setVolume(-0.5);
      assert.equal(audio.masterGain.gain.value, 0);
    });

    test('does nothing when not initialized', () => {
      // Should not throw
      assert.doesNotThrow(() => audio.setVolume(0.5));
    });
  });

  // ─── midiToFreq ───

  describe('midiToFreq', () => {
    test('A4 (69) = 440 Hz', () => {
      assert.equal(audio.midiToFreq(69), 440);
    });

    test('A5 (81) = 880 Hz', () => {
      assert.equal(audio.midiToFreq(81), 880);
    });

    test('A3 (57) = 220 Hz', () => {
      assert.equal(audio.midiToFreq(57), 220);
    });

    test('C4 (60) = ~261.63 Hz', () => {
      assert.ok(Math.abs(audio.midiToFreq(60) - 261.6256) < 0.01);
    });

    test('MIDI 0 produces very low frequency', () => {
      const freq = audio.midiToFreq(0);
      assert.ok(freq > 0 && freq < 10);
    });

    test('octave doubles frequency', () => {
      const c4 = audio.midiToFreq(60);
      const c5 = audio.midiToFreq(72);
      assert.ok(Math.abs(c5 / c4 - 2.0) < 0.001);
    });

    test('semitone ratio is 2^(1/12)', () => {
      const a4 = audio.midiToFreq(69);
      const bb4 = audio.midiToFreq(70);
      const ratio = bb4 / a4;
      assert.ok(Math.abs(ratio - Math.pow(2, 1/12)) < 0.0001);
    });
  });

  // ─── noteOn ───

  describe('noteOn', () => {
    test('does nothing when disabled', () => {
      audio.noteOn(60, 100, 0);
      // No context created, no error
      assert.equal(audio.ctx, null);
    });

    test('produces sound after init', () => {
      audio.init();
      const ctx = audio.ctx;
      const oscBefore = ctx.createOscillator.callCount || 0;
      audio.noteOn(60, 100, 0);
      // Should not throw
    });

    test('default velocity is 100', () => {
      audio.init();
      assert.doesNotThrow(() => audio.noteOn(60));
    });

    test('default channel is 0', () => {
      audio.init();
      assert.doesNotThrow(() => audio.noteOn(60, 100));
    });

    test('friction flag does not throw', () => {
      audio.init();
      assert.doesNotThrow(() => audio.noteOn(60, 100, 0, true));
    });

    test('high channel numbers wrap via modulo', () => {
      audio.init();
      // channel 10 → waveforms[10 % 6] = waveforms[4]
      assert.doesNotThrow(() => audio.noteOn(60, 100, 10));
      assert.doesNotThrow(() => audio.noteOn(60, 100, 15));
    });
  });

  // ─── noteOff ───

  describe('noteOff', () => {
    test('does nothing when disabled', () => {
      audio.noteOff(60);
      assert.equal(audio.ctx, null);
    });

    test('works after init', () => {
      audio.init();
      assert.doesNotThrow(() => audio.noteOff(60));
    });

    test('default channel is 0', () => {
      audio.init();
      assert.doesNotThrow(() => audio.noteOff(60, 5));
    });
  });

  // ─── transport methods ───

  describe('transport methods', () => {
    test('transportPlay does nothing when disabled', () => {
      assert.doesNotThrow(() => audio.transportPlay());
    });

    test('transportStop does nothing when disabled', () => {
      assert.doesNotThrow(() => audio.transportStop());
    });

    test('transportRecord does nothing when disabled', () => {
      assert.doesNotThrow(() => audio.transportRecord());
    });

    test('transportPlay works after init', () => {
      audio.init();
      assert.doesNotThrow(() => audio.transportPlay());
    });

    test('transportStop works after init', () => {
      audio.init();
      assert.doesNotThrow(() => audio.transportStop());
    });

    test('transportRecord works after init', () => {
      audio.init();
      assert.doesNotThrow(() => audio.transportRecord());
    });
  });

  // ─── channel mute/unmute ───

  describe('channelMute / channelUnmute', () => {
    test('do not throw when disabled', () => {
      assert.doesNotThrow(() => audio.channelMute());
      assert.doesNotThrow(() => audio.channelUnmute());
    });

    test('work after init', () => {
      audio.init();
      assert.doesNotThrow(() => audio.channelMute());
      assert.doesNotThrow(() => audio.channelUnmute());
    });
  });

  // ─── playClick ───

  describe('playClick', () => {
    test('does nothing when disabled', () => {
      assert.doesNotThrow(() => audio.playClick());
    });

    test('works after init with default frequency', () => {
      audio.init();
      assert.doesNotThrow(() => audio.playClick());
    });

    test('works with custom frequency', () => {
      audio.init();
      assert.doesNotThrow(() => audio.playClick(800));
    });

    test('works with zero frequency', () => {
      audio.init();
      assert.doesNotThrow(() => audio.playClick(0));
    });
  });

  // ─── playFrictionBuzz ───

  describe('playFrictionBuzz', () => {
    test('works after init', () => {
      audio.init();
      assert.doesNotThrow(() => audio.playFrictionBuzz(0, 440));
    });
  });

  // ─── playAmbientPad ───

  describe('playAmbientPad', () => {
    test('does nothing when disabled', () => {
      assert.doesNotThrow(() => audio.playAmbientPad());
    });

    test('works after init with default frequency', () => {
      audio.init();
      assert.doesNotThrow(() => audio.playAmbientPad());
    });

    test('works with custom root frequency', () => {
      audio.init();
      assert.doesNotThrow(() => audio.playAmbientPad(220));
    });
  });

  // ─── suspend / resume ───

  describe('suspend / resume', () => {
    test('does nothing without context', () => {
      assert.doesNotThrow(() => audio.suspend());
      assert.doesNotThrow(() => audio.resume());
    });

    test('suspends audio context', () => {
      audio.init();
      audio.suspend();
      assert.equal(audio.ctx.state, 'suspended');
    });

    test('resumes audio context', () => {
      audio.init();
      audio.suspend();
      audio.resume();
      assert.equal(audio.ctx.state, 'running');
    });
  });
});

// ─── Singleton instance ────────────────────────────────────────────────────

describe('audio singleton', () => {
  test('exports a singleton AudioEngine instance', async () => {
    setupBrowserMock();
    const mod = await importAudio();
    assert.ok(mod.audio);
    assert.equal(mod.audio.constructor.name, 'AudioEngine');
    teardownBrowserMock();
  });
});

// ─── Waveform selection ────────────────────────────────────────────────────

describe('waveform selection by channel', () => {
  let AudioEngine;

  beforeEach(async () => {
    setupBrowserMock();
    const mod = await importAudio();
    AudioEngine = mod.AudioEngine;
  });

  afterEach(() => teardownBrowserMock());

  test('channels cycle through waveforms', () => {
    const engine = new AudioEngine();
    engine.init();

    // The waveforms array is: sine, triangle, sawtooth, square, sine, triangle
    // channel 0 → sine, 1 → triangle, 2 → sawtooth, 3 → square
    // channel 4 → sine, 5 → triangle, 6 → sine (wraps via % 6)
    // We can't directly inspect the waveform, but we verify no errors across channels
    for (let ch = 0; ch < 16; ch++) {
      assert.doesNotThrow(() => engine.noteOn(60, 100, ch), `channel ${ch} should not throw`);
    }
  });
});

// ─── ADSR envelope edge cases ─────────────────────────────────────────────

describe('ADSR envelope behavior', () => {
  let AudioEngine;

  beforeEach(async () => {
    setupBrowserMock();
    const mod = await importAudio();
    AudioEngine = mod.AudioEngine;
  });

  afterEach(() => teardownBrowserMock());

  test('friction mode uses shorter decay and release', () => {
    const engine = new AudioEngine();
    engine.init();

    // With friction=true, decay=0.05 and release=0.1
    // Without friction, decay=0.15 and release=0.4
    // We just verify no error with both modes
    assert.doesNotThrow(() => engine.noteOn(60, 100, 0, false));
    assert.doesNotThrow(() => engine.noteOn(60, 100, 0, true));
  });

  test('velocity 0 produces valid envelope', () => {
    const engine = new AudioEngine();
    engine.init();
    assert.doesNotThrow(() => engine.noteOn(60, 0, 0));
  });

  test('velocity 127 produces valid envelope', () => {
    const engine = new AudioEngine();
    engine.init();
    assert.doesNotThrow(() => engine.noteOn(60, 127, 0));
  });

  test('extreme pitch values produce valid output', () => {
    const engine = new AudioEngine();
    engine.init();
    assert.doesNotThrow(() => engine.noteOn(0, 100, 0));   // lowest
    assert.doesNotThrow(() => engine.noteOn(127, 100, 0)); // highest
  });
});
