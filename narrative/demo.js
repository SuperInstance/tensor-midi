// ═══════════════════════════════════════════════════════════════════
// NARRATIVE ENGINE — Demo
// ═══════════════════════════════════════════════════════════════════
//
// Runs a captured session through the narrative engine and prints the
// story it tells. The session file has full message text and a
// numeric sentiment label per note — but neither is passed to the
// engine. Only the wire fields are: channel, pitch, velocity, tick,
// and an errorMask synthesized here from sentiment, standing in for
// what a live capture's friction bitfield would carry. The engine
// never sees a word of what anyone said.
//
// Usage: node narrative/demo.js [session-file-basename]
//   Defaults to session-001-relay-bridge-fix.json (has real friction —
//   a bug gets found, fought, and fixed).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NarrativeEngine } from './narrative-engine.js';
import { Friction } from '../src/swmidi.js';
import { timeToTick } from '../src/engine.js';

const SENTIMENT_TO_FRICTION = {
  frustrated: Friction.Conflict | Friction.Timeout,
  confused: Friction.Ambiguity,
  concerned: Friction.Timeout,
};

function loadSession(basename) {
  const path = fileURLToPath(new URL(`../data/sessions/${basename}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sessionToEvents(session) {
  return session.notes.map((note) => ({
    channel: note.channel,
    pitch: note.pitch,
    velocity: note.velocity,
    errorMask: SENTIMENT_TO_FRICTION[note.sentiment] || 0,
    tick: timeToTick(note.start * 1000, session.tempo),
  }));
}

function main() {
  const basename = process.argv[2] || 'session-001-relay-bridge-fix.json';
  const session = loadSession(basename);
  const voices = Object.fromEntries(session.agents.map((a) => [a.channel, a.name]));
  const events = sessionToEvents(session).sort((a, b) => a.tick - b.tick);

  console.log('═'.repeat(72));
  console.log(session.title.toUpperCase());
  console.log(session.metadata?.weather || '');
  console.log('═'.repeat(72));
  console.log('');

  const engine = new NarrativeEngine({ voices });

  for (const event of events) {
    console.log(engine.beat(event));
    let chapter;
    while ((chapter = engine.chapter()) !== null) {
      console.log('');
      console.log(`  ${chapter}`);
      console.log('');
    }
  }

  const { chapters, summary } = engine.epilogue();
  for (const chapter of chapters) {
    console.log('');
    console.log(`  ${chapter}`);
  }
  console.log('');
  console.log('─'.repeat(72));
  console.log(summary);
}

main();
