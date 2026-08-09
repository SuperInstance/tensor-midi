// ═══════════════════════════════════════════════════════════════════
// Jazz Analyzer — Harmonic Analysis of Conversation Flow
// ═══════════════════════════════════════════════════════════════════
//
// In jazz, you listen to the whole ensemble and feel:
//   - Where's the groove? (flow state)
//   - Where's the tension? (friction, conflict)
//   - Who's soloing? (dominant channel)
//   - Is everyone together? (convergence)
//   - Where's it going? (harmonic motion)
//
// This analyzer listens to the SWMIDI stream and produces a real-time
// jazz reading of the conversation.

import { Friction, hasFriction, isFlow } from './swmidi.js';
import { PulseGrid, TICKS_PER_BAR, TICKS_PER_PULSE, PULSES_PER_BAR, tickToPosition } from './engine.js';

/// Jazz modes — the emotional state of the ensemble
export const JazzMode = {
  Groove: 'groove',         // Everyone's in the pocket
  Building: 'building',     // Energy rising, creating
  Tension: 'tension',       // Conflict, friction
  Release: 'release',       // Tension resolving
  Solo: 'solo',             // One voice dominating
  Comping: 'comping',       // Supporting each other
  Free: 'free',             // Open, exploratory
  Ballad: 'ballad',         // Slow, contemplative
};

/// Chord quality — the emotional color
export const ChordQuality = {
  Major7: 'major7',     // Bright, stable, happy
  Minor7: 'minor7',     // Cool, melancholy, thoughtful
  Dominant7: 'dom7',    // Tense, wanting resolution
  Diminished: 'dim',    // Dark, unstable
  Augmented: 'aug',     // Dreamy, floating
  Sus4: 'sus4',         // Suspended, waiting
};

/// Analyze a SWMIDI stream for jazz characteristics
export class JazzAnalyzer {
  constructor() {
    this.history = []; // mode history
    this.currentMode = JazzMode.Groove;
    this.currentChord = ChordQuality.Major7;
    this.tensionLevel = 0; // 0-100
    this.energyLevel = 50; // 0-100
    this.complexityLevel = 0; // 0-100
  }
  
  /// Analyze a set of events (e.g., one bar's worth)
  analyzeBar(events, pulseGrid, barNumber) {
    const flowCount = events.filter(isFlow).length;
    const frictionCount = events.filter(hasFriction).length;
    const total = events.length;
    
    // Channel distribution — who's playing?
    const channelCounts = {};
    for (const e of events) {
      channelCounts[e.channel] = (channelCounts[e.channel] || 0) + 1;
    }
    
    const channels = Object.keys(channelCounts).length;
    const maxChannel = Object.entries(channelCounts)
      .sort((a, b) => b[1] - a[1])[0];
    
    // Density — how busy is this bar?
    const density = pulseGrid.getBarDensity(barNumber);
    
    // Pitch range — emotional spread
    const pitches = events.map(e => e.pitch);
    const pitchRange = pitches.length > 0 ? Math.max(...pitches) - Math.min(...pitches) : 0;
    const avgPitch = pitches.length > 0 ? pitches.reduce((a, b) => a + b, 0) / pitches.length : 60;
    
    // Update tension (friction-based)
    const frictionRatio = total > 0 ? frictionCount / total : 0;
    this.tensionLevel = Math.round(frictionRatio * 100);
    
    // Update energy (density-based)
    this.energyLevel = Math.round(density * 70 + (pitchRange / 127) * 30);
    
    // Update complexity (channel + pitch variety)
    this.complexityLevel = Math.round((channels / 8) * 50 + (pitchRange / 127) * 50);
    
    // Determine mode
    this.currentMode = this._determineMode(total, channels, frictionRatio, density, maxChannel);
    
    // Determine chord quality
    this.currentChord = this._determineChord(avgPitch, frictionRatio, density);
    
    // Record history
    this.history.push({
      bar: barNumber,
      mode: this.currentMode,
      chord: this.currentChord,
      tension: this.tensionLevel,
      energy: this.energyLevel,
      complexity: this.complexityLevel,
      channels,
      density,
      timestamp: Date.now(),
    });
    
    return {
      mode: this.currentMode,
      chord: this.currentChord,
      tension: this.tensionLevel,
      energy: this.energyLevel,
      complexity: this.complexityLevel,
      dominantChannel: maxChannel ? parseInt(maxChannel[0]) : null,
      density,
      pitchRange,
      avgPitch,
      total,
      flowCount,
      frictionCount,
    };
  }
  
