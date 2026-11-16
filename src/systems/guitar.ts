/**
 * GuitarSystem: an air guitar you strum with bare hands.
 *
 * Fretting real chords needs finger tracking that hands cannot give reliably
 * (the fretting fingers hide each other from the headset cameras), so chords
 * are whole blocks on the neck: touch one with either hand and it stays
 * selected. Sweep a fingertip across the strings over the body to strum; each
 * string sounds as the finger crosses it, so slow sweeps arpeggiate.
 *
 * "Learn a song" mirrors the drum lessons: a ring closes on the strum area and
 * lands on each beat, and the chord to hold next lights up.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  createSystem,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { GuitarChord, GuitarStrum } from '../resonance-components.js';
import { COLORS, fxAt, setShown, stage, trace } from '../stage.js';
import { buildGuitarModel, GUITAR } from '../visuals/instruments.js';
import { glowSprite, Label, ringTexture } from '../visuals/textures.js';

// MIDI notes per string, low E (top) to high E (bottom); -1 = string muted.
const CHORDS: { name: string; color: number; notes: number[] }[] = [
  { name: 'C', color: COLORS.cyan, notes: [-1, 48, 52, 55, 60, 64] },
  { name: 'G', color: COLORS.mint, notes: [43, 47, 50, 55, 59, 67] },
  { name: 'Am', color: COLORS.violet, notes: [-1, 45, 52, 57, 60, 64] },
  { name: 'F', color: COLORS.magenta, notes: [41, 48, 53, 57, 60, 65] },
];
const STRINGS = 6;
const SPACING = GUITAR.spacing;
const NECK_START = GUITAR.nutX;
const BLOCK = 0.07; // width of one chord block
const STRUM_MIN_X = 0.03;
const STRUM_MAX_X = 0.25;
const STRUM_CENTER_X = 0.12;

// Each lesson lists one chord per bar (four strums per bar).
const LESSONS: { name: string; bars: number[] }[] = [
  { name: 'Lesson 1: Strum on the beat', bars: [0, 0] },
  { name: 'Lesson 2: Change chords', bars: [0, 1, 0, 1] },
  { name: 'Lesson 3: Four-chord song', bars: [0, 1, 2, 3] },
];
const BEAT = 60 / 72;
const HIT_WINDOW = 0.22;
const LEAD = 0.8;
const PASS_MARK = 0.7;
const MAX_BEATS = 16;

const midiFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const stringY = (i: number) => (2.5 - i) * SPACING;

export class GuitarSystem extends createSystem({
  chordPressed: { required: [GuitarChord, Pressed] },
  strumPressed: { required: [GuitarStrum, Pressed] },
}) {
  private guitar = new Group();
  private strings: Mesh[] = [];
  private vib = new Float32Array(STRINGS);
  private lastPluck = new Float64Array(STRINGS);
  private blocks: { mat: MeshStandardMaterial; pulse: number }[] = [];
  private guide!: Sprite;
  private status!: Label;
  private chord = 0;

  private tip = new Vector3();
  private worldPos = new Vector3();
  private prevY = [0, 0];
  private prevValid = [false, false];
  private speed = [0, 0];
  private prevTip = [new Vector3(), new Vector3()];

  private learning = false;
  private lesson = 0;
  private startTime = 0;
  private beatState = new Uint8Array(MAX_BEATS);
  private beats = 0;
  private hits = 0;
  private clicks = 0;
  private resumeIn = -1;

  init(): void {
    const g = this.guitar;
    g.name = 'Guitar';
    g.position.set(0.02, -0.01, 0.15);
    g.rotation.x = -0.55; // face tilts up toward the seated player
    const guitarEntity = this.world.createTransformEntity(g, { parent: stage.stationEntities.guitar });

    // The instrument itself is decoration; raise it so the strings sit just
    // above the frets.
    const model = buildGuitarModel();
    model.position.z = 0.009;
    g.add(model);

    const stringLen = GUITAR.bridgeX - GUITAR.nutX;
    for (let i = 0; i < STRINGS; i++) {
      const r = 0.0011 - i * 0.00012;
      const s = new Mesh(
        new CylinderGeometry(r, r, stringLen, 6),
        // Wound bronze for the three low strings, plain steel for the rest.
        new MeshStandardMaterial({
          color: i < 3 ? 0xc79a55 : 0xe9edf2, metalness: 1, roughness: 0.3,
          emissive: 0xfff2d0, emissiveIntensity: 0,
        }),
      );
      s.rotation.z = Math.PI / 2; // lie along x
      s.position.set(GUITAR.nutX + stringLen / 2, stringY(i), 0);
      s.raycast = () => {};
      this.strings.push(s);
      g.add(s);
    }

    CHORDS.forEach((c, id) => {
      const mat = new MeshStandardMaterial({
        color: c.color, emissive: c.color, emissiveIntensity: 0.3,
        transparent: true, opacity: 0.4, roughness: 0.3, depthWrite: false,
      });
      // A coloured zone laid over the fretboard, under the strings.
      const block = new Mesh(new BoxGeometry(BLOCK - 0.006, 0.066, 0.003), mat);
      block.name = `Chord ${c.name}`;
      block.position.set(NECK_START + BLOCK * (id + 0.5), 0, -0.0035);
      const label = new Label(c.name, 0.03, '#ffffff');
      label.sprite.position.set(0, 0.06, 0.01);
      block.add(label.sprite);
      const e = this.world.createTransformEntity(block, { parent: guitarEntity });
      e.addComponent(GuitarChord, { id });
      e.addComponent(RayInteractable); // mouse / far-pinch fallback
      this.blocks.push({ mat, pulse: 0 });
    });

    const strum = new Mesh(
      new BoxGeometry(STRUM_MAX_X - STRUM_MIN_X, 0.12, 0.02),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    strum.name = 'Guitar Strum';
    strum.position.set(STRUM_CENTER_X, 0, 0);
    const se = this.world.createTransformEntity(strum, { parent: guitarEntity });
    se.addComponent(GuitarStrum);
    se.addComponent(RayInteractable);

    this.guide = new Sprite(
      new SpriteMaterial({ map: ringTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false }),
    );
    this.guide.raycast = () => {};
    this.guide.position.set(STRUM_CENTER_X, 0, 0.01);
    this.guide.visible = false;
    g.add(this.guide);
    this.status = new Label('', 0.034, '#ffffff');
    this.status.sprite.position.set(0, 0.2, -0.06);
    g.add(this.status.sprite);
    setShown(g, false);

    this.cleanupFuncs.push(
      this.queries.chordPressed.subscribe('qualify', (e) => {
        if (stage.mode === 'guitar') this.setChord(e.getValue(GuitarChord, 'id') ?? 0);
      }),
      this.queries.strumPressed.subscribe('qualify', () => {
        if (stage.mode !== 'guitar') return;
        // A click strums all six strings downward, 28 ms apart.
        for (let i = 0; i < STRINGS; i++) this.pluck(i, 0.7, audio.now + i * 0.028);
      }),
    );
    stage.actions.learnGuitar = () => (this.learning ? this.stopLearning('Free play') : this.startLearning());
  }

  private setChord(id: number): void {
    if (id === this.chord) return;
    this.chord = id;
    this.blocks[id].pulse = 1;
    trace('chord', CHORDS[id].name);
  }

  private pluck(i: number, velocity: number, when = 0): void {
    const now = performance.now();
    if (when === 0 && now - this.lastPluck[i] < 45) return; // debounce
    this.lastPluck[i] = now;
    audio.start();
    this.vib[i] = 1;
    const midi = CHORDS[this.chord].notes[i];
    trace('pluck string', i, CHORDS[this.chord].name, midi, velocity.toFixed(2));
    if (midi >= 0) {
      this.guitar.getWorldPosition(this.worldPos);
      audio.play('pluck', midiFreq(midi), {
        // Kept quiet and dark on purpose: six strings ring at once.
        when, velocity: velocity * 0.45, brightness: 0.25, live: true,
        x: this.worldPos.x, y: this.worldPos.y, z: this.worldPos.z,
      });
    }
    if (this.learning && this.resumeIn < 0) this.judge(when || audio.now);
  }

  /** A strum counts for a beat if it is in time and on the right chord. */
  private judge(t: number): void {
    const bars = LESSONS[this.lesson].bars;
    for (let n = 0; n < this.beats; n++) {
      if (this.beatState[n] !== 0) continue;
      if (Math.abs(this.startTime + n * BEAT - t) > HIT_WINDOW) continue;
      if (bars[Math.floor(n / 4)] !== this.chord) return;
      this.beatState[n] = 1;
      this.hits++;
      const p = this.guitar.position;
      fxAt(stage.stations.guitar, p.x + STRUM_CENTER_X, p.y, p.z, COLORS.mint, 0.3, 0);
      trace('strum hit beat', n, CHORDS[this.chord].name);
      return;
    }
  }

  private startLearning(): void {
    audio.start();
    this.learning = true;
    this.lesson = 0;
    stage.setPebbleLabel('learnGuitar', 'Stop lesson');
    this.beginAttempt();
  }

  private stopLearning(message: string): void {
    this.learning = false;
    this.resumeIn = -1;
    this.guide.visible = false;
    this.status.set(message);
    stage.setPebbleLabel('learnGuitar', 'Learn a song');
  }

  private beginAttempt(): void {
    this.beats = LESSONS[this.lesson].bars.length * 4;
    this.beatState.fill(0);
    this.hits = 0;
    this.clicks = -4; // four count-in clicks
    this.startTime = audio.now + 4 * BEAT + 0.1;
    this.resumeIn = -1;
    this.status.set(LESSONS[this.lesson].name);
    stage.toast('Hold the bright chord, strum when the ring lands');
    trace('guitar lesson', this.lesson, 'start');
  }

  private finishAttempt(): void {
    const score = this.hits / this.beats;
    trace('guitar lesson', this.lesson, 'score', this.hits, '/', this.beats);
    if (score >= PASS_MARK) {
      fxAt(stage.stations.guitar, 0, 0.12, 0.05, COLORS.gold, 0, 40);
      if (this.lesson === LESSONS.length - 1) {
        this.stopLearning(`You played a song! ${this.hits}/${this.beats}`);
        return;
      }
      this.lesson++;
      this.status.set(`Nice! ${this.hits}/${this.beats}`);
    } else {
      this.status.set(`${this.hits}/${this.beats} - try again`);
    }
    this.resumeIn = 2.2;
  }

  /** Returns the chord the player should be holding right now (or -1). */
  private updateLesson(dt: number): number {
    const now = audio.now;
    if (this.resumeIn >= 0) {
      this.resumeIn -= dt;
      if (this.resumeIn < 0) this.beginAttempt();
      return -1;
    }
    const bars = LESSONS[this.lesson].bars;
    while (this.clicks < this.beats) {
      const t = this.startTime + this.clicks * BEAT;
      if (t > now + 0.15) break;
      const p = stage.root.position;
      const accent = ((this.clicks % 4) + 4) % 4 === 0;
      if (t > now) audio.play('click', accent ? 1600 : 1100, { when: t, velocity: 0.5, x: p.x, y: p.y, z: p.z });
      this.clicks++;
    }
    // Next pending beat drives the ring and the highlighted chord.
    let next = -1;
    for (let n = 0; n < this.beats; n++) {
      if (this.beatState[n] !== 0) continue;
      if (this.startTime + n * BEAT - now < -HIT_WINDOW) {
        this.beatState[n] = 2; // missed
        continue;
      }
      next = n;
      break;
    }
    if (next < 0) {
      this.guide.visible = false;
      if (now > this.startTime + (this.beats - 1) * BEAT + HIT_WINDOW) this.finishAttempt();
      return -1;
    }
    const until = this.startTime + next * BEAT - now;
    const frac = Math.min(1, Math.max(0, until / LEAD));
    this.guide.visible = until < LEAD;
    this.guide.scale.setScalar(0.12 * (1 + frac * 1.8));
    this.guide.material.opacity = 1 - frac * 0.7;
    this.guide.material.color.setHex(frac < 0.12 ? 0xffffff : COLORS.gold);
    return bars[Math.floor(next / 4)];
  }

  /** Chord touches and string crossings, in the guitar's own frame. */
  private detectHands(rawDt: number): void {
    const sides = ['left', 'right'] as const;
    for (let h = 0; h < 2; h++) {
      this.player.indexTipSpaces[sides[h]].getWorldPosition(this.tip);
      // Hand poses often update less often than frames render, so raw
      // per-frame speed flickers between zero and double. Smooth it.
      const raw = this.tip.distanceTo(this.prevTip[h]) / Math.max(rawDt, 0.001);
      this.speed[h] += (Math.min(raw, 4) - this.speed[h]) * 0.4;
      const speed = this.speed[h];
      this.prevTip[h].copy(this.tip);
      this.guitar.worldToLocal(this.tip);
      const { x, y, z } = this.tip;
      // There is no surface to feel, so real strums wander in depth: accept
      // a generous slab in front of and slightly behind the strings.
      const near = z > -0.06 && z < 0.09;

      // Neck: touching a block selects (and keeps) that chord.
      if (Math.abs(z) < 0.04 && x > NECK_START && x < NECK_START + BLOCK * CHORDS.length && Math.abs(y) < 0.06) {
        this.setChord(Math.min(CHORDS.length - 1, Math.floor((x - NECK_START) / BLOCK)));
      }

      // Body: a string sounds when the fingertip crosses its line.
      const inStrum = near && x > STRUM_MIN_X && x < STRUM_MAX_X;
      if (inStrum && this.prevValid[h]) {
        const velocity = Math.min(1, Math.max(0.3, speed / 1.2));
        for (let i = 0; i < STRINGS; i++) {
          const sy = stringY(i);
          if ((this.prevY[h] - sy) * (y - sy) < 0) this.pluck(i, velocity);
        }
      }
      this.prevValid[h] = inStrum;
      this.prevY[h] = y;
    }
  }

  update(delta: number, time: number): void {
    const active = stage.mode === 'guitar';
    const visible = active || stage.showAll;
    if (this.guitar.visible !== visible) {
      setShown(this.guitar, visible);
      if (visible) this.status.set('Free play');
    }
    if (!active) {
      if (this.learning) this.stopLearning('Free play');
      return;
    }
    const dt = Math.min(delta, 0.05);
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.detectHands(delta);
    const wanted = this.learning ? this.updateLesson(dt) : -1;

    for (let i = 0; i < STRINGS; i++) {
      this.vib[i] = Math.max(0, this.vib[i] - dt * 1.8);
      const v = this.vib[i];
      const s = this.strings[i];
      s.position.y = stringY(i) + Math.sin(time * (70 + i * 13)) * v * 0.0035;
      (s.material as MeshStandardMaterial).emissiveIntensity = v * 1.6; // ringing strings shine
    }
    for (let id = 0; id < this.blocks.length; id++) {
      const b = this.blocks[id];
      b.pulse = Math.max(0, b.pulse - dt * 3);
      const active = id === this.chord;
      // The chord the lesson wants blinks until the player selects it.
      const call = id === wanted && !active ? 0.9 + Math.sin(time * 12) * 0.6 : 0;
      b.mat.emissiveIntensity = (active ? 1.3 : 0.25) + b.pulse * 1.5 + call;
      b.mat.opacity = active ? 0.8 : 0.32;
    }
  }
}
