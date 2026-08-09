// ════════════════════════════════════════════════════════════════════
// CROSS-SESSION ANALYSIS — The Fleet's Musical Memory
// ════════════════════════════════════════════════════════════════════
//
// What keys does Lucineer usually play in?
// What's the fleet's most common mode?
// When does the ensemble get tense together?
// Which speakers always play in the same register?
//
// Cross-session analysis finds patterns across multiple conversations.
// It's the fleet's long-term musical memory — the thing that lets
// a new session know what the ensemble usually sounds like.
//
// "The bassist who's played a thousand gigs knows what the drummer
//  will do before the drummer does. That knowledge isn't telepathy.
//  It's statistics."
//
// ════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');

// ── CrossAnalyzer ───────────────────────────────────────────────────

class CrossAnalyzer {
  /**
   * @param {import('./session-store').SessionStore} store
   */
  constructor(store) {
    this.store = store;
  }

  // ── Fleet-Level Statistics ───────────────────────────────────────

  /**
   * Compute aggregate statistics across all sessions.
   * @returns {Object} Fleet stats
   */
  fleetStats() {
    const sessions = this.store.list();
    if (sessions.length === 0) return this._emptyFleetStats();

    let totalEvents = 0;
    let totalTension = 0;
    let totalEnergy = 0;
    let totalComplexity = 0;
    let totalFlow = 0;

    const modeCounts = {};
    const keyCounts = {};
    const chordCounts = {};
    const speakerTotalEvents = {};
    const speakerDominantSentiments = {};

    for (const meta of sessions) {
      totalEvents += meta.eventCount || 0;
      totalTension += (meta.tension || 0) * (meta.eventCount || 0);
      totalEnergy += (meta.energy || 0) * (meta.eventCount || 0);
      totalComplexity += (meta.complexity || 0);

      modeCounts[meta.mode || meta.dominantMode || 'UNKNOWN'] =
        (modeCounts[meta.mode || meta.dominantMode || 'UNKNOWN'] || 0) + 1;
      keyCounts[meta.key || 'C'] = (keyCounts[meta.key || 'C'] || 0) + 1;

      // Load full session for deeper stats
      const session = this.store.load(meta.id);
      if (session?.analysis) {
        chordCounts[session.analysis.dominantChord] =
          (chordCounts[session.analysis.dominantChord] || 0) + 1;
        totalFlow += session.analysis.flowRatio * (meta.eventCount || 0);

        for (const [speaker, stats] of Object.entries(session.analysis.speakerStats || {})) {
          if (!speakerTotalEvents[speaker]) {
            speakerTotalEvents[speaker] = { count: 0, pitches: [], sentiments: {} };
          }
          speakerTotalEvents[speaker].count += stats.count;
          for (const [sentiment, count] of Object.entries(stats.sentiments)) {
            speakerTotalEvents[speaker].sentiments[sentiment] =
              (speakerTotalEvents[speaker].sentiments[sentiment] || 0) + count;
          }
          speakerTotalEvents[speaker].pitches.push(stats.avgPitch);
        }
      }
    }

    // Compute per-speaker dominant sentiments
    for (const [speaker, data] of Object.entries(speakerTotalEvents)) {
      speakerDominantSentiments[speaker] = Object.entries(data.sentiments)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
      data.avgPitch = data.pitches.length > 0
        ? Math.round(data.pitches.reduce((s, p) => s + p, 0) / data.pitches.length)
        : 0;
      data.dominantSentiment = speakerDominantSentiments[speaker];
    }

    return {
      totalSessions: sessions.length,
      totalEvents,
      avgTension: totalEvents > 0 ? Math.round(totalTension / totalEvents) : 0,
      avgEnergy: totalEvents > 0 ? Math.round(totalEnergy / totalEvents) : 0,
      avgComplexity: Math.round(totalComplexity / sessions.length),
      avgFlowRatio: totalEvents > 0 ? parseFloat((totalFlow / totalEvents).toFixed(3)) : 1.0,
      dominantMode: this._mostFrequent(modeCounts),
      dominantKey: this._mostFrequent(keyCounts),
      dominantChord: this._mostFrequent(chordCounts),
      modeDistribution: modeCounts,
      keyDistribution: keyCounts,
      chordDistribution: chordCounts,
      speakerStats: speakerTotalEvents,
    };
  }

