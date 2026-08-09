/**
 * ════════════════════════════════════════════════════════════════════
 * JAZZ ANALYSIS MODULE
 * ════════════════════════════════════════════════════════════════════
 *
 * Analyzes a captured conversation and produces a jazz-style score.
 *
 * Identifies:
 *   - Key (dominant sentiment → major/minor)
 *   - Tempo (message frequency → BPM)
 *   - Form (conversation structure → head, solos, trades, head out)
 *   - Soloists (longest creative run per agent)
 *   - Comping (short supportive responses)
 *   - Tension & Release (where dissonance builds and resolves)
 *
 * Output: a jazz lead sheet for the conversation.
 * ════════════════════════════════════════════════════════════════════
 */

// ── Jazz Forms ───────────────────────────────────────────────────────

const JAZZ_FORMS = {
  'blues': { structure: ['Head', 'Solo 1', 'Solo 2', 'Solo 3', 'Head Out'], bars: 12 },
  'aba': { structure: ['A', 'B', 'A'], bars: 32 },
  'aaba': { structure: ['A', 'A', 'B', 'A'], bars: 32 },
  'abac': { structure: ['A', 'B', 'A', 'C'], bars: 32 },
  'through-composed': { structure: ['Intro', 'Development', 'Climax', 'Resolution'], bars: 0 },
  'free': { structure: ['Free Improvisation'], bars: 0 },
};

// ── Roles ────────────────────────────────────────────────────────────

const JAZZ_ROLES = {
  LEADER: 'Leader',       // initiates topics, sets direction
  SOLOIST: 'Soloist',     // extended creative runs
  COMPING: 'Comping',     // short supportive responses
  TRADES: 'Trading',      // back-and-forth exchanges
  RHYTHM: 'Rhythm Section', // steady presence, grounding
  GUEST: 'Guest Soloist', // brief but memorable appearance
};

// ── Analyzer ─────────────────────────────────────────────────────────

/**
 * Analyze a tensor-midi capture and produce a jazz score.
 */
class JazzAnalyzer {
  constructor(tensorData) {
    this.data = tensorData;
    this.allNotes = [];
    this.agentStats = {};
    this._collectData();
  }

  _collectData() {
    for (const track of this.data.tracks) {
      if (!this.agentStats[track.track]) {
        this.agentStats[track.track] = {
          name: track.track,
          channel: track.channel,
          noteCount: 0,
          totalDuration: 0,
          avgVelocity: 0,
          avgPitch: 0,
          sentiments: {},
          longestRun: 0,
          consecutiveMessages: 0,
          pitches: [],
          velocities: [],
          startTimes: [],
          isSoloist: false,
          isComping: false,
          isLeader: false,
          role: null,
        };
      }

      const stats = this.agentStats[track.track];
      for (const note of track.notes) {
        stats.noteCount++;
        stats.totalDuration += note.duration;
        stats.avgVelocity += note.velocity;
        stats.avgPitch += note.pitch;
        stats.sentiments[note.sentiment] = (stats.sentiments[note.sentiment] || 0) + 1;
        stats.pitches.push(note.pitch);
        stats.velocities.push(note.velocity);
        stats.startTimes.push(note.start);

        this.allNotes.push({
          ...note,
          agent: track.track,
        });
      }
    }

    // Finalize averages
    for (const agent of Object.values(this.agentStats)) {
      if (agent.noteCount > 0) {
        agent.avgVelocity = Math.round(agent.avgVelocity / agent.noteCount);
        agent.avgPitch = Math.round(agent.avgPitch / agent.noteCount);
      }
    }

    // Sort all notes chronologically
    this.allNotes.sort((a, b) => a.start - b.start);
  }

  /**
   * Run full analysis.
   */
  analyze() {
    return {
      leadSheet: this.generateLeadSheet(),
      form: this.identifyForm(),
      key: this.identifyKey(),
      tempo: this.data.tempo,
      roles: this.identifyRoles(),
      tension: this.analyzeTensionRelease(),
      soloists: this.identifySoloists(),
      comping: this.identifyComping(),
      trades: this.identifyTrades(),
      summary: this.generateSummary(),
    };
  }

