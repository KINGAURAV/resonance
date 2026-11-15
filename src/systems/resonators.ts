/**
 * ResonatorSystem: the five touchable sound objects.
 *  - poke with a fingertip or pinch-ray  -> plays its note
 *  - pinch-grab and lift/lower           -> picks the note (height = pitch)
 *  - release near an orbit slot          -> docks into the sequencer
 */
import {
  BoxGeometry,
  ConeGeometry,
  createSystem,
  Grabbed,
  Group,
  Hovered,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  OneHandGrabbable,
  Pressed,
  RayInteractable,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  VisibilityState,
  type BufferGeometry,
} from '@iwsdk/core';
import { audio, type VoiceKind } from '../audio/engine.js';
import { MAX_NOTE, noteFreq, noteName } from '../audio/scale.js';
import { Resonator } from '../resonance-components.js';
import { COLORS, grabOnly, LAYOUT, setShown, slotPosition, stage, trace, type ResonatorState } from '../stage.js';
import { glowSprite, Label } from '../visuals/textures.js';

const DEFS: { kind: VoiceKind; name: string; color: number; geo: () => BufferGeometry }[] = [
  { kind: 'soft', name: 'Sphere', color: COLORS.cyan, geo: () => new SphereGeometry(0.027, 24, 16) },
  { kind: 'perc', name: 'Cube', color: COLORS.magenta, geo: () => new BoxGeometry(0.042, 0.042, 0.042) },
  { kind: 'bell', name: 'Ring', color: COLORS.gold, geo: () => new TorusGeometry(0.025, 0.009, 12, 32) },
  { kind: 'bass', name: 'Pyramid', color: COLORS.violet, geo: () => new ConeGeometry(0.034, 0.05, 4) },
  { kind: 'air', name: 'Crystal', color: COLORS.mint, geo: () => new OctahedronGeometry(0.03, 0) },
];

const DOCK_RADIUS = 0.07;
/** Fingertip distances (m) that count as touching / having left. */
const TOUCH_IN = 0.04;
const TOUCH_OUT = 0.062;
const RETRIGGER_SECONDS = 0.14;
const tmp = new Vector3();
const tmp2 = new Vector3();

/** Note for a root-local height. */
function noteAtHeight(y: number): number {
  const n = Math.round((y - LAYOUT.noteBase) / LAYOUT.noteStep);
  return Math.min(MAX_NOTE, Math.max(0, n));
}

/** Staircase arc: left-to-right and low-to-high = C D E G A. */
export function homePosition(id: number, out: Vector3): Vector3 {
  const x = -0.24 + id * 0.12;
  const edge = Math.abs(x) / 0.24;
  return out.set(x, LAYOUT.noteBase + id * LAYOUT.noteStep, -0.06 + 0.1 * edge * edge);
}

/** Visual response only (glow, ripple, particles). */
export function flashResonator(r: ResonatorState, strength = 1): void {
  r.pulse = Math.max(r.pulse, strength);
  const p = r.object.position;
  stage.ripple(p.x, p.y, p.z, r.color, r.kind === 'bass' ? 0.34 : 0.2);
  stage.burst(p.x, p.y, p.z, r.color, r.kind === 'air' ? 16 : 10);
}

/** Sound only, at an exact audio-clock time (used by the sequencer). */
export function soundResonator(r: ResonatorState, when = 0, velocity = 0.85): void {
  r.object.getWorldPosition(tmp);
  audio.play(r.kind, noteFreq(r.note), { when, velocity, x: tmp.x, y: tmp.y, z: tmp.z });
}

export function setNote(r: ResonatorState, note: number): void {
  r.note = note;
  r.label.set(noteName(note));
}

/** Send a resonator back to its starting place and default note. */
export function resetResonator(r: ResonatorState): void {
  if (r.slot >= 0) stage.slots[r.slot] = -1;
  r.slot = -1;
  r.rest.copy(r.home);
  setNote(r, r.id);
}

export function dockResonator(r: ResonatorState, slot: number): void {
  if (r.slot >= 0) stage.slots[r.slot] = -1;
  r.slot = slot;
  if (slot >= 0) {
    stage.slots[slot] = r.id;
    slotPosition(slot, r.rest);
  }
}