  /**
   * What keys does each speaker usually play in?
   * Returns per-speaker pitch statistics across all sessions.
   * @returns {Object} Per-speaker stats
   */
  speakerProfiles() {
    const sessions = this.store.list();
    const profiles = {};

    for (const meta of sessions) {
      const session = this.store.load(meta.id);
      if (!session?.events) continue;

      for (const e of session.events) {
        if (!profiles[e.speaker]) {
          profiles[e.speaker] = {
            name: e.speaker,
            totalEvents: 0,
            totalPitch: 0,
            totalVel: 0,
            minPitch: 127,
            maxPitch: 0,
            pitchClassCounts: new Array(12).fill(0),
            sentimentCounts: { tense: 0, bright: 0, creative: 0, inquiring: 0, neutral: 0 },
            sessionsPlayed: new Set(),
            usualRegister: 'unknown',
            usualSentiment: 'unknown',
            usualKey: 'unknown',
          };
        }
        const p = profiles[e.speaker];
        p.totalEvents++;
        p.totalPitch += e.pitch;
        p.totalVel += e.velocity;
        p.minPitch = Math.min(p.minPitch, e.pitch);
        p.maxPitch = Math.max(p.maxPitch, e.pitch);
        p.pitchClassCounts[e.pitch % 12]++;
        p.sentimentCounts[e.sentiment] = (p.sentimentCounts[e.sentiment] || 0) + 1;
        p.sessionsPlayed.add(session.id);
      }
    }

    // Finalize profiles
    for (const name of Object.keys(profiles)) {
      const p = profiles[name];
      p.avgPitch = p.totalEvents > 0 ? Math.round(p.totalPitch / p.totalEvents) : 0;
      p.avgVelocity = p.totalEvents > 0 ? Math.round(p.totalVel / p.totalEvents) : 0;
      p.pitchRange = p.maxPitch - p.minPitch;
      p.sessionCount = p.sessionsPlayed.size;
      p.sessionsPlayed = undefined; // Don't serialize Set

      // Determine usual register
      if (p.avgPitch >= 80) p.usualRegister = 'high';
      else if (p.avgPitch >= 60) p.usualRegister = 'mid';
      else if (p.avgPitch >= 40) p.usualRegister = 'low';
      else p.usualRegister = 'sub';

      // Determine usual sentiment
      p.usualSentiment = Object.entries(p.sentimentCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

      // Determine usual key (strongest pitch class)
      const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      p.usualKey = noteNames[
        p.pitchClassCounts.indexOf(Math.max(...p.pitchClassCounts))
      ];
    }

    return profiles;
  }

  /**
   * Find sessions with similar character.
   * Groups sessions by mode and key.
   * @returns {Object} Grouped sessions
   */
  sessionClusters() {
    const sessions = this.store.list();
    const clusters = {};

    for (const meta of sessions) {
      const key = `${meta.key || 'C'}-${meta.mode || meta.dominantMode || 'UNKNOWN'}`;
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push({
        id: meta.id,
        title: meta.title,
        eventCount: meta.eventCount,
        tension: meta.tension,
        energy: meta.energy,
        createdAt: meta.createdAt,
      });
    }

    return clusters;
  }

  /**
   * Find the most common emotional arcs across sessions.
   * An arc is the sequence of sentiment changes.
   * @param {number} minLength — Minimum arc length
   * @returns {Object} Arc patterns with frequency
   */
  emotionalArcs(minLength = 3) {
    const sessions = this.store.list();
    const arcCounts = {};

    for (const meta of sessions) {
      const session = this.store.load(meta.id);
      if (!session?.events || session.events.length < minLength) continue;

      // Extract sentiment sequence
      const sentiments = session.events.map(e => e.sentiment);

      // Find contiguous arcs of the same sentiment
      const arcs = [];
      let current = sentiments[0];
      let count = 1;
      for (let i = 1; i < sentiments.length; i++) {
        if (sentiments[i] === current) {
          count++;
        } else {
          arcs.push({ sentiment: current, length: count });
          current = sentiments[i];
          count = 1;
        }
      }
      arcs.push({ sentiment: current, length: count });

      // Create arc signature (sentiment transitions)
      const signature = arcs.map(a => `${a.sentiment}×${a.length}`).join(' → ');
      arcCounts[signature] = (arcCounts[signature] || 0) + 1;
    }

    return Object.entries(arcCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([arc, count]) => ({ arc, count }));
  }

  /**
   * Compute the fleet's " repertoire" — what does the ensemble
   * typically sound like?
   * @returns {Object} Repertoire summary
   */
  repertoire() {
    const fleet = this.fleetStats();
    const profiles = this.speakerProfiles();
    const clusters = this.sessionClusters();
    const arcs = this.emotionalArcs();

    return {
      summary: {
        totalSessions: fleet.totalSessions,
        totalEvents: fleet.totalEvents,
        ensembleSize: Object.keys(fleet.speakerStats).length,
        soundDescription: this._describeSound(fleet),
      },
      fleetStats: fleet,
      speakerProfiles: profiles,
      sessionClusters: clusters,
      emotionalArcs: arcs,
      // The "house style" — most common mode, key, chord
      houseStyle: {
        mode: fleet.dominantMode,
        key: fleet.dominantKey,
        chord: fleet.dominantChord,
        avgTempo: '~120 BPM',
        flowRatio: fleet.avgFlowRatio,
      },
    };
  }

  /**
   * Find connections between sessions via quotes.
   * Returns a graph of which sessions reference which.
   * @returns {Object} Graph { sessionId: [quotedSessionIds] }
   */
  quoteGraph() {
    const sessions = this.store.list();
    const graph = {};

    for (const meta of sessions) {
      const session = this.store.load(meta.id);
      if (session?.quotes && session.quotes.length > 0) {
        graph[meta.id] = session.quotes.map(q => q.fromSessionId);
      }
    }

    return graph;
  }

  /**
   * Generate a human-readable report of fleet-wide patterns.
   * @returns {string}
   */
  report() {
    const r = this.repertoire();
    const lines = [];

    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push('║  FLEET REPERTOIRE REPORT                                     ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    lines.push('');

    lines.push('── Ensemble ──');
    lines.push(`  Sessions: ${r.summary.totalSessions}`);
    lines.push(`  Total events: ${r.summary.totalEvents}`);
    lines.push(`  Players: ${r.summary.ensembleSize}`);
    lines.push(`  Sound: ${r.summary.soundDescription}`);
    lines.push('');

    lines.push('── House Style ──');
    lines.push(`  Key: ${r.houseStyle.key}`);
    lines.push(`  Mode: ${r.houseStyle.mode}`);
    lines.push(`  Chord: ${r.houseStyle.chord}`);
    lines.push(`  Flow ratio: ${(r.houseStyle.flowRatio * 100).toFixed(1)}%`);
    lines.push('');

    lines.push('── Players ──');
    for (const [name, p] of Object.entries(r.speakerProfiles)) {
      lines.push(
        `  ${name}: ${p.totalEvents} events across ${p.sessionCount} sessions, ` +
        `avg pitch ${p.avgPitch} (${p.usualRegister}), ${p.usualSentiment}, key of ${p.usualKey}`
      );
    }
    lines.push('');

    if (r.emotionalArcs.length > 0) {
      lines.push('── Common Emotional Arcs ──');
      for (const arc of r.emotionalArcs.slice(0, 5)) {
        lines.push(`  [${arc.count}×] ${arc.arc}`);
      }
      lines.push('');
    }

    const qGraph = this.quoteGraph();
    if (Object.keys(qGraph).length > 0) {
      lines.push('── Session Quotes (Cross-References) ──');
      for (const [from, tos] of Object.entries(qGraph)) {
        lines.push(`  ${from} → ${tos.join(', ')}`);
      }
      lines.push('');
    }

    lines.push('── Session Clusters ──');
    for (const [key, cluster] of Object.entries(r.sessionClusters)) {
      lines.push(`  ${key}: ${cluster.length} session(s)`);
    }

    return lines.join('\n');
  }

  // ── Private Utilities ───────────────────────────────────────────

  /**
   * Find the most frequent value in an object of counts.
   * @private
   */
  _mostFrequent(counts) {
    let max = 0, result = null;
    for (const [key, count] of Object.entries(counts)) {
      if (count > max) { max = count; result = key; }
    }
    return result;
  }

  /**
   * Describe the fleet's overall sound in words.
   * @private
   */
  _describeSound(fleet) {
    const parts = [];

    if (fleet.avgTension > 40) parts.push('edgy');
    else if (fleet.avgTension > 20) parts.push('dynamic');
    else parts.push('relaxed');

    if (fleet.avgEnergy > 60) parts.push('high-energy');
    else if (fleet.avgEnergy > 35) parts.push('moderate-energy');
    else parts.push('contemplative');

    if (fleet.avgFlowRatio > 0.8) parts.push('in-flow');
    else if (fleet.avgFlowRatio > 0.5) parts.push('rhythmic');
    else parts.push('rubato');

    return parts.join(', ');
  }

  /**
   * @private
   */
  _emptyFleetStats() {
    return {
      totalSessions: 0,
      totalEvents: 0,
      avgTension: 0,
      avgEnergy: 0,
      avgComplexity: 0,
      avgFlowRatio: 1.0,
      dominantMode: 'SILENCE',
      dominantKey: 'C',
      dominantChord: 'N/A',
      modeDistribution: {},
      keyDistribution: {},
      chordDistribution: {},
      speakerStats: {},
    };
  }
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = { CrossAnalyzer };