  /**
   * Identify the musical key from overall sentiment.
   */
  identifyKey() {
    const sentimentTally = {};
    for (const note of this.allNotes) {
      sentimentTally[note.sentiment] = (sentimentTally[note.sentiment] || 0) + 1;
    }

    const sorted = Object.entries(sentimentTally).sort((a, b) => b[1] - a[1]);
    const dominant = sorted[0]?.[0] || 'neutral';

    const keyMap = {
      joyful: 'C major', excited: 'D major', curious: 'G major',
      supportive: 'F major', agreeable: 'A major', grateful: 'Eb major',
      playful: 'Bb major', neutral: 'C major', informative: 'D dorian',
      contemplative: 'A minor', concerned: 'E minor', confused: 'B minor',
      frustrated: 'F# minor', disagreeable: 'C# minor', anxious: 'G minor',
      resolved: 'C major', conciliatory: 'F major',
    };

    const isMinor = ['contemplative', 'concerned', 'confused', 'frustrated',
                      'disagreeable', 'anxious'].includes(dominant);

    return {
      key: keyMap[dominant] || 'C major',
      tonic: this.data.key,
      mode: isMinor ? 'minor' : 'major',
      dominantSentiment: dominant,
      sentimentDistribution: Object.fromEntries(sorted),
    };
  }

  /**
   * Identify the conversation form (mapped to jazz forms).
   */
  identifyForm() {
    const totalDuration = this.data.duration;
    const noteCount = this.allNotes.length;
    const agentCount = this.data.trackCount;

    if (noteCount < 5) {
      return { form: 'through-composed', structure: JAZZ_FORMS['through-composed'].structure, description: 'Brief exchange — a musical vignette.' };
    }

    // Check for blues pattern: short, focused, everyone solos once
    if (totalDuration < 120 && agentCount >= 3 && agentCount <= 5) {
      const sections = this.segmentConversation();
      if (sections.length >= 3) {
        return { form: 'blues', structure: JAZZ_FORMS['blues'].structure, description: 'A blues — everyone gets a turn, tight and focused.' };
      }
    }

    // Check for AABA (common conversation arc)
    const sections = this.segmentConversation();
    if (sections.length >= 4) {
      return { form: 'AABA', structure: JAZZ_FORMS['aaba'].structure, description: 'Classic AABA form — theme stated, varied, abandoned, returned.' };
    }

    if (sections.length >= 3) {
      return { form: 'ABA', structure: JAZZ_FORMS['aba'].structure, description: 'ABA form — thesis, antithesis, synthesis.' };
    }

    if (agentCount <= 2 && totalDuration > 60) {
      return { form: 'free', structure: JAZZ_FORMS['free'].structure, description: 'Free improvisation — two voices exploring freely.' };
    }

    return { form: 'through-composed', structure: JAZZ_FORMS['through-composed'].structure, description: 'Through-composed — the conversation writes its own structure.' };
  }

  /**
   * Segment the conversation into structural sections based on
   * density and sentiment changes.
   */
  segmentConversation() {
    if (this.allNotes.length === 0) return [];

    const WINDOW = 15; // seconds
    const sections = [];
    let currentSection = {
      start: 0,
      end: WINDOW,
      notes: [],
      avgSentiment: null,
      density: 0,
    };

    for (const note of this.allNotes) {
      if (note.start >= currentSection.end) {
        // Close current section
        currentSection.density = currentSection.notes.length / WINDOW;
        currentSection.avgSentiment = this._avgSentiment(currentSection.notes);
        sections.push(currentSection);

        // Start new section
        currentSection = {
          start: currentSection.end,
          end: currentSection.end + WINDOW,
          notes: [],
          avgSentiment: null,
          density: 0,
        };
      }
      currentSection.notes.push(note);
    }

    // Close final section
    if (currentSection.notes.length > 0) {
      currentSection.end = this.allNotes[this.allNotes.length - 1].start;
      currentSection.density = currentSection.notes.length / Math.max(1, currentSection.end - currentSection.start);
      currentSection.avgSentiment = this._avgSentiment(currentSection.notes);
      sections.push(currentSection);
    }

    return sections;
  }

