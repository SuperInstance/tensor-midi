// ═══════════════════════════════════════════════════════════════════
// Test Suite — Jazz Analyzer (tensor-midi)
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JazzMode, ChordQuality, JazzAnalyzer } from '../src/analyzer.js';
import { Friction } from '../src/swmidi.js';
import { PulseGrid } from '../src/engine.js';

describe('JazzMode constants', () => {
  test('all modes are unique strings', () => {
    const modes = Object.values(JazzMode);
    assert.equal(new Set(modes).size, modes.length);
  });
  test('has Groove', () => assert.equal(JazzMode.Groove, 'groove'));
  test('has Tension', () => assert.equal(JazzMode.Tension, 'tension'));
  test('has Solo', () => assert.equal(JazzMode.Solo, 'solo'));
  test('has Ballad', () => assert.equal(JazzMode.Ballad, 'ballad'));
});

describe('ChordQuality constants', () => {
  test('all chords are unique strings', () => {
    const chords = Object.values(ChordQuality);
    assert.equal(new Set(chords).size, chords.length);
  });
});

describe('JazzAnalyzer initialization', () => {
  test('starts in Groove mode', () => {
    const ja = new JazzAnalyzer();
    assert.equal(ja.currentMode, JazzMode.Groove);
  });
  test('starts in Major7', () => {
    const ja = new JazzAnalyzer();
    assert.equal(ja.currentChord, ChordQuality.Major7);
  });
  test('starts with 0 tension', () => {
    const ja = new JazzAnalyzer();
    assert.equal(ja.tensionLevel, 0);
  });
  test('starts with 50 energy', () => {
    const ja = new JazzAnalyzer();
    assert.equal(ja.energyLevel, 50);
  });
  test('starts with 0 complexity', () => {
    const ja = new JazzAnalyzer();
    assert.equal(ja.complexityLevel, 0);
  });
  test('history is empty', () => {
    const ja = new JazzAnalyzer();
    assert.equal(ja.history.length, 0);
  });
});

describe('JazzAnalyzer.analyzeBar', () => {
  test('empty bar → Ballad mode', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    const result = ja.analyzeBar([], pg, 0);
    assert.equal(result.mode, JazzMode.Ballad);
  });

  test('high friction → Tension mode', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    // 5 events, 3 with friction → 60% friction > 0.4 threshold
    const events = [
      { channel: 0, pitch: 60, velocity: 80, errorMask: Friction.Timeout, tick: 0 },
      { channel: 0, pitch: 62, velocity: 80, errorMask: Friction.Conflict, tick: 48 },
      { channel: 0, pitch: 64, velocity: 80, errorMask: Friction.None, tick: 96 },
      { channel: 0, pitch: 65, velocity: 80, errorMask: Friction.RateLimit, tick: 144 },
      { channel: 0, pitch: 67, velocity: 80, errorMask: Friction.None, tick: 192 },
    ];
    const result = ja.analyzeBar(events, pg, 0);
    assert.equal(result.mode, JazzMode.Tension);
    assert.ok(result.tension > 40);
  });

  test('single channel dominance → Solo mode', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    // Channel 0 has 5 events, channel 1 has 1 → 83% dominance
    const events = [
      { channel: 0, pitch: 60, velocity: 80, errorMask: 0, tick: 0 },
      { channel: 0, pitch: 62, velocity: 80, errorMask: 0, tick: 48 },
      { channel: 0, pitch: 64, velocity: 80, errorMask: 0, tick: 96 },
      { channel: 0, pitch: 65, velocity: 80, errorMask: 0, tick: 144 },
      { channel: 0, pitch: 67, velocity: 80, errorMask: 0, tick: 192 },
      { channel: 1, pitch: 72, velocity: 80, errorMask: 0, tick: 240 },
    ];
    const result = ja.analyzeBar(events, pg, 0);
    assert.equal(result.mode, JazzMode.Solo);
  });

  test('all flow → low tension', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    const events = [
      { channel: 0, pitch: 60, velocity: 80, errorMask: 0, tick: 0 },
      { channel: 0, pitch: 62, velocity: 80, errorMask: 0, tick: 48 },
      { channel: 0, pitch: 64, velocity: 80, errorMask: 0, tick: 96 },
    ];
    const result = ja.analyzeBar(events, pg, 0);
    assert.equal(result.tension, 0);
    assert.equal(result.frictionCount, 0);
    assert.equal(result.flowCount, 3);
  });

  test('history grows with each analysis', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    ja.analyzeBar([], pg, 0);
    ja.analyzeBar([], pg, 1);
    ja.analyzeBar([], pg, 2);
    assert.equal(ja.history.length, 3);
  });

  test('returns dominant channel', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    const events = [
      { channel: 3, pitch: 60, velocity: 80, errorMask: 0, tick: 0 },
      { channel: 3, pitch: 62, velocity: 80, errorMask: 0, tick: 48 },
      { channel: 5, pitch: 64, velocity: 80, errorMask: 0, tick: 96 },
    ];
    const result = ja.analyzeBar(events, pg, 0);
    assert.equal(result.dominantChannel, 3);
  });

  test('returns null dominant channel for empty bar', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    const result = ja.analyzeBar([], pg, 0);
    assert.equal(result.dominantChannel, null);
  });
});

