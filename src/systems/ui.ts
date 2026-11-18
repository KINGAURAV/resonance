/**
 * UISystem: the control buttons, the guided intro, and the 2D title overlay.
 *
 * There are no flat panels. Each control is a small round button with an
 * icon, colour-coded by purpose (see visuals/icons.ts), that you poke with a
 * fingertip (or pinch-ray from a distance). Buttons swell when a finger
 * comes near (hover), sink and click when pressed, and glow mint while their
 * feature is switched on. Two big arrows on either side change instrument,
 * labelled with the instrument they lead to. Less-used controls stay hidden
 * until you press More, so each instrument starts simple.
 */
import {
  CircleGeometry,
  createSystem,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  Shape,
  TorusGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { loadComposition, saveComposition } from '../composition.js';
import { Pebble } from '../resonance-components.js';
import { COLORS, setShown, stage, STATION_NAME, trace, type StudioMode } from '../stage.js';
import { BUTTONS, iconTexture } from '../visuals/icons.js';
import { glowSprite, Label } from '../visuals/textures.js';
import { resetResonator } from './resonators.js';

interface PebbleState {
  action: string;
  mode: PebbleMode;
  object: Group;
  /** The visible button, scaled for hover and pushed in when pressed. */
  body: Group;
  mat: MeshStandardMaterial;
  face: MeshBasicMaterial | null;
  color: number;
  label: Label;
  pulse: number;
  hover: number;
  near: number; // hover target this frame (0 or 1)
}

// Less-used controls, shown only after pressing More.
const ADVANCED = new Set([
  'save', 'load', 'clear', 'loopClear', 'snap', 'arpClear',
  'pianoSustain', 'pianoVolume', 'pianoLabels', 'pianoScale', 'pianoChord',
]);
const ON_COLOR = COLORS.mint;

// Stations from left to right, for the desktop arrow pebbles.
const ARC: StudioMode[] = ['lattice', 'drums', 'playground', 'piano', 'guitar', 'glide'];
const CONFIRM_MS = 3000;
const PRESS_R = 0.03; // fingertip this close to a pebble centre presses it
const PRESS_RE = 0.055; // and must move this far away to press it again
/** Rays still work on pebbles; the fingertip touch pointer must not. */
const NO_TOUCH = { deny: ['touch'] };
function noTouch(obj: Group): void {
  const o = obj as Group & { pointerEventsType?: unknown };
  if (o.pointerEventsType !== NO_TOUCH) o.pointerEventsType = NO_TOUCH;
}
const HINTS = ['Touch to create sound', 'Grab. Stretch. Pluck.', 'Create your rhythm: drop a shape on an orbit', ''];

// Left column = performance, right column = composition.
// [action, label, side, grid cell, mode it belongs to]
type PebbleMode = 'playground' | 'drums' | 'guitar' | 'lattice' | 'glide' | 'piano' | 'studio' | 'all'; // studio = any instrument
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
  ['holdGuitar', 'Hold guitar', -1, 2, 'guitar'],
  ['pianoDown', 'Octave -', -1, 0, 'piano'],
  ['pianoUp', 'Octave +', -1, 1, 'piano'],
  ['pianoSustain', 'Sustain: off', -1, 2, 'piano'],
  ['pianoVolume', 'Volume: 100%', -1, 3, 'piano'],
  ['pianoSound', 'Sound: Grand', 1, 0, 'piano'],
  ['pianoLabels', 'Labels: on', 1, 1, 'piano'],
  ['pianoScale', 'Scale: off', 1, 2, 'piano'],
  ['pianoChord', 'Chord: off', 1, 3, 'piano'],
  ['pianoLearn', 'Learn a song', 1, 4, 'piano'],
  ['echo', 'Learn: Echo', 1, 4, 'playground'],
  ['latticeLearn', 'Learn a song', 1, 0, 'lattice'],
  ['glideLearn', 'Learn a song', 1, 0, 'glide'],
  ['pianoSong', 'Song: Twinkle Twinkle', 1, 7, 'piano'],
  ['drumSong', 'Song: Basics', 1, 6, 'drums'],
  ['guitarSong', 'Song: Basics', 1, 6, 'guitar'],
  ['latticeSong', 'Song: Mary Had a Little Lamb', 1, 1, 'lattice'],
  ['glideSong', 'Song: Mary Had a Little Lamb', 1, 1, 'glide'],
  ['prev', '', -1, 99, 'all'], // arrows: placed separately
  ['next', '', 1, 99, 'all'],
  ['more', 'More', -1, 6, 'all'],
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
  private headPos = new Vector3();
  private tipPos = new Vector3();
  private pokeArmed = new Uint8Array(128).fill(1);
  private clearArmedAt = -1; // Reset needs a second tap within CONFIRM_MS
  private statusTop!: Label;
  private statusLoop!: Label;
  private statusIn = 0;
  private showMore = false;

  init(): void {
    const rimGeo = new CylinderGeometry(0.021, 0.021, 0.008, 28);
    rimGeo.rotateX(Math.PI / 2); // flat face toward +z
    const ringGeo = new TorusGeometry(0.0205, 0.0022, 8, 32);
    const faceGeo = new CircleGeometry(0.016, 28);
    // A chunky arrow, pointing +x; the left one is mirrored.
    const arrowShape = new Shape();
    arrowShape.moveTo(-0.032, -0.009);
    arrowShape.lineTo(0.006, -0.009);
    arrowShape.lineTo(0.006, -0.024);
    arrowShape.lineTo(0.036, 0);
    arrowShape.lineTo(0.006, 0.024);
    arrowShape.lineTo(0.006, 0.009);
    arrowShape.lineTo(-0.032, 0.009);
    arrowShape.closePath();
    const arrowGeo = new ExtrudeGeometry(arrowShape, { depth: 0.008, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2 });
    arrowGeo.translate(0, 0, -0.004);

    for (const [action, text, side, cell, mode] of PEBBLES) {
      const object = new Group();
      object.name = `Pebble ${action}`;
      const body = new Group();
      // Tilted back so the face looks up at a seated player's eyes.
      body.rotation.x = -0.6;
      const arrow = action === 'prev' || action === 'next';
      const def = BUTTONS[action] ?? { icon: 'more', color: COLORS.cyan };
      const color = arrow ? COLORS.cyan : def.color;
      const mat = new MeshStandardMaterial({
        color: arrow ? color : 0x15152c, emissive: color, emissiveIntensity: arrow ? 0.7 : 0.25,
        roughness: 0.3, metalness: 0.4,
      });
      let face: MeshBasicMaterial | null = null;
      if (arrow) {
        const m = new Mesh(arrowGeo, mat);
        if (side < 0) m.rotation.z = Math.PI;
        body.add(m);
      } else {
        const rim = new Mesh(rimGeo, mat);
        const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color }));
        ring.position.z = 0.0042;
        face = new MeshBasicMaterial({ map: iconTexture(def.icon), transparent: true, depthWrite: false });
        const icon = new Mesh(faceGeo, face);
        icon.position.z = 0.0045;
        body.add(rim, ring, icon);
      }
      const label = new Label(text, 0.017);
      label.sprite.position.y = arrow ? -0.04 : 0.036;
      object.add(body, glowSprite(color, arrow ? 0.11 : 0.06, arrow ? 0.4 : 0.35), label.sprite);
      if (arrow) {
        // Big arrows at the far left and right: always in the same place.
        object.position.set(side * 0.49, 0.13, 0.07);
      } else {
        // 2-column grid per side, all at the same depth, so reaching for one
        // button never sweeps a finger through another.
        object.position.set(side * (0.3 + (cell % 2) * 0.075), 0.02 + Math.floor(cell / 2) * 0.075, 0.1);
      }
      const e = this.world.createTransformEntity(object, { parent: stage.uiEntity! });
      e.addComponent(Pebble, { action });
      e.addComponent(RayInteractable); // mouse, and pinch-ray from a distance
      this.pebbles.push({ action, mode, object, body, mat, face, color, label, pulse: 0, hover: 0, near: 0 });
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
        this.press(entity.getValue(Pebble, 'action') ?? '');
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

    // Every visit opens on the guided tutorial (Skip intro is always there),
    // so a first-time player is never dropped into the full studio.
    this.setStep(0);
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
      stage.toast(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? 'Poke the Instrument arrows for more instruments' : 'Use the Instrument arrows for more instruments');
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
      const arrow = p.action === 'prev' || p.action === 'next';
      const basic = !ADVANCED.has(p.action) || this.showMore;
      setShown(p.object, arrow || p.action === 'more' ? step >= 3 : basic && inMode && (!play || step >= 3 || p.action === 'intro'));
      if (p.action === 'intro') p.label.set(step >= 3 ? 'Replay intro' : 'Skip intro');
      if (arrow) {
        // Name the instrument the arrow leads to.
        const i = ARC.indexOf(stage.mode) + (p.action === 'next' ? 1 : -1);
        const name = STATION_NAME[ARC[(i + ARC.length) % ARC.length]];
        p.label.set(p.action === 'next' ? `${name}  \u25B6` : `\u25C0  ${name}`);
      }
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
      case 'more':
        this.showMore = !this.showMore;
        p?.label.set(this.showMore ? 'Less' : 'More');
        this.applyVisibility();
        break;
      case 'play':
        stage.playing = !stage.playing;
        p?.label.set(stage.playing ? 'Pause' : 'Play');
        if (p?.face) p.face.map = iconTexture(stage.playing ? 'pause' : 'play');
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
      case 'next':
        this.step(action === 'next' ? 1 : -1);
        break;
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

  /** Switch to the neighbouring instrument (dir +1 = next to the right). */
  private step(dir: number): void {
    const i = ARC.indexOf(stage.mode) + dir;
    stage.setMode(ARC[(i + ARC.length) % ARC.length]);
    stage.toast(STATION_NAME[stage.mode]);
    trace('switch', stage.mode);
  }

  /**
   * Fingertip presses. The SDK's poke pointer was unreliable on these small
   * pebbles (missed or doubled presses), so the pebbles do their own check,
   * like the instruments: a fingertip within PRESS_R of a pebble presses it
   * once, and it must move PRESS_RE away before that pebble can fire again.
   */
  private detectPokes(): void {
    const sides = ['left', 'right'] as const;
    for (let h = 0; h < 2; h++) {
      this.player.indexTipSpaces[sides[h]].getWorldPosition(this.tipPos);
      for (let i = 0; i < this.pebbles.length; i++) {
        const p = this.pebbles[i];
        noTouch(p.object);
        const k = h * this.pebbles.length + i;
        if (h === 0) p.near = 0;
        if (!p.object.visible) {
          this.pokeArmed[k] = 1;
          continue;
        }
        p.object.getWorldPosition(this.headPos);
        const d = this.headPos.distanceTo(this.tipPos);
        if (d < 0.08) p.near = 1; // hover: a finger is approaching
        const r = p.action === 'prev' || p.action === 'next' ? PRESS_R + 0.012 : PRESS_R;
        if (d > PRESS_RE) this.pokeArmed[k] = 1;
        else if (d < r && this.pokeArmed[k]) {
          this.pokeArmed[k] = 0;
          this.press(p.action);
        }
      }
    }
  }

  /** One press of a pebble, from a fingertip, a ray or the mouse. */
  private press(action: string): void {
    const now = performance.now();
    if (now - this.lastPress < 300) return; // never double-fire
    this.lastPress = now;
    audio.start();
    // A crisp tick so you always know the press registered.
    audio.play('click', 2400, { velocity: 0.3, x: this.tipPos.x, y: this.tipPos.y, z: this.tipPos.z });
    this.run(action);
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive !== this.wasImmersive) {
      this.wasImmersive = immersive;
      this.applyVisibility();
    }
    if (immersive) this.detectPokes();
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
      p.hover += (p.near - p.hover) * (1 - Math.exp(-dt * 14));
      // Hovered buttons swell; pressed ones sink in.
      p.body.scale.setScalar(1 + p.hover * 0.18);
      p.body.position.z = -p.pulse * 0.007;
      // Mint while the feature is on (Beat, Sustain, Arp, recording...).
      const t = p.label.value;
      const on = p.action === 'beat' ? stage.beat
        : p.action === 'play' ? false
        : t.endsWith(': on') || t.startsWith('Stop') || t.startsWith('Recording') || t.startsWith('Adding') || t === 'Less';
      // Recording stays red (red = recording); other features turn mint.
      p.mat.emissive.setHex(on && p.action !== 'loop' ? ON_COLOR : p.color);
      p.mat.emissiveIntensity = (p.face ? 0.25 : 0.7) + p.hover * 0.5 + p.pulse * 1.5 + (on ? 0.6 + audio.level * 0.6 : 0);
    }
  }
}
