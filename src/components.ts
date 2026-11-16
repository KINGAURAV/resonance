import { defineComponents } from '@iwsdk/core';
import { DrumPad, GuitarChord, GlideNote, GuitarStrum, LatticeCell, Pebble, Resonator, StringBody, StringHandle } from './resonance-components.js';

export default defineComponents([Resonator, Pebble, StringHandle, StringBody, DrumPad, GuitarChord, GuitarStrum, LatticeCell, GlideNote]);