  _avgSentiment(notes) {
    if (notes.length === 0) return 'neutral';
    const tally = {};
    for (const n of notes) tally[n.sentiment] = (tally[n.sentiment] || 0) + 1;
    return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * Identify agent roles in the conversation.
   */
  identifyRoles() {
    const roles = {};

    // Calculate longest consecutive run for each agent
    let lastAgent = null;
    let runStart = 0;
    for (const note of this.allNotes) {
      if (note.agent === lastAgent) {
        // continuing a run
      } else {
        if (lastAgent && this.agentStats[lastAgent]) {
          this.agentStats[lastAgent].longestRun =
            Math.max(this.agentStats[lastAgent].longestRun,
                     note.start - runStart);
        }
        lastAgent = note.agent;
        runStart = note.start;
      }
    }

    // Leader: speaks first or has most messages
    const firstSpeaker = this.allNotes[0]?.agent;
    const sortedByMessages = Object.values(this.agentStats)
      .sort((a, b) => b.noteCount - a.noteCount);

    if (firstSpeaker) {
      this.agentStats[firstSpeaker].isLeader = true;
      this.agentStats[firstSpeaker].role = JAZZ_ROLES.LEADER;
    }

    // Soloist: long average duration + high note count
    for (const agent of Object.values(this.agentStats)) {
      if (agent.noteCount >= 3 && agent.totalDuration / agent.noteCount > 3.0) {
        agent.isSoloist = true;
        if (!agent.role) agent.role = JAZZ_ROLES.SOLOIST;
      }
    }

    // Comping: short messages, supportive sentiment
    for (const agent of Object.values(this.agentStats)) {
      if (agent.noteCount >= 2 && agent.totalDuration / agent.noteCount < 1.5) {
        agent.isComping = true;
        if (!agent.role) agent.role = JAZZ_ROLES.COMPING;
      }
    }

    // Rhythm: many messages spread evenly over time
    for (const agent of Object.values(this.agentStats)) {
      if (agent.noteCount >= 5) {
        const times = agent.startTimes;
        const span = times[times.length - 1] - times[0];
        const density = agent.noteCount / Math.max(1, span / 60);
        if (density > 1 && !agent.role) {
          agent.role = JAZZ_ROLES.RHYTHM;
        }
      }
    }

    // Guest: 1-2 memorable messages
    for (const agent of Object.values(this.agentStats)) {
      if (agent.noteCount >= 1 && agent.noteCount <= 2) {
        agent.role = JAZZ_ROLES.GUEST;
      }
    }

    for (const [name, stats] of Object.entries(this.agentStats)) {
      roles[name] = {
        role: stats.role || JAZZ_ROLES.GUEST,
        noteCount: stats.noteCount,
        avgVelocity: stats.avgVelocity,
        avgPitch: stats.avgPitch,
        longestRun: Math.round(stats.longestRun * 10) / 10,
        dominantSentiment: this._avgSentiment(
          this.allNotes.filter(n => n.agent === name)
        ),
      };
    }

    return roles;
  }

  /**
   * Identify tension and release points.
   */
  analyzeTensionRelease() {
    const WINDOW = 10; // seconds
    const points = [];
    let lastTension = 0;

    for (let t = 0; t < this.data.duration; t += WINDOW / 2) {
      const windowNotes = this.allNotes.filter(n => n.start >= t && n.start < t + WINDOW);
      if (windowNotes.length === 0) continue;

      // Tension = average dissonance of sentiments
      let tension = 0;
      for (const note of windowNotes) {
        if (['frustrated', 'disagreeable', 'confused', 'anxious'].includes(note.sentiment)) {
          tension += 1;
        } else if (['concerned', 'contemplative'].includes(note.sentiment)) {
          tension += 0.5;
        } else if (['resolved', 'grateful', 'conciliatory'].includes(note.sentiment)) {
          tension -= 0.5;
        }
      }
      tension /= windowNotes.length;
      tension = Math.max(0, Math.min(1, tension + 0.3));

      points.push({
        time: Math.round(t * 10) / 10,
        tension: Math.round(tension * 100) / 100,
        direction: tension > lastTension + 0.05 ? 'rising' :
                   tension < lastTension - 0.05 ? 'falling' : 'stable',
        noteCount: windowNotes.length,
        dominantAgent: this._dominantAgent(windowNotes),
      });

      lastTension = tension;
    }

    // Identify key tension and release moments
    const peaks = points
      .filter(p => p.direction === 'falling' && p.tension < 0.3)
      .map(p => ({ ...p, type: 'release' }));

    const climaxes = points
      .filter(p => p.direction === 'rising' || p.tension > 0.6)
      .map(p => ({ ...p, type: 'tension' }));

    return {
      curve: points,
      peaks: climaxes.slice(0, 5),
      releases: peaks.slice(0, 5),
      avgTension: points.reduce((s, p) => s + p.tension, 0) / Math.max(1, points.length),
      climax: climaxes.sort((a, b) => b.tension - a.tension)[0] || null,
      resolution: peaks.sort((a, b) => a.tension - b.tension)[0] || null,
    };
  }

  _dominantAgent(notes) {
    const tally = {};
    for (const n of notes) tally[n.agent] = (tally[n.agent] || 0) + 1;
    return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  /**
   * Identify soloists — agents with the longest creative runs.
   */
  identifySoloists() {
    return Object.values(this.agentStats)
      .filter(a => a.isSoloist || (a.noteCount >= 3 && a.longestRun > 5))
      .sort((a, b) => b.longestRun - a.longestRun)
      .map(a => ({
        name: a.name,
        notes: a.noteCount,
        longestRunSeconds: Math.round(a.longestRun * 10) / 10,
        avgPitch: a.avgPitch,
        avgVelocity: a.avgVelocity,
        dominantSentiment: this._avgSentiment(
          this.allNotes.filter(n => n.agent === a.name)
        ),
      }));
  }

  /**
   * Identify comping — short supportive responses.
   */
  identifyComping() {
    return Object.values(this.agentStats)
      .filter(a => a.isComping)
      .sort((a, b) => b.noteCount - a.noteCount)
      .map(a => ({
        name: a.name,
        count: a.noteCount,
        avgDuration: Math.round((a.totalDuration / a.noteCount) * 100) / 100,
        avgVelocity: a.avgVelocity,
      }));
  }

  /**
   * Identify trading — rapid back-and-forth between two agents.
   */
  identifyTrades() {
    const trades = [];
    const TRADE_WINDOW = 5; // seconds between messages

    for (let i = 0; i < this.allNotes.length - 3; i++) {
      const a = this.allNotes[i];
      const b = this.allNotes[i + 1];
      const c = this.allNotes[i + 2];
      const d = this.allNotes[i + 3];

      // Pattern: A B A B with short intervals
      if (a.agent !== b.agent && a.agent === c.agent && b.agent === d.agent) {
        if (b.start - a.start < TRADE_WINDOW &&
            c.start - b.start < TRADE_WINDOW &&
            d.start - c.start < TRADE_WINDOW) {
          // Check we haven't already captured this trade
          if (!trades.some(t => Math.abs(t.time - a.start) < TRADE_WINDOW)) {
            trades.push({
              time: Math.round(a.start * 10) / 10,
              agents: [a.agent, b.agent],
              length: 4,
              direction: 'ascending', // could analyze pitch direction
            });
          }
        }
      }
    }

    return trades;
  }

  /**
   * Generate a jazz lead sheet text representation.
   */
  generateLeadSheet() {
    const key = this.identifyKey();
    const form = this.identifyForm();
    const roles = this.identifyRoles();
    const soloists = this.identifySoloists();
    const tension = this.analyzeTensionRelease();

    const lines = [];
    lines.push('╔═══════════════════════════════════════════════════════════╗');
    lines.push('║          TENSOR-MIDI JAZZ LEAD SHEET                     ║');
    lines.push('╚═══════════════════════════════════════════════════════════╝');
    lines.push('');
    lines.push(`Title: ${this.data.title}`);
    lines.push(`Room:  ${this.data.roomId}`);
    lines.push(`Key:   ${key.key} (${key.mode})`);
    lines.push(`Tempo: ${this.data.tempo} BPM`);
    lines.push(`Time:  ${this.data.timeSignature}`);
    lines.push(`Duration: ${this.data.duration}s`);
    lines.push(`Notes: ${this.data.noteCount} across ${this.data.trackCount} tracks`);
    lines.push('');
    lines.push('─── FORM ───');
    lines.push(`${form.form.toUpperCase()} — ${form.description}`);
    lines.push(`Structure: ${form.structure.join(' → ')}`);
    lines.push('');
    lines.push('─── PERSONNEL ───');
    for (const [name, role] of Object.entries(roles)) {
      lines.push(`  ${name.padEnd(12)} ${role.role.padEnd(16)} ${role.noteCount} notes, avg vel ${role.avgVelocity}`);
    }
    lines.push('');
    lines.push('─── SOLOS ───');
    if (soloists.length === 0) {
      lines.push('  (no extended solos)');
    } else {
      for (const s of soloists) {
        lines.push(`  ${s.name}: ${s.notes} notes, longest run ${s.longestRunSeconds}s (${s.dominantSentiment})`);
      }
    }
    lines.push('');
    lines.push('─── TENSION & RELEASE ───');
    if (tension.climax) {
      lines.push(`  Climax:    ${tension.climax.time}s (tension=${tension.climax.tension}, ${tension.climax.dominantAgent})`);
    }
    if (tension.resolution) {
      lines.push(`  Resolution: ${tension.resolution.time}s (tension=${tension.resolution.tension})`);
    }
    lines.push(`  Avg tension: ${Math.round(tension.avgTension * 100) / 100}`);
    lines.push('');

    const trades = this.identifyTrades();
    if (trades.length > 0) {
      lines.push('─── TRADES ───');
      for (const t of trades.slice(0, 10)) {
        lines.push(`  ${t.time}s: ${t.agents[0]} ↔ ${t.agents[1]} (${t.length} bars)`);
      }
      lines.push('');
    }

    lines.push('─── CHORD PROGRESSION (approximate) ───');
    lines.push(this.generateChordProgression(key, form));
    lines.push('');
    lines.push('─────────────────────────────────────────────');
    lines.push('End of lead sheet.');

    return lines.join('\n');
  }

  /**
   * Generate an approximate chord progression.
   */
  generateChordProgression(key, form) {
    const isMinor = key.mode === 'minor';

    if (isMinor) {
      const progression = {
        'blues': ['Im7', 'IVm7', 'Im7', 'v7', 'Im7', 'IVm7', 'Im7', 'v7', 'Im7', 'IVm7', 'v7', 'I7'],
        'ABA': ['Im7', 'IVm7', 'bVIImaj7', 'Im7', 'Im7', 'IVm7', 'bVIImaj7', 'Im7', 'bIIImaj7', 'bVImaj7', 'bIImaj7', 'V7alt', 'Im7', 'IVm7', 'bVIImaj7', 'Im7'],
        'AABA': ['Im7', 'IVm7', 'bVIImaj7', 'Im7', 'Im7', 'IVm7', 'bVIImaj7', 'Im7', 'bIImaj7', 'V7alt', 'Im7', 'IV7', 'Im7', 'IVm7', 'bVIImaj7', 'Im7'],
        'free': ['Free harmony — no fixed progression'],
        'through-composed': ['Im7', 'bVImaj7', 'bIIImaj7', 'V7alt', 'Im7'],
      };
      return (progression[form.form] || progression['through-composed']).join(' | ');
    }

    const progression = {
      'blues': ['I7', 'IV7', 'I7', 'V7', 'I7', 'IV7', 'I7', 'V7', 'I7', 'IV7', 'V7', 'I7'],
      'ABA': ['Imaj7', 'ii7', 'V7', 'Imaj7', 'Imaj7', 'ii7', 'V7', 'Imaj7', 'IVmaj7', 'VII7', 'ii7', 'V7', 'Imaj7', 'ii7', 'V7', 'Imaj7'],
      'AABA': ['Imaj7', 'ii7', 'V7', 'Imaj7', 'Imaj7', 'ii7', 'V7', 'Imaj7', 'IVmaj7', 'VII7', 'iii7', 'vi7', 'Imaj7', 'ii7', 'V7', 'Imaj7'],
      'free': ['Free harmony — no fixed progression'],
      'through-composed': ['Imaj7', 'IVmaj7', 'vii7b5', 'iii7', 'vi7', 'ii7', 'V7', 'Imaj7'],
      'ABAC': ['Imaj7', 'ii7', 'V7', 'Imaj7', 'IVmaj7', 'VII7', 'Imaj7', 'vi7', 'Imaj7', 'ii7', 'V7', 'Imaj7', 'IVmaj7', '#IVdim7', 'Imaj7', 'V7'],
    };
    return (progression[form.form] || progression['through-composed']).join(' | ');
  }

  /**
   * Generate a human-readable summary.
   */
  generateSummary() {
    const key = this.identifyKey();
    const form = this.identifyForm();
    const soloists = this.identifySoloists();
    const tension = this.analyzeTensionRelease();

    const parts = [];
    parts.push(`A ${form.form} conversation in ${key.key} at ${this.data.tempo} BPM.`);
    parts.push(`${this.data.noteCount} messages across ${this.data.trackCount} participants over ${this.data.duration}s.`);

    if (soloists.length > 0) {
      parts.push(`${soloists[0].name} took the longest solo (${soloists[0].longestRunSeconds}s).`);
    }

    if (tension.climax && tension.resolution) {
      parts.push(`Tension peaked at ${tension.climax.time}s and resolved at ${tension.resolution.time}s.`);
    }

    parts.push(`Dominant sentiment: ${key.dominantSentiment}.`);

    return parts.join(' ');
  }
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = { JazzAnalyzer, JAZZ_FORMS, JAZZ_ROLES };