describe('JazzAnalyzer chord determination', () => {
  test('high friction → Dominant7', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    const events = Array(10).fill(null).map((_, i) => ({
      channel: 0, pitch: 60, velocity: 80,
      errorMask: i < 4 ? Friction.Timeout : 0, tick: i * 48,
    }));
    const result = ja.analyzeBar(events, pg, 0);
    assert.equal(result.chord, ChordQuality.Dominant7);
  });

  test('low pitch + some friction → Minor7', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    // 5 events, 1 with friction → frictionRatio = 0.2
    // 0.1 < 0.2 <= 0.3 → Minor7 (if avgPitch < 50)
    const events = [
      { channel: 0, pitch: 30, velocity: 80, errorMask: Friction.Timeout, tick: 0 },
      { channel: 0, pitch: 32, velocity: 80, errorMask: 0, tick: 48 },
      { channel: 0, pitch: 31, velocity: 80, errorMask: 0, tick: 96 },
      { channel: 0, pitch: 33, velocity: 80, errorMask: 0, tick: 144 },
      { channel: 0, pitch: 30, velocity: 80, errorMask: 0, tick: 192 },
    ];
    const result = ja.analyzeBar(events, pg, 0);
    assert.equal(result.chord, ChordQuality.Minor7);
  });
});

describe('JazzAnalyzer.description', () => {
  test('returns a non-empty string', () => {
    const ja = new JazzAnalyzer();
    assert.ok(ja.description.length > 10);
  });
  test('includes tension level', () => {
    const ja = new JazzAnalyzer();
    const desc = ja.description;
    assert.ok(desc.includes('Tension:'));
  });
  test('includes energy level', () => {
    const ja = new JazzAnalyzer();
    const desc = ja.description;
    assert.ok(desc.includes('Energy:'));
  });
});

describe('JazzAnalyzer.detectConvergence', () => {
  test('3+ channels on same bar → strong convergence', () => {
    const ja = new JazzAnalyzer();
    const events = [
      { channel: 0, tick: 0 },
      { channel: 1, tick: 48 },
      { channel: 2, tick: 96 },
    ];
    const convergences = ja.detectConvergence(events);
    assert.ok(convergences.length > 0);
    assert.equal(convergences[0].type, 'strong');
    assert.ok(convergences[0].channels >= 3);
  });

  test('2 channels → weak convergence', () => {
    const ja = new JazzAnalyzer();
    const events = [
      { channel: 0, tick: 0 },
      { channel: 1, tick: 48 },
    ];
    const convergences = ja.detectConvergence(events);
    assert.equal(convergences[0].type, 'weak');
  });

  test('1 channel → no convergence', () => {
    const ja = new JazzAnalyzer();
    const events = [
      { channel: 0, tick: 0 },
      { channel: 0, tick: 48 },
    ];
    const convergences = ja.detectConvergence(events);
    // Single channel → only 1 in set → neither weak nor strong
    // Actually channel 0 appears once per tick → each bar has 1 channel
    const strong = convergences.filter(c => c.type === 'strong');
    const weak = convergences.filter(c => c.type === 'weak');
    assert.equal(strong.length, 0);
  });
});

describe('JazzAnalyzer.getReport', () => {
  test('returns current state', () => {
    const ja = new JazzAnalyzer();
    const report = ja.getReport();
    assert.ok(report.hasOwnProperty('currentMode'));
    assert.ok(report.hasOwnProperty('currentChord'));
    assert.ok(report.hasOwnProperty('description'));
    assert.ok(report.hasOwnProperty('tension'));
    assert.ok(report.hasOwnProperty('energy'));
  });

  test('includes averages after analysis', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    ja.analyzeBar([
      { channel: 0, pitch: 60, velocity: 80, errorMask: 0, tick: 0 },
    ], pg, 0);
    ja.analyzeBar([
      { channel: 0, pitch: 60, velocity: 80, errorMask: Friction.Timeout, tick: 0 },
    ], pg, 1);
    const report = ja.getReport();
    assert.ok(report.avgTension >= 0);
    assert.ok(report.avgEnergy >= 0);
  });

  test('tracks mode changes in history', () => {
    const ja = new JazzAnalyzer();
    const pg = new PulseGrid();
    // Bar 0: empty → Ballad
    ja.analyzeBar([], pg, 0);
    // Bar 1: high friction → Tension
    ja.analyzeBar([
      { channel: 0, pitch: 60, velocity: 80, errorMask: Friction.Timeout, tick: 576 },
      { channel: 0, pitch: 62, velocity: 80, errorMask: Friction.Conflict, tick: 624 },
      { channel: 0, pitch: 64, velocity: 80, errorMask: Friction.RateLimit, tick: 672 },
    ], pg, 1);
    const report = ja.getReport();
    assert.ok(report.modeChanges >= 1, `Expected at least 1 mode change, got ${report.modeChanges}`);
  });
});