export class ResonatorSystem extends createSystem({
  pressed: { required: [Resonator, Pressed] },
  hovered: { required: [Resonator, Hovered] },
  held: { required: [Resonator, Grabbed] },
}) {
  private tip = [new Vector3(), new Vector3()];
  private prevTip = [new Vector3(), new Vector3()];
  private tipSpeed = [0, 0];
  /** armed[hand * 5 + id]: finger must leave before it can strike again. */
  private armed = new Uint8Array(2 * DEFS.length).fill(1);
  private grabTime = new Float64Array(DEFS.length);
  private grabSlot = new Int8Array(DEFS.length).fill(-1);

  init(): void {
    DEFS.forEach((def, id) => {
      const object = new Group();
      object.name = `Resonator ${def.name}`;
      const body = new Mesh(
        def.geo(),
        new MeshStandardMaterial({
          color: def.color,
          emissive: def.color,
          emissiveIntensity: 0.55,
          transparent: true,
          opacity: 0.88,
          roughness: 0.15,
          metalness: 0.25,
        }),
      );
      if (def.kind === 'air') body.scale.y = 1.45;
      const halo = glowSprite(def.color, 0.11, 0.5);
      const label = new Label(noteName(id), 0.02);
      label.sprite.position.y = 0.056;
      object.add(body, halo, label.sprite);

      const home = homePosition(id, new Vector3());
      object.position.copy(home);
      const entity = this.world.createTransformEntity(object, { parent: stage.rootEntity! });
      entity.addComponent(Resonator, { id });
      entity.addComponent(RayInteractable);
      entity.addComponent(OneHandGrabbable, {});

      const state: ResonatorState = {
        id, kind: def.kind, color: def.color, note: id, entity, object, body, halo, label,
        rest: home.clone(), home, slot: -1, pulse: 0, lastHit: -1, held: false, shown: false,
      };
      stage.resonators.push(state);
      setShown(object, false);
    });

    const stateOf = (entity: { getValue: (c: typeof Resonator, k: 'id') => number | null }) =>
      stage.resonators[entity.getValue(Resonator, 'id') ?? 0];

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (entity) => {
        // Mouse / desktop preview path. In VR, fingertips strike directly.
        this.strike(stateOf(entity), 0.85);
      }),
      this.queries.held.subscribe('qualify', (entity) => {
        const r = stateOf(entity);
        r.held = true;
        this.grabTime[r.id] = performance.now();
        this.grabSlot[r.id] = r.slot;
        audio.start();
        if (r.slot >= 0) {
          stage.slots[r.slot] = -1;
          r.slot = -1;
        }
      }),
      this.queries.held.subscribe('disqualify', (entity) => {
        const r = stateOf(entity);
        r.held = false;
        this.release(r);
      }),
    );
  }

  private strike(r: ResonatorState, velocity: number): void {
    const now = performance.now() / 1000;
    if (!r.shown || now - r.lastHit < RETRIGGER_SECONDS) return; // debounce
    r.lastHit = now;
    audio.start();
    soundResonator(r, 0, velocity);
    flashResonator(r, 0.5 + velocity * 0.5);
    trace('strike', r.kind, r.note, velocity.toFixed(2), 'audio', audio.running);
    stage.onNote(r.id);
  }

  /** Fingertip strikes: faster touches play louder. */
  private detectTouches(dt: number): void {
    const sides = ['left', 'right'] as const;
    for (let h = 0; h < 2; h++) {
      const tip = this.tip[h];
      this.player.indexTipSpaces[sides[h]].getWorldPosition(tip);
      stage.root.worldToLocal(tip);
      // Hand poses update less often than frames render: smooth the speed.
      const raw = tip.distanceTo(this.prevTip[h]) / Math.max(dt, 0.001);
      this.tipSpeed[h] += (Math.min(raw, 4) - this.tipSpeed[h]) * 0.4;
      this.prevTip[h].copy(tip);
      for (const r of stage.resonators) {
        if (!r.shown) continue;
        const d = tip.distanceTo(r.object.position);
        const k = h * DEFS.length + r.id;
        if (d > TOUCH_OUT) this.armed[k] = 1;
        else if (d < TOUCH_IN && this.armed[k] && !r.held) {
          this.armed[k] = 0;
          this.strike(r, Math.min(1, Math.max(0.4, this.tipSpeed[h] / 0.8)));
        }
      }
    }
  }

  /** Nearest free sequencer slot within reach of a position, or -1. */
  private nearestSlot(p: Vector3): number {
    if (stage.tutorialStep < 2) return -1;
    let best = -1;
    let bestD = DOCK_RADIUS;
    for (let s = 0; s < stage.slots.length; s++) {
      if (stage.slots[s] >= 0) continue;
      const d = slotPosition(s, tmp2).distanceTo(p);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private release(r: ResonatorState): void {
    const p = r.object.position;
    // A grab shorter than a quarter second is an accidental brush while
    // tapping: put the object back exactly where it was.
    if (performance.now() - this.grabTime[r.id] < 250) {
      const prev = this.grabSlot[r.id];
      if (prev >= 0 && stage.slots[prev] < 0) dockResonator(r, prev);
      return;
    }
    const slot = this.nearestSlot(p);
    if (slot >= 0) {
      dockResonator(r, slot);
      trace('dock', r.kind, 'slot', slot);
      flashResonator(r, 0.8);
      soundResonator(r, 0, 0.6);
      stage.onDock();
      return;
    }
    // Float where it was let go, kept inside the seated reach zone.
    r.rest.set(
      Math.min(0.42, Math.max(-0.42, p.x)),
      Math.min(LAYOUT.noteBase + MAX_NOTE * LAYOUT.noteStep, Math.max(LAYOUT.noteBase, p.y)),
      Math.min(0.3, Math.max(-0.3, p.z)),
    );
    setNote(r, noteAtHeight(r.rest.y));
    trace('float', r.kind, 'note', r.note);
    r.rest.y = LAYOUT.noteBase + r.note * LAYOUT.noteStep; // settle onto the note's height
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    const ease = 1 - Math.exp(-dt * 9);
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      this.detectTouches(delta);
    }
    for (const r of stage.resonators) {
      if (!r.shown) continue;
      const obj = r.object;
      grabOnly(obj);
      if (r.held) {
        // While carried: preview which note this height (or slot) will give.
        if (this.nearestSlot(obj.position) < 0) {
          const n = noteAtHeight(obj.position.y);
          if (n !== r.note) {
            setNote(r, n);
            soundResonator(r, 0, 0.35);
            r.pulse = Math.max(r.pulse, 0.5);
          }
        }
      } else {
        const bob = r.slot < 0 ? Math.sin(time * 1.4 + r.id * 1.7) * 0.004 : 0;
        obj.position.x += (r.rest.x - obj.position.x) * ease;
        obj.position.y += (r.rest.y + bob - obj.position.y) * ease;
        obj.position.z += (r.rest.z - obj.position.z) * ease;
        obj.rotation.x += (0 - obj.rotation.x) * ease;
        obj.rotation.z += (0 - obj.rotation.z) * ease;
        obj.rotation.y += dt * (0.4 + r.pulse * 4);
      }
      r.pulse = Math.max(0, r.pulse - dt * 2.6);
      const hovered = r.entity.hasComponent(Hovered) || r.held;
      const mat = (r.body as Mesh).material as MeshStandardMaterial;
      // Each resonator listens to "its" band so the group moves in sympathy.
      const band = r.kind === 'bass' ? audio.bass : r.kind === 'soft' ? audio.mid : audio.high;
      mat.emissiveIntensity = 0.55 + r.pulse * 1.6 + band * 0.5 + (hovered ? 0.5 : 0);
      const s = 1 + r.pulse * 0.32 + band * 0.08;
      r.body.scale.set(s, r.kind === 'air' ? s * 1.45 : s, s);
      r.halo.scale.setScalar(0.1 + r.pulse * 0.16 + (hovered ? 0.035 : 0));
    }
  }
}
