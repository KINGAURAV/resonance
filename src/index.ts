import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { DrumSystem } from './systems/drums.js';
import { GuitarSystem } from './systems/guitar.js';
import { LooperSystem } from './systems/looper.js';
import { PlaygroundSystem } from './systems/playground.js';
import { ResonatorSystem } from './systems/resonators.js';
import { SequencerSystem } from './systems/sequencer.js';
import { StringSystem } from './systems/string.js';
import { UISystem } from './systems/ui.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // Order matters: the playground creates the root the others attach to,
  // and the UI system reveals objects the earlier systems created.
  world.registerSystem(PlaygroundSystem);
  world.registerSystem(ResonatorSystem);
  world.registerSystem(StringSystem);
  world.registerSystem(SequencerSystem);
  world.registerSystem(DrumSystem);
  world.registerSystem(GuitarSystem);
  world.registerSystem(LooperSystem);
  world.registerSystem(UISystem);
});