  _determineMode(total, channels, frictionRatio, density, maxChannel) {
    if (frictionRatio > 0.4) return JazzMode.Tension;
    if (total === 0) return JazzMode.Ballad;
    
    // Check if one channel dominates (>60% of events)
    if (maxChannel && total > 0) {
      const dominance = maxChannel[1] / total;
      if (dominance > 0.6 && channels > 1) return JazzMode.Solo;
    }
    
    if (channels >= 3 && density > 0.5) return JazzMode.Building;
    if (channels >= 3 && frictionRatio < 0.1) return JazzMode.Comping;
    if (density < 0.2) return JazzMode.Free;
    if (density < 0.4) return JazzMode.Ballad;
    
    return JazzMode.Groove;
  }
  
  _determineChord(avgPitch, frictionRatio, density) {
    if (frictionRatio > 0.3) return ChordQuality.Dominant7;
    if (frictionRatio > 0.1) return ChordQuality.Minor7;
    if (density < 0.2) return ChordQuality.Augmented;
    if (avgPitch > 80) return ChordQuality.Major7;
    if (avgPitch < 50) return ChordQuality.Minor7;
    return ChordQuality.Major7;
  }
  
  /// Get a human-readable jazz description
  get description() {
    const modeDesc = {
      [JazzMode.Groove]: "The ensemble is in the pocket",
      [JazzMode.Building]: "Energy is building, voices layering",
      [JazzMode.Tension]: "There's tension in the room",
      [JazzMode.Release]: "Tension releasing, settling back",
      [JazzMode.Solo]: "One voice is soloing",
      [JazzMode.Comping]: "Everyone's comping for each other",
      [JazzMode.Free]: "Open, free, exploratory",
      [JazzMode.Ballad]: "Slow, contemplative, a ballad",
    };
    
    const chordDesc = {
      [ChordQuality.Major7]: "warm major 7ths",
      [ChordQuality.Minor7]: "cool minor 7ths",
      [ChordQuality.Dominant7]: "tense dominant 7ths",
      [ChordQuality.Diminished]: "dark diminished colors",
      [ChordQuality.Augmented]: "floating augmented sound",
      [ChordQuality.Sus4]: "suspended, waiting to resolve",
    };
    
    return `${modeDesc[this.currentMode]}. The harmony lives in ${chordDesc[this.currentChord]}. ` +
           `Tension: ${this.tensionLevel}%. Energy: ${this.energyLevel}%. Complexity: ${this.complexityLevel}%.`;
  }
  
  /// Detect convergence — moments where multiple channels align
  detectConvergence(events) {
    const byTick = {};
    for (const e of events) {
      const bar = Math.floor(e.tick / TICKS_PER_BAR);
      if (!byTick[bar]) byTick[bar] = new Set();
      byTick[bar].add(e.channel);
    }
    
    const convergences = [];
    for (const [bar, channels] of Object.entries(byTick)) {
      if (channels.size >= 3) {
        convergences.push({
          bar: parseInt(bar),
          channels: channels.size,
          type: 'strong',
        });
      } else if (channels.size === 2) {
        convergences.push({
          bar: parseInt(bar),
          channels: channels.size,
          type: 'weak',
        });
      }
    }
    return convergences;
  }
  
  /// Get the full analysis report
  getReport() {
    const recentHistory = this.history.slice(-32); // last 32 bars
    
    const modeChanges = recentHistory.filter((h, i) => 
      i > 0 && h.mode !== recentHistory[i - 1].mode
    );
    
    const avgTension = recentHistory.length > 0
      ? Math.round(recentHistory.reduce((sum, h) => sum + h.tension, 0) / recentHistory.length)
      : 0;
    
    const avgEnergy = recentHistory.length > 0
      ? Math.round(recentHistory.reduce((sum, h) => sum + h.energy, 0) / recentHistory.length)
      : 0;
    
    return {
      currentMode: this.currentMode,
      currentChord: this.currentChord,
      description: this.description,
      tension: this.tensionLevel,
      energy: this.energyLevel,
      complexity: this.complexityLevel,
      avgTension,
      avgEnergy,
      modeChanges: modeChanges.length,
      history: recentHistory,
    };
  }
}
