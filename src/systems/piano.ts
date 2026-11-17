/**
 * PianoSystem: a two-octave keyboard (24 keys, C3-B4 by default) played with
 * all ten fingertips.
 *
 * Hand tracking gives every finger joint, so each fingertip is tested
 * against the keys in the keyboard's own frame: a key goes down when a
 * fingertip dips onto it and comes up when the finger lifts (with a little
 * hysteresis so it never chatters). Faster presses play louder. Notes ring
 * while the key is held, like a real piano, and Sustain keeps them ringing
 * after release until it is switched off.
 *
 * Every note is reported to the looper with its start time and how long it
 * was held, so recorded piano parts replay with the right lengths.
 *
 * Controls (pebbles): octave down/up, sustain, volume, sound (grand,
 * electric, soft), note labels, scale highlight, chord guide.
 */
import {
  BoxGeometry,
  createSystem,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio, PIANO_KINDS } from '../audio/engine.js';
import { PianoKey } from '../resonance-components.js';
import { COLORS, fxAt, setShown, stage, trace } from '../stage.js';
import { decor } from '../visuals/instruments.js';
import { glowSprite, Label } from '../visuals/textures.js';

const KEYS = 24;
const WHITE_W = 0.03; // a little wider than a real key (23.5 mm): easier in VR
const WHITE_L = 0.13;
const WHITE_H = 0.018;
const BLACK_W = 0.017;
const BLACK_L = 0.082;
const BLACK_UP = 0.012; // black key tops sit this far above the white tops
const TRAVEL = 0.007; // how far a key moves when pressed
// Fingertip joints sit inside the finger, ~7 mm above the skin pad.
const PRESS = 0.006;
const LIFT = 0.015;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'] as const;
const FINGERS = 10;
const SOUND_NAMES = ['Grand', 'Electric', 'Soft'];
const VOLUMES = [1, 0.7, 0.4];

const SCALES: { name: string; root: number; steps: number[] }[] = [
  { name: 'C major', root: 0, steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'G major', root: 7, steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'D major', root: 2, steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'A minor', root: 9, steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'E minor', root: 4, steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'C minor', root: 0, steps: [0, 2, 3, 5, 7, 8, 10] },
];
const CHORDS: { name: string; notes: number[] }[] = [
  { name: 'C major', notes: [0, 4, 7] },
  { name: 'G major', notes: [7, 11, 2] },
  { name: 'A minor', notes: [9, 0, 4] },
  { name: 'F major', notes: [5, 9, 0] },
  { name: 'D minor', notes: [2, 5, 9] },
  { name: 'E minor', notes: [4, 7, 11] },
];

interface KeyState {
  semi: number; // 0..23 above the lowest C
  black: boolean;
  x: number;
  mesh: Mesh;
  mat: MeshStandardMaterial;
  baseColor: number;
  fingers: number; // how many fingers (or the mouse) hold it down
  voice: number; // engine piano note id, -1 if silent
  start: number; // audio time the note began
  velocity: number;
  sustained: boolean; // released while Sustain was on: still ringing
  travel: number; // 0 up .. 1 fully down (animated)
  glow: number;
  label: Label | null;
}

