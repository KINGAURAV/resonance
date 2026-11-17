/**
 * UISystem: floating control pebbles, the guided intro, and the 2D title
 * overlay. There are no flat panels: every control is a small glowing object
 * you poke with a fingertip (or pinch-ray from a distance).
 */
import {
  createSystem,
  Group,
  Hovered,
  Mesh,
  MeshStandardMaterial,
  PokeInteractable,
  Pressed,
  RayInteractable,
  SphereGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { loadComposition, saveComposition } from '../composition.js';
import { Pebble } from '../resonance-components.js';
import { COLORS, MODES, setShown, stage, STATION_ANGLE, STATION_NAME, trace, type StudioMode } from '../stage.js';
import { glowSprite, Label } from '../visuals/textures.js';
import { resetResonator } from './resonators.js';

interface PebbleState {
  action: string;
  mode: PebbleMode;
  object: Group;
  mat: MeshStandardMaterial;
  label: Label;
  pulse: number;
}

// Stations from left to right, for the desktop arrow pebbles.
const ARC: StudioMode[] = ['lattice', 'drums', 'playground', 'guitar', 'glide'];
const DONE_KEY = 'resonance.introDone';
const CONFIRM_MS = 3000;
const HINTS = ['Touch to create sound', 'Grab. Stretch. Pluck.', 'Create your rhythm: drop a shape on an orbit', ''];

// Left column = performance, right column = composition.
// [action, label, side, grid cell, mode it belongs to]
type PebbleMode = 'playground' | 'drums' | 'guitar' | 'lattice' | 'glide' | 'studio' | 'all'; // studio = any instrument
const PEBBLES: [string, string, number, number, PebbleMode][] = [
  ['play', 'Pause', -1, 0, 'playground'],
  ['beat', 'Beat', -1, 1, 'playground'],
  ['slower', 'Slower', -1, 2, 'playground'],
  ['faster', 'Faster', -1, 3, 'playground'],
  ['save', 'Save', 1, 0, 'playground'],
  ['load', 'Load', 1, 1, 'playground'],
  ['clear', 'Reset', 1, 2, 'playground'],
  ['intro', 'Skip intro', 1, 3, 'playground'],
  ['glideChord', 'Chords: off', 1, 4, 'glide'],
  ['arp', 'Arp: off', 1, 4, 'lattice'],
  ['arpClear', 'Clear notes', 1, 2, 'lattice'],
  ['learn', 'Learn a beat', 1, 4, 'drums'],
  ['learnGuitar', 'Learn a song', 1, 4, 'guitar'],
  ['prev', '< Instrument', -1, 6, 'all'],
  ['next', 'Instrument >', 1, 6, 'all'],
  ['loop', 'Record loop', -1, 4, 'all'],
  ['loopClear', 'Clear loop', -1, 5, 'all'],
  ['loopUndo', 'Undo layer', 1, 5, 'all'],
  ['snap', 'Snap: on', -1, 7, 'all'],
];

export class UISystem extends createSystem({
  pressed: { required: [Pebble, Pressed] },
}) {
  private pebbles: PebbleState[] = [];
  private hint!: Label;
  private hintAlpha = 0;
  private advanceIn = -1; // seconds until the tutorial moves on
  private lastPress = 0;
  private wasImmersive = false;
  private look = new Vector3();
  private clearArmedAt = -1; // Reset needs a second tap within CONFIRM_MS
  private statusTop!: Label;
  private statusLoop!: Label;
  private statusIn = 0;

  init(): void {
    const geo = new SphereGeometry(0.017, 20, 14);
    for (const [action, text, side, row, mode] of PEBBLES) {
      const object = new Group();
      object.name = `Pebble ${action}`;
      const color = mode === 'all' ? 0xff5a6e : mode !== 'playground' || action === 'drums' || action === 'guitar' || action === 'lattice' || action === 'glide' ? COLORS.gold : side < 0 ? COLORS.cyan : COLORS.violet;
      const mat = new MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.5,
        transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.2,
      });
      const mesh = new Mesh(geo, mat);
      mesh.scale.y = 0.6;
      const label = new Label(text, 0.017);
      label.sprite.position.y = 0.034;
      object.add(mesh, glowSprite(color, 0.06, 0.45), label.sprite);
      // 2x2 grid per side, all at the same depth, so reaching for one pebble
      // never sweeps a finger through another.
      object.position.set(
        side * (0.3 + (row % 2) * 0.075),
        0.02 + Math.floor(row / 2) * 0.075,
        0.1,
      );
      const e = this.world.createTransformEntity(object, { parent: stage.uiEntity! });
      e.addComponent(Pebble, { action });
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
      this.pebbles.push({ action, mode, object, mat, label, pulse: 0 });
    }

    this.hint = new Label('', 0.024, '#ffffff');
    stage.root.add(this.hint.sprite);

    // Studio status line: high and small, above every instrument's controls.
    this.statusTop = new Label('', 0.032, '#ffffff');
    this.statusTop.sprite.position.set(0, 0.38, -0.05);
    this.statusLoop = new Label('', 0.026, '#ffd6de');
    this.statusLoop.sprite.position.set(0, 0.345, -0.05);
    stage.uiStation.add(this.statusTop.sprite, this.statusLoop.sprite);

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (entity) => {
        const now = performance.now();
        if (now - this.lastPress < 250) return; // one press per poke
        this.lastPress = now;
        audio.start();
        this.run(entity.getValue(Pebble, 'action') ?? '');
      }),
    );

    // Tutorial progress hooks.
    stage.onNote = () => this.progress(0, 1.4);
    stage.onPluck = () => this.progress(1, 1.8);
    stage.onDock = () => this.progress(2, 2.5);
    stage.setPebbleLabel = (action, text) =>
      this.pebbles.find((x) => x.action === action)?.label.set(text);
    stage.setMode = (mode) => {
      stage.mode = mode;
      this.applyVisibility();
    };

    let done = false;
    try {
      done = localStorage.getItem(DONE_KEY) === '1';
    } catch {
      /* storage unavailable: just show the intro */
    }
    this.setStep(done ? 3 : 0);
    this.setupOverlay();
  }

  /** Title screen shown before entering VR. */
  private setupOverlay(): void {
    const overlay = document.getElementById('overlay');
    const enter = document.getElementById('enter-vr');
    const preview = document.getElementById('preview');
    if (!overlay || !enter || !preview) return;
    if (!this.world.xrEnabled) enter.style.display = 'none';
    enter.addEventListener('click', () => {
      audio.start();
      void this.world.launchXR();
    });
    preview.addEventListener('click', () => {
      audio.start();
      overlay.style.display = 'none';
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        if (s !== VisibilityState.NonImmersive) overlay.style.display = 'none';
      }),
    );
  }

  private progress(fromStep: number, delay: number): void {
    if (stage.tutorialStep === fromStep && this.advanceIn < 0) this.advanceIn = delay;
  }

  private setStep(step: number): void {
    stage.tutorialStep = step;
    this.advanceIn = -1;
    this.hint.set(HINTS[step]);
    this.applyVisibility();
    if (step >= 3) {
      try {
        localStorage.setItem(DONE_KEY, '1');
      } catch {
        /* ignore */
      }
      stage.toast('Turn your head to find more instruments');
    }
  }

  /** Show only what belongs to the current mode and intro step. */
  private applyVisibility(): void {
    const step = stage.tutorialStep;
    const play = stage.mode === 'playground';
    // Reveal things progressively so there is only ever one new idea.
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    stage.resonators.forEach((r, i) => {
      r.shown = (play || stage.showAll) && (step >= 2 || i === 0);
      setShown(r.object, r.shown);
    });
    for (const p of this.pebbles) {
      const inMode = p.mode === stage.mode || p.mode === 'all' || (p.mode === 'studio' && !play);
      // Arrow pebbles replace head-turning in the flat desktop preview.
      const arrow = p.action === 'prev' || p.action === 'next';
      setShown(p.object, arrow ? !immersive && step >= 3 : inMode && (!play || step >= 3 || p.action === 'intro'));
      if (p.action === 'intro') p.label.set(step >= 3 ? 'Replay intro' : 'Skip intro');
    }
  }

  private run(action: string): void {
    const p = this.pebbles.find((x) => x.action === action);
    if (p) {
      p.pulse = 1;
      stage.ripple(p.object.position.x, p.object.position.y, p.object.position.z, COLORS.cyan, 0.1);
    }
    trace('ui', action, 'slots', Array.from(stage.slots).join(','));
    switch (action) {
      case 'play':
        stage.playing = !stage.playing;
        p?.label.set(stage.playing ? 'Pause' : 'Play');
        break;
      case 'beat':
        stage.beat = !stage.beat;
        stage.toast(stage.beat ? 'Beat on' : 'Beat off');
        break;
      case 'slower':
      case 'faster':
        stage.bpm = Math.min(160, Math.max(60, stage.bpm + (action === 'faster' ? 8 : -8)));
        stage.toast(`${stage.bpm} BPM`);
        break;
      case 'save':
        stage.toast(saveComposition() ? 'Composition saved' : 'Could not save');
        break;
      case 'load':
        stage.toast(loadComposition() ? 'Composition loaded' : 'Nothing saved yet');
        break;
      case 'clear':
        // Two taps: a stray poke should never wipe someone's arrangement.
        if (this.clearArmedAt < 0 || performance.now() - this.clearArmedAt > CONFIRM_MS) {
          this.clearArmedAt = performance.now();
          p?.label.set('Tap to confirm');
          stage.toast('Tap Reset again to clear the playground');
          break;
        }
        this.clearArmedAt = -1;
        p?.label.set('Reset');
        stage.resonators.forEach((r) => resetResonator(r));
        stage.stringEnds[0].set(-0.13, 0.02, 0.25);
        stage.stringEnds[1].set(0.13, 0.02, 0.25);
        stage.toast('Reset');
        break;
      case 'prev':
      case 'next': {
        const i = ARC.indexOf(stage.mode) + (action === 'next' ? 1 : -1);
        stage.setMode(ARC[(i + ARC.length) % ARC.length]);
        stage.toast(STATION_NAME[stage.mode]);
        break;
      }
      default:
        stage.actions[action]?.();
        break;
      case 'intro':
        if (stage.tutorialStep >= 3) {
          stage.resonators.forEach((r) => resetResonator(r));
          this.setStep(0);
        } else {
          this.setStep(3);
        }
        break;
    }
  }

  /** In VR the instrument you turn to face becomes the active one. */
  private followHead(): void {
    this.player.head.getWorldDirection(this.look);
    // getWorldDirection is the head's +Z; the view looks the other way.
    // Undo the playground's own yaw to get the angle around the seat.
    const ry = stage.root.rotation.y;
    const x = -this.look.x * Math.cos(ry) + this.look.z * Math.sin(ry);
    const z = -this.look.x * Math.sin(ry) - this.look.z * Math.cos(ry);
    const yaw = Math.atan2(-x, -z);
    let best = stage.mode;
    let bestDiff = 10;
    for (const mode of MODES) {
      const d = Math.abs(Math.atan2(Math.sin(yaw - STATION_ANGLE[mode]), Math.cos(yaw - STATION_ANGLE[mode])));
      if (d < bestDiff) {
        bestDiff = d;
        best = mode;
      }
    }
    // Switch only once clearly facing the next one, so it never flickers.
    if (best !== stage.mode && bestDiff < 0.38) {
      stage.setMode(best);
      trace('facing', best);
    }
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const showAll = immersive && stage.tutorialStep >= 3;
    if (showAll !== stage.showAll || immersive !== this.wasImmersive) {
      stage.showAll = showAll;
      this.wasImmersive = immersive;
      this.applyVisibility();
    }
    if (showAll) this.followHead();
    if (this.advanceIn >= 0) {
      this.advanceIn -= dt;
      if (this.advanceIn < 0) this.setStep(stage.tutorialStep + 1);
    }

    // Hint floats above whatever the current step is about.
    const step = stage.tutorialStep;
    const show = step < 3 && this.advanceIn < 0 && stage.mode === 'playground';
    this.hintAlpha += ((show ? 1 : 0) - this.hintAlpha) * (1 - Math.exp(-dt * 5));
    this.hint.opacity = this.hintAlpha;
    const s = this.hint.sprite;
    if (step === 0) s.position.copy(stage.resonators[0].object.position);
    else if (step === 1) s.position.copy(stage.stringEnds[0]).lerp(stage.stringEnds[1], 0.5);
    else s.position.set(0, 0.2, -0.05);
    s.position.y += 0.085 + Math.sin(time * 2) * 0.004;

    if (this.clearArmedAt >= 0 && performance.now() - this.clearArmedAt > CONFIRM_MS) {
      this.clearArmedAt = -1;
      stage.setPebbleLabel('clear', 'Reset');
    }
    // Refresh the status line a few times a second (Label skips unchanged text).
    this.statusIn -= dt;
    if (this.statusIn <= 0) {
      this.statusIn = 0.25;
      const show = stage.tutorialStep >= 3;
      this.statusTop.opacity = show ? 0.95 : 0;
      this.statusLoop.opacity = show ? 0.9 : 0;
      if (show) {
        this.statusTop.set(`${stage.bpm} BPM  \u00b7  Key C  \u00b7  4/4`);
        this.statusLoop.set(stage.loopStatus);
      }
    }

    for (const p of this.pebbles) {
      p.pulse = Math.max(0, p.pulse - dt * 3);
      const on = (p.action === 'beat' && stage.beat) || (p.action === 'play' && stage.playing);
      p.mat.emissiveIntensity = 0.45 + p.pulse * 2.5 + (on ? 0.5 + audio.level * 0.8 : 0);
    }
  }
}
