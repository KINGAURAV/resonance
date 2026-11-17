/**
 * Shared, system-agnostic state for THE PLAYGROUND. Systems talk to each
 * other through this object instead of importing one another.
 */
import { Group, Vector3, type Entity, type Object3D } from '@iwsdk/core';
import type { VoiceKind } from './audio/engine.js';
import type { Label } from './visuals/textures.js';

export type StudioMode = 'playground' | 'drums' | 'guitar' | 'lattice' | 'glide';

export const COLORS = {
  cyan: 0x35e0ff,
  violet: 0x8a5cff,
  magenta: 0xff4fd8,
  gold: 0xffc86b,
  mint: 0x6bffc0,
};

/** Layout constants, in meters, relative to the playground root. */
export const LAYOUT = {
  /** Root sits this far in front of / below the seated player's head. */
  forward: 0.48,
  below: 0.42,
  ringRadii: [0.12, 0.2],
  ringTilt: 0.35, // radians; the near edge dips toward the player
  steps: 8,
  /** Height band that maps to the ten selectable notes. */
  noteBase: 0.05,
  noteStep: 0.032,
};

export interface ResonatorState {
  id: number;
  kind: VoiceKind;
  color: number;
  note: number;
  entity: Entity;
  object: Object3D;
  /** Visual body that pulses; children of `object`. */
  body: Object3D;
  halo: Object3D;
  label: Label;
  /** Where the object rests when not held (root-local). */
  rest: Vector3;
  home: Vector3;
  /** Sequencer slot index (ring * steps + step) or -1 when floating free. */
  slot: number;
  pulse: number;
  lastHit: number;
  held: boolean;
  shown: boolean;
}

export const stage = {
  root: new Group(),
  /** One pivot per instrument, fanned out around the player's seat. */
  stations: {} as Record<StudioMode, Group>,
  stationEntities: {} as Record<StudioMode, Entity>,
  /** Pebbles ride on this pivot, which swings to the active station. */
  uiStation: new Group(),
  uiEntity: null as Entity | null,
  /** True in VR once the intro is done: every instrument is visible at once. */
  showAll: false,
  /** Desktop preview only: the arc is spun so the active station faces you. */
  carousel: 0,
  rootEntity: null as Entity | null,
  resonators: [] as ResonatorState[],
  /** Slot -> resonator id, or -1. */
  slots: new Int8Array(LAYOUT.steps * LAYOUT.ringRadii.length).fill(-1),
  /** Which instrument space is showing. */
  mode: 'playground' as StudioMode,
  playing: true,
  /** Built-in drum groove synced to the sequencer. */
  beat: false,
  /** Root-local positions of the two string ends. */
  stringEnds: [new Vector3(-0.13, 0.02, 0.25), new Vector3(0.13, 0.02, 0.25)],
  bpm: 96,
  /** One-line looper state for the studio status line. */
  loopStatus: 'Loop: empty',
  /** Tutorial step: 0 touch, 1 string, 2 sequencer, 3 free play. */
  tutorialStep: 0,
  /** Simple event hooks (set by the systems that own the behaviour). */
  onNote: (_id: number) => {},
  onPluck: () => {},
  onDock: () => {},
  ripple: (_x: number, _y: number, _z: number, _color: number, _size: number) => {},
  burst: (_x: number, _y: number, _z: number, _color: number, _count: number) => {},
  toast: (_text: string) => {},
  /** Extra pebble actions registered by other systems (action -> handler). */
  actions: {} as Record<string, () => void>,
  setPebbleLabel: (_action: string, _text: string) => {},
  setMode: (_mode: StudioMode) => {},
};

/** Root-local position of a sequencer slot. */
export function slotPosition(slot: number, out: Vector3): Vector3 {
  const ring = Math.floor(slot / LAYOUT.steps);
  const step = slot % LAYOUT.steps;
  // Step 0 sits at the front (nearest the player); steps advance clockwise.
  const a = (step / LAYOUT.steps) * Math.PI * 2;
  const r = LAYOUT.ringRadii[ring];
  const x = Math.sin(a) * r;
  const flatZ = Math.cos(a) * r;
  out.set(x, -flatZ * Math.sin(LAYOUT.ringTilt), flatZ * Math.cos(LAYOUT.ringTilt));
  return out;
}

/** Hide/show an object so hidden things can be neither seen nor touched. */
export function setShown(obj: Object3D, shown: boolean): void {
  obj.visible = shown;
  obj.scale.setScalar(shown ? 1 : 0.0001);
}

/**
 * Grabbable objects must ignore the fingertip "touch" pointer, otherwise a
 * poke drags them around. Rays are denied too so far pinches never tug them.
 */
export const GRAB_ONLY = { deny: ['ray', 'touch'] };

export function grabOnly(obj: Object3D): void {
  const o = obj as Object3D & { pointerEventsType?: unknown };
  // The grab system assigns its own filter when it builds the handle, so
  // this is re-checked each frame (a pointer comparison, no allocation).
  if (o.pointerEventsType !== GRAB_ONLY) o.pointerEventsType = GRAB_ONLY;
}

/** Development-only event trace (stripped from production builds). */
export function trace(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log('[resonance]', ...args);
}

export const MODES: StudioMode[] = ['playground', 'drums', 'guitar', 'lattice', 'glide'];

/** Where each instrument sits around the seat (radians; positive = left). */
export const STATION_ANGLE: Record<StudioMode, number> = {
  playground: 0,
  // Spaced by each instrument's width so neighbours never overlap.
  drums: 1.35,
  guitar: -1.45,
  lattice: 2.5,
  glide: -2.65,
};

export const STATION_NAME: Record<StudioMode, string> = {
  playground: 'Playground',
  drums: 'Drums',
  guitar: 'Guitar',
  lattice: 'Lattice',
  glide: 'Glide synth',
};

/** Swing a pivot around the player's seat (which is LAYOUT.forward behind the root). */
export function placeStation(g: Group, angle: number): void {
  const f = LAYOUT.forward;
  g.rotation.y = angle;
  g.position.set(-f * Math.sin(angle), 0, f - f * Math.cos(angle));
}

const fxTmp = new Vector3();
/** Ripple + sparks at a position given in a station's own coordinates. */
export function fxAt(station: Group, x: number, y: number, z: number, color: number, ripple: number, sparks: number): void {
  station.updateMatrix();
  fxTmp.set(x, y, z).applyMatrix4(station.matrix);
  if (ripple > 0) stage.ripple(fxTmp.x, fxTmp.y, fxTmp.z, color, ripple);
  if (sparks > 0) stage.burst(fxTmp.x, fxTmp.y, fxTmp.z, color, sparks);
}