export class PianoSystem extends createSystem({
  pressed: { required: [PianoKey, Pressed] },
}) {
  private piano = new Group();
  private keys: KeyState[] = [];
  private base = 48; // MIDI note of the lowest key (C3)
  private sustain = false;
  private sound = 0;
  private volume = 0;
  private labels = true;
  private scale = -1;
  private chord = -1;

  // Per fingertip: which key it holds (-1 none), previous height, speed.
  private fingerKey = new Int8Array(FINGERS).fill(-1);
  private prevY = new Float32Array(FINGERS);
  private downSpeed = new Float32Array(FINGERS);
  private tips: Vector3[] = [];
  private tipValid = new Uint8Array(FINGERS);
  private inv = new Matrix4();
  private tmp = new Vector3();
  private mouseKey = -1;

  private status!: Label;
  private statusAlpha = 0;
  private tag!: Label;
  private tagAlpha = 0;
  private chordDone = -1;
  private wasActive = false;

  init(): void {
    const g = this.piano;
    g.name = 'Piano';
    g.position.set(0, -0.05, 0.19);
    g.rotation.x = 0.06; // front edge dips slightly toward you
    const entity = this.world.createTransformEntity(g, { parent: stage.stationEntities.piano });
    for (let i = 0; i < FINGERS; i++) this.tips.push(new Vector3());

    this.buildCase();

    const whiteGeo = new BoxGeometry(WHITE_W - 0.0015, WHITE_H, WHITE_L);
    const blackGeo = new BoxGeometry(BLACK_W, WHITE_H, BLACK_L);
    let white = 0;
    for (let semi = 0; semi < KEYS; semi++) {
      const black = BLACK[semi % 12];
      // Black keys sit on the line between two white keys.
      const x = black ? (white - 7) * WHITE_W : (white - 6.5) * WHITE_W;
      const color = black ? 0x0d0d18 : 0xf2f0f6;
      const mat = new MeshStandardMaterial({
        color, roughness: black ? 0.28 : 0.22, metalness: black ? 0.3 : 0.05,
        emissive: COLORS.violet, emissiveIntensity: 0,
      });
      const mesh = new Mesh(black ? blackGeo : whiteGeo, mat);
      mesh.name = `Piano key ${semi}`;
      mesh.position.set(x, black ? BLACK_UP - WHITE_H / 2 : -WHITE_H / 2, black ? -WHITE_L / 2 + BLACK_L / 2 : 0);
      const e = this.world.createTransformEntity(mesh, { parent: entity });
      e.addComponent(PianoKey, { id: semi });
      e.addComponent(RayInteractable); // mouse fallback
      let label: Label | null = null;
      if (!black) {
        label = new Label('', 0.016, '#3a3a66');
        label.sprite.position.set(0, WHITE_H / 2 + 0.002, WHITE_L / 2 - 0.018);
        mesh.add(label.sprite);
        white++;
      }
      this.keys.push({
        semi, black, x, mesh, mat, baseColor: color, fingers: 0, voice: -1, start: 0,
        velocity: 0, sustained: false, travel: 0, glow: 0, label,
      });
    }
    this.refreshLabels();

    this.status = new Label('', 0.03, '#ffffff');
    this.status.sprite.position.set(0, 0.17, -0.1);
    this.status.opacity = 0;
    g.add(this.status.sprite);
    this.tag = new Label('', 0.03, '#ffffff');
    this.tag.opacity = 0;
    g.add(this.tag.sprite);
    setShown(g, false);

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (e) => {
        if (stage.mode !== 'piano') return;
        audio.start();
        this.mouseKey = e.getValue(PianoKey, 'id') ?? 0;
        this.keyDown(this.mouseKey, 0.75);
      }),
      this.queries.pressed.subscribe('disqualify', () => {
        if (this.mouseKey >= 0) this.keyUp(this.mouseKey);
        this.mouseKey = -1;
      }),
    );

    const a = stage.actions;
    a.pianoDown = () => this.shift(-12);
    a.pianoUp = () => this.shift(12);
    a.pianoSustain = () => {
      this.sustain = !this.sustain;
      stage.setPebbleLabel('pianoSustain', this.sustain ? 'Sustain: on' : 'Sustain: off');
      if (!this.sustain) this.releaseSustained();
    };
    a.pianoVolume = () => {
      this.volume = (this.volume + 1) % VOLUMES.length;
      stage.setPebbleLabel('pianoVolume', `Volume: ${Math.round(VOLUMES[this.volume] * 100)}%`);
    };
    a.pianoSound = () => {
      this.sound = (this.sound + 1) % PIANO_KINDS.length;
      stage.setPebbleLabel('pianoSound', `Sound: ${SOUND_NAMES[this.sound]}`);
      this.say(`${SOUND_NAMES[this.sound]} piano`);
    };
    a.pianoLabels = () => {
      this.labels = !this.labels;
      stage.setPebbleLabel('pianoLabels', this.labels ? 'Labels: on' : 'Labels: off');
      this.refreshLabels();
    };
    a.pianoScale = () => {
      this.scale = this.scale + 1 >= SCALES.length ? -1 : this.scale + 1;
      stage.setPebbleLabel('pianoScale', this.scale < 0 ? 'Scale: off' : SCALES[this.scale].name);
      if (this.scale >= 0) this.say(`${SCALES[this.scale].name}: glowing keys are in the scale`);
    };
    a.pianoChord = () => {
      this.chord = this.chord + 1 >= CHORDS.length ? -1 : this.chord + 1;
      this.chordDone = -1;
      stage.setPebbleLabel('pianoChord', this.chord < 0 ? 'Chord: off' : `Chord: ${CHORDS[this.chord].name}`);
      if (this.chord >= 0) this.say(`Press the three gold keys together: ${CHORDS[this.chord].name}`);
    };
  }

  /** A dark lacquered case with a neon strip, so it reads as one instrument. */
  private buildCase(): void {
    const width = 14 * WHITE_W + 0.05;
    const body = new MeshStandardMaterial({ color: 0x121228, roughness: 0.25, metalness: 0.6 });
    const base = decor(new Mesh(new BoxGeometry(width, 0.022, WHITE_L + 0.07), body));
    base.position.set(0, -WHITE_H - 0.011, -0.02);
    const back = decor(new Mesh(new BoxGeometry(width, 0.05, 0.05), body));
    back.position.set(0, 0.008, -WHITE_L / 2 - 0.03);
    const cheekGeo = new BoxGeometry(0.022, 0.04, WHITE_L + 0.07);
    const left = decor(new Mesh(cheekGeo, body));
    left.position.set(-width / 2 + 0.011, -0.002, -0.02);
    const right = decor(new Mesh(cheekGeo, body));
    right.position.set(width / 2 - 0.011, -0.002, -0.02);
    const neon = decor(new Mesh(
      new BoxGeometry(width - 0.03, 0.004, 0.004),
      new MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 1.6 }),
    ));
    neon.position.set(0, 0.034, -WHITE_L / 2 - 0.006);
    const neon2 = decor(new Mesh(
      new BoxGeometry(width - 0.03, 0.003, 0.003),
      new MeshStandardMaterial({ color: COLORS.violet, emissive: COLORS.violet, emissiveIntensity: 1.4 }),
    ));
    neon2.position.set(0, -WHITE_H - 0.023, WHITE_L / 2 + 0.014);
    const glow = glowSprite(COLORS.violet, 0.7, 0.18);
    glow.position.set(0, -0.03, -0.03);
    this.piano.add(base, back, left, right, neon, neon2, glow);
  }

  private say(text: string): void {
    this.status.set(text);
    this.statusAlpha = 4; // seconds-ish of full visibility before fading
  }

  private noteName(k: KeyState): string {
    const midi = this.base + k.semi;
    return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  }

  private refreshLabels(): void {
    for (const k of this.keys) {
      if (!k.label) continue;
      k.label.set(this.noteName(k));
      // Always mark the Cs so you can find your place; others when enabled.
      k.label.opacity = this.labels || k.semi % 12 === 0 ? 0.95 : 0;
    }
  }

  private shift(by: number): void {
    const next = Math.min(72, Math.max(36, this.base + by));
    if (next === this.base) {
      this.say(by > 0 ? 'Highest octave' : 'Lowest octave');
      return;
    }
    this.releaseAll();
    this.base = next;
    this.refreshLabels();
    this.say(`Keys from ${this.noteName(this.keys[0])} to ${this.noteName(this.keys[KEYS - 1])}`);
  }

  private keyDown(id: number, velocity: number): void {
    const k = this.keys[id];
    k.fingers++;
    if (k.fingers > 1) return; // already held by another finger
    // Re-striking a key that is still ringing under Sustain.
    if (k.voice >= 0) this.finish(k);
    const midi = this.base + k.semi;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    k.mesh.getWorldPosition(this.tmp);
    k.velocity = Math.min(1, velocity) * VOLUMES[this.volume];
    k.start = audio.now;
    k.voice = audio.pianoOn(PIANO_KINDS[this.sound], freq, k.velocity, this.tmp.x, this.tmp.y, this.tmp.z);
    k.sustained = false;
    k.glow = 1;
    // Note name pops up over the key for a moment.
    this.tag.set(this.noteName(k));
    this.tag.sprite.position.set(k.x, 0.05, k.black ? -0.04 : -0.01);
    this.tagAlpha = 1.4;
    fxAt(stage.stations.piano, this.piano.position.x + k.x, this.piano.position.y + 0.02, this.piano.position.z + (k.black ? -0.03 : 0.02),
      k.black ? COLORS.magenta : COLORS.cyan, 0.03 + velocity * 0.03, Math.round(1 + velocity * 4));
    trace('piano', this.noteName(k), velocity.toFixed(2));
    this.checkChord();
  }

  private keyUp(id: number): void {
    const k = this.keys[id];
    if (k.fingers === 0) return;
    k.fingers--;
    if (k.fingers > 0) return;
    if (this.sustain) k.sustained = true;
    else this.finish(k);
  }

  /** Stop the note and hand it, with its length, to the looper. */
  private finish(k: KeyState): void {
    if (k.voice < 0) return;
    const now = audio.now;
    audio.pianoOff(k.voice);
    k.voice = -1;
    k.sustained = false;
    const midi = this.base + k.semi;
    k.mesh.getWorldPosition(this.tmp);
    audio.emitLive(PIANO_KINDS[this.sound], 440 * Math.pow(2, (midi - 69) / 12), {
      velocity: k.velocity, duration: now - k.start, x: this.tmp.x, y: this.tmp.y, z: this.tmp.z,
    }, k.start);
  }

  private releaseSustained(): void {
    for (const k of this.keys) if (k.sustained && k.fingers === 0) this.finish(k);
  }

  private releaseAll(): void {
    this.fingerKey.fill(-1);
    this.mouseKey = -1;
    for (const k of this.keys) {
      k.fingers = 0;
      this.finish(k);
    }
  }

  /** Chord guide: celebrate when the three gold notes are held together. */
  private checkChord(): void {
    if (this.chord < 0) return;
    const want = CHORDS[this.chord].notes;
    let found = 0;
    for (const pc of want) {
      for (const k of this.keys) {
        if (k.fingers > 0 && (this.base + k.semi) % 12 === pc) {
          found++;
          break;
        }
      }
    }
    if (found === 3 && this.chordDone !== this.chord) {
      this.chordDone = this.chord;
      this.say(`${CHORDS[this.chord].name}!`);
      fxAt(stage.stations.piano, 0, 0.08, this.piano.position.z, COLORS.gold, 0.2, 24);
    }
  }

  /** World positions of every fingertip that hand tracking can see. */
  private readFingertips(): void {
    this.tipValid.fill(0);
    const xr = this.world.renderer.xr;
    const frame = xr.getFrame();
    const ref = xr.getReferenceSpace();
    const session = xr.getSession();
    let anyHand = false;
    if (frame && ref && session) {
      // Joint poses are relative to the XR origin, which is the player rig.
      this.player.updateMatrixWorld();
      for (const src of session.inputSources) {
        const hand = src.hand;
        if (!hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
        anyHand = true;
        const offset = src.handedness === 'left' ? 0 : 5;
        for (let j = 0; j < TIPS.length; j++) {
          const space = hand.get(TIPS[j]);
          const pose = space && frame.getJointPose ? frame.getJointPose(space, ref) : undefined;
          if (!pose) continue;
          const p = pose.transform.position;
          this.tips[offset + j].set(p.x, p.y, p.z).applyMatrix4(this.player.matrixWorld);
          this.tipValid[offset + j] = 1;
        }
      }
    }
    if (!anyHand) {
      // Controllers (or no joint data): the index tips IWSDK tracks.
      this.player.indexTipSpaces.left.getWorldPosition(this.tips[1]);
      this.player.indexTipSpaces.right.getWorldPosition(this.tips[6]);
      this.tipValid[1] = 1;
      this.tipValid[6] = 1;
    }
  }

  /** Which key a point (in keyboard space) is over, or -1. */
  private keyAt(p: Vector3): number {
    const halfW = 7 * WHITE_W;
    if (p.x < -halfW || p.x >= halfW || p.z < -WHITE_L / 2 || p.z > WHITE_L / 2 + 0.01) return -1;
    // The back part of the keyboard has black keys between some whites.
    if (p.z < -WHITE_L / 2 + BLACK_L + 0.004) {
      for (const k of this.keys) {
        if (k.black && Math.abs(p.x - k.x) < BLACK_W / 2 + 0.002) return k.semi;
      }
    }
    const white = Math.floor(p.x / WHITE_W + 7);
    let n = 0;
    for (const k of this.keys) {
      if (k.black) continue;
      if (n === white) return k.semi;
      n++;
    }
    return -1;
  }

  private detectFingers(dt: number): void {
    this.readFingertips();
    this.piano.updateMatrixWorld();
    this.inv.copy(this.piano.matrixWorld).invert();
    for (let f = 0; f < FINGERS; f++) {
      const held = this.fingerKey[f];
      if (!this.tipValid[f]) {
        if (held >= 0) {
          this.fingerKey[f] = -1;
          this.keyUp(held);
        }
        continue;
      }
      const p = this.tmp.copy(this.tips[f]).applyMatrix4(this.inv);
      // Downward speed, smoothed: hand poses arrive in steps.
      const v = (this.prevY[f] - p.y) / Math.max(dt, 0.001);
      this.prevY[f] = p.y;
      this.downSpeed[f] += (Math.min(Math.max(v, 0), 2) - this.downSpeed[f]) * 0.5;

      if (held >= 0) {
        // Stay on the held key while the finger is down and roughly over it,
        // so sliding a little near an edge never re-triggers.
        const k = this.keys[held];
        const top = k.black ? BLACK_UP : 0;
        const halfW = (k.black ? BLACK_W : WHITE_W) / 2 + 0.006;
        if (p.y > top + LIFT || Math.abs(p.x - k.x) > halfW || p.z > WHITE_L / 2 + 0.02 || p.z < -WHITE_L / 2 - 0.01) {
          this.fingerKey[f] = -1;
          this.keyUp(held);
        }
        continue;
      }
      const id = this.keyAt(p);
      if (id < 0) continue;
      const top = this.keys[id].black ? BLACK_UP : 0;
      // Pressed once the fingertip reaches the key top; a finger coming up
      // from below (through the case) is ignored.
      if (p.y < top + PRESS && p.y > top - 0.03) {
        this.fingerKey[f] = id;
        // Slow presses are soft, quick ones loud; noise cannot go below 0.3.
        const vel = Math.min(1, Math.max(0.3, 0.3 + (this.downSpeed[f] - 0.05) * 1.2));
        this.keyDown(id, vel);
      }
    }
  }

  update(delta: number, time: number): void {
    const active = stage.mode === 'piano';
    const visible = active || stage.showAll;
    if (this.piano.visible !== visible) setShown(this.piano, visible);
    if (active !== this.wasActive) {
      this.wasActive = active;
      if (active) this.say('Play with your fingertips');
      else this.releaseAll(); // never leave notes hanging when you move on
    }
    if (!active) return;
    const dt = Math.min(delta, 0.05);
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.detectFingers(delta);

    const scale = this.scale >= 0 ? SCALES[this.scale] : null;
    const chord = this.chord >= 0 ? CHORDS[this.chord] : null;
    for (const k of this.keys) {
      const down = k.fingers > 0 ? 1 : 0;
      k.travel += (down - k.travel) * (1 - Math.exp(-dt * 40));
      k.mesh.position.y = (k.black ? BLACK_UP : 0) - WHITE_H / 2 - k.travel * TRAVEL;
      k.glow = Math.max(k.sustained || k.fingers > 0 ? 0.55 : 0, k.glow - dt * 3);
      const pc = (this.base + k.semi) % 12;
      // Gold = notes of the chord guide, cyan = in the chosen scale (root brighter).
      let hint = 0;
      let hintColor = COLORS.cyan;
      if (chord && chord.notes.includes(pc)) {
        hint = 0.55 + Math.sin(time * 6) * 0.2;
        hintColor = COLORS.gold;
      } else if (scale && scale.steps.includes((pc - scale.root + 12) % 12)) {
        hint = pc === scale.root ? 0.55 : 0.28;
      }
      if (k.glow > hint) {
        k.mat.emissive.setHex(k.black ? COLORS.magenta : COLORS.violet);
        k.mat.emissiveIntensity = k.glow * (k.black ? 2 : 0.9);
      } else {
        k.mat.emissive.setHex(hintColor);
        k.mat.emissiveIntensity = hint * (k.black ? 1.6 : 0.6);
      }
    }
    this.statusAlpha = Math.max(0, this.statusAlpha - dt);
    this.status.opacity = Math.min(1, this.statusAlpha);
    this.tagAlpha = Math.max(0, this.tagAlpha - dt * 1.5);
    this.tag.opacity = Math.min(1, this.tagAlpha);
  }
}
