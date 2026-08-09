/**
 * Platonic Randomness Game Engine — Demo
 *
 * Runs a short 3-player, 3-turn session and prints the narrative.
 * Demonstrates SWMIDI input, Platonic-solid orbits, evolving board
 * positions, and coupled data+narrative output.
 */

import { PlatonicEngine } from './platonic-engine.js';

const engine = new PlatonicEngine('demo-seed');

engine.addPlayer(1, 'Alice');
engine.addPlayer(2, 'Bob');
engine.addPlayer(3, 'Carol');

console.log('═══ PLATONIC RANDOMNESS GAME ENGINE ═══\n');

const systems = ['combat', 'social', 'resource', 'exploration'];

for (let turn = 0; turn < 3; turn++) {
  console.log(`--- Turn ${turn + 1} ---`);

  for (const playerId of [1, 2, 3]) {
    for (const system of systems) {
      const intensity = 40 + Math.floor(Math.random() * 60);
      const tick = turn * 576 + playerId * 48 + systems.indexOf(system) * 12;
      const { narrative } = engine.processEvent(
        PlatonicEngine.encodeGameEvent(system, playerId, intensity, tick)
      );
      console.log(narrative);
    }
  }

  // Weather once per turn
  const weatherTick = turn * 576 + 300;
  const { narrative: weatherNarrative } = engine.processEvent(
    PlatonicEngine.encodeGameEvent('weather', 0, 30, weatherTick)
  );
  console.log(weatherNarrative);

  // End turn
  engine.processEvent(PlatonicEngine.encodeMetaEvent('turnEnd', turn * 576 + 576));
}

console.log('\n═══ FINAL STATE ═══');
const { result: state, narrative: stateNarrative } = engine.processEvent(
  PlatonicEngine.encodeMetaEvent('stateQuery')
);
console.log(stateNarrative);
console.log('\nOrbits:', state.orbits);
console.log('Weather index:', state.positions.weather.findIndex((p) => p.value > 0));
