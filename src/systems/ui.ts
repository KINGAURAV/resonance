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
  VisibilityState,
} from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { loadComposition, saveComposition } from '../composition.js';
import { Pebble } from '../resonance-components.js';
import { COLORS, setShown, stage, trace } from '../stage.js';
import { glowSprite, Label } from '../visuals/textures.js';
import { resetResonator } from './resonators.js';

interface PebbleState {
  action: string;
  object: Group;
  mat: MeshStandardMaterial;
  label: Label;
  pulse: number;
}

const DONE_KEY = 'resonance.introDone';
const HINTS = ['Touch to create sound', 'Grab. Stretch. Pluck.', 'Create your rhythm: drop a shape on an orbit', ''];

// Left column = performance, right column = composition.
const PEBBLES: [string, string, number, number][] = [
  ['play', 'Pause', -1, 0],
  ['beat', 'Beat', -1, 1],
  ['slower', 'Slower', -1, 2],
  ['faster', 'Faster', -1, 3],
  ['save', 'Save', 1, 0],
  ['load', 'Load', 1, 1],
  ['clear', 'Reset', 1, 2],
  ['intro', 'Skip intro', 1, 3],
];

export class UISystem extends createSystem({
  pressed: { required: [Pebble, Pressed] },
}) {
  private pebbles: PebbleState[] = [];
  private hint!: Label;
  private hintAlpha = 0;
  private advanceIn = -1; // seconds until the tutorial moves on
  private lastPress = 0;

  init(): void {
    const geo = new SphereGeometry(0.017, 20, 14);
    for (const [action, text, side, row] of PEBBLES) {
      const object = new Group();
      object.name = `Pebble ${action}`;
      const color = side < 0 ? COLORS.cyan : COLORS.violet;
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
      const e = this.world.createTransformEntity(object, { parent: stage.rootEntity! });
      e.addComponent(Pebble, { action });
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
      this.pebbles.push({ action, object, mat, label, pulse: 0 });
    }

    this.hint = new Label('', 0.024, '#ffffff');
    stage.root.add(this.hint.sprite);

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
    // Reveal things progressively so there is only ever one new idea.
    stage.resonators.forEach((r, i) => {
      r.shown = step >= 2 || i === 0;
      setShown(r.object, r.shown);
    });
    for (const p of this.pebbles) {
      setShown(p.object, step >= 3 || p.action === 'intro');
      if (p.action === 'intro') p.label.set(step >= 3 ? 'Replay intro' : 'Skip intro');
    }
    if (step >= 3) {
      try {
        localStorage.setItem(DONE_KEY, '1');
      } catch {
        /* ignore */
      }
      stage.toast('The playground is yours');
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
        stage.resonators.forEach((r) => resetResonator(r));
        stage.stringEnds[0].set(-0.13, 0.02, 0.25);
        stage.stringEnds[1].set(0.13, 0.02, 0.25);
        stage.toast('Reset');
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

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    if (this.advanceIn >= 0) {
      this.advanceIn -= dt;
      if (this.advanceIn < 0) this.setStep(stage.tutorialStep + 1);
    }

    // Hint floats above whatever the current step is about.
    const step = stage.tutorialStep;
    const show = step < 3 && this.advanceIn < 0;
    this.hintAlpha += ((show ? 1 : 0) - this.hintAlpha) * (1 - Math.exp(-dt * 5));
    this.hint.opacity = this.hintAlpha;
    const s = this.hint.sprite;
    if (step === 0) s.position.copy(stage.resonators[0].object.position);
    else if (step === 1) s.position.copy(stage.stringEnds[0]).lerp(stage.stringEnds[1], 0.5);
    else s.position.set(0, 0.2, -0.05);
    s.position.y += 0.085 + Math.sin(time * 2) * 0.004;

    for (const p of this.pebbles) {
      p.pulse = Math.max(0, p.pulse - dt * 3);
      const on = (p.action === 'beat' && stage.beat) || (p.action === 'play' && stage.playing);
      p.mat.emissiveIntensity = 0.45 + p.pulse * 2.5 + (on ? 0.5 + audio.level * 0.8 : 0);
    }
  }
}
