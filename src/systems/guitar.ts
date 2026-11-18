/**
 * GuitarSystem: an air guitar you strum with bare hands.
 *
 * Fretting real chords needs finger tracking that hands cannot give reliably
 * (the fretting fingers hide each other from the headset cameras), so chords
 * are whole blocks on the neck: touch one with either hand and it stays
 * selected. Sweep a fingertip across the strings over the body to strum; each
 * string sounds as the finger crosses it, so slow sweeps arpeggiate.
 *
 * "Hold guitar" puts it in your hands: the body rests in front of your
 * stomach and the neck follows your left hand, wherever you hold it. Slide
 * the left hand along the neck (nearer or further from the body) to change
 * chord, and strum over the body with the right hand.
 *
 * Strum direction matters: a downstroke (low string first) is full and warm,
 * an upstroke is lighter and brighter, like a real guitar.
 *
 * "Learn a song" mirrors the drum lessons: a ring closes on the strum area and
 * lands on each beat, an arrow shows which way to strum, the chord to hold
 * next lights up, and each strum is marked Early, Perfect or Late.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  createSystem,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Pressed,
  Quaternion,
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
// `strokes` is the strum direction for each beat of a bar: D down, U up.
const LESSONS: { name: string; bars: number[]; strokes: string }[] = [
  { name: 'Lesson 1: Strum on the beat', bars: [0, 0], strokes: 'DDDD' },
  { name: 'Lesson 2: Change chords', bars: [0, 1, 0, 1], strokes: 'DDDD' },
  { name: 'Lesson 3: Four-chord song', bars: [0, 1, 2, 3], strokes: 'DDUD' },
  // Songs (public-domain tunes, simplified to C, G, Am and F): each stands
  // alone and is chosen with the Song button.
  { name: 'Twinkle Twinkle', bars: [0, 0, 3, 0, 3, 0, 1, 0], strokes: 'DDDD' },
  { name: 'When the Saints', bars: [0, 0, 0, 1, 0, 3, 1, 0], strokes: 'DDUD' },
  { name: 'Amazing Grace', bars: [0, 0, 3, 0, 0, 0, 1, 1], strokes: 'DDUD' },
  { name: 'Oh Susanna', bars: [0, 0, 0, 1, 0, 0, 1, 0], strokes: 'DUDU' },
  { name: 'Ballad', bars: [2, 3, 0, 1, 2, 3, 0, 1], strokes: 'DDUD' },
];
const BASICS = 3; // lessons 0-2 run in a row; later entries are single songs
/** What the Song button cycles through: the basics course, then each song. */
const PICKS = ['Basics', ...LESSONS.slice(BASICS).map((l) => l.name)];
const PERFECT = 0.07;
const BEAT = 60 / 72;
const HIT_WINDOW = 0.22;
const LEAD = 0.8;
const PASS_MARK = 0.7;
const MAX_BEATS = 32;

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
  private pick = 0; // index into PICKS
  private lastLesson = BASICS - 1; // the lesson that ends this run
  private startTime = 0;
  private beatState = new Uint8Array(MAX_BEATS);
  private beats = 0;
  private hits = 0;
  private clicks = 0;
  private resumeIn = -1;
  private arrow!: Label;
  private feel!: Label;
  private feelAlpha = 0;
  private judgedAt = -1; // one verdict per strum, not per string
  // Holding the guitar.
  private holding = false;
  private restQuat = new Quaternion();
  private head = new Vector3();
  private fwd = new Vector3();
  private smoothFwd = new Vector3(0, 0, -1);
  private anchor = new Vector3();
  private leftTip = new Vector3();
  private axisX = new Vector3(1, 0, 0);
  private axisY = new Vector3();
  private axisZ = new Vector3();
  private basis = new Matrix4();
  private targetPos = new Vector3();
  private targetQuat = new Quaternion();
  private parentQuat = new Quaternion();

  init(): void {
    const g = this.guitar;
    g.name = 'Guitar';
    g.position.set(0.02, -0.01, 0.15);
    g.rotation.x = -0.55; // face tilts up toward the seated player
    this.restQuat.copy(g.quaternion);
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
    // Direction arrow for the next strum, beside the strum ring.
    this.arrow = new Label('', 0.07, '#ffc86b');
    this.arrow.sprite.position.set(STRUM_MAX_X + 0.04, 0, 0.02);
    this.arrow.opacity = 0;
    g.add(this.arrow.sprite);
    this.feel = new Label('', 0.03, '#ffffff');
    this.feel.sprite.position.set(STRUM_CENTER_X, 0.1, 0.02);
    this.feel.opacity = 0;
    g.add(this.feel.sprite);
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
    stage.actions.holdGuitar = () => {
      if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
        stage.toast('Holding the guitar needs VR hand tracking');
        return;
      }
      this.setHolding(!this.holding);
    };
    stage.actions.learnGuitar = () => (this.learning ? this.stopLearning('Free play') : this.startLearning());
    stage.actions.guitarSong = () => {
      this.pick = (this.pick + 1) % PICKS.length;
      stage.setPebbleLabel('guitarSong', `Song: ${PICKS[this.pick]}`);
      if (this.learning) this.startLearning();
      else this.status.set(`${PICKS[this.pick]}: press Learn a song to start`);
    };
  }

  private setHolding(on: boolean): void {
    this.holding = on;
    stage.setPebbleLabel('holdGuitar', on ? 'Put it down' : 'Hold guitar');
    if (on) {
      this.player.head.getWorldDirection(this.fwd);
      this.smoothFwd.set(-this.fwd.x, 0, -this.fwd.z).normalize();
      stage.toast('Left hand on the neck, strum with your right');
    } else {
      this.guitar.position.set(0.02, -0.01, 0.15);
      this.guitar.quaternion.copy(this.restQuat);
    }
    trace('hold guitar', on);
  }

  /** Body in front of your stomach, neck pointing at your left hand. */
  private followHands(dt: number): void {
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldDirection(this.fwd);
    this.fwd.set(-this.fwd.x, 0, -this.fwd.z);
    if (this.fwd.lengthSq() > 1e-4) {
      // Follow the head's heading slowly, so glancing around stays steady.
      this.smoothFwd.lerp(this.fwd.normalize(), 1 - Math.exp(-dt * 2)).normalize();
    }
    const f = this.smoothFwd;
    // Right of the heading: (-f.z, 0, f.x).
    this.anchor.set(
      this.head.x + f.x * 0.24 - f.z * 0.07,
      this.head.y - 0.4,
      this.head.z + f.z * 0.24 + f.x * 0.07,
    );
    this.player.indexTipSpaces.left.getWorldPosition(this.leftTip);
    // +x of the guitar runs from the neck (your left hand) to the body.
    this.axisY.copy(this.anchor).sub(this.leftTip);
    if (this.axisY.length() > 0.1) this.axisX.copy(this.axisY).normalize();
    // The face (+z) tilts up and back toward you, as in the resting pose,
    // so you can see the strings and chord blocks.
    this.axisZ.set(-f.x * 0.55, 0.83, -f.z * 0.55);
    this.axisZ.addScaledVector(this.axisX, -this.axisZ.dot(this.axisX)).normalize();
    this.axisY.crossVectors(this.axisZ, this.axisX);
    this.basis.makeBasis(this.axisX, this.axisY, this.axisZ);
    this.targetQuat.setFromRotationMatrix(this.basis);
    this.targetPos.copy(this.anchor).addScaledVector(this.axisX, -STRUM_CENTER_X);

    // Convert to the guitar's parent space, then ease toward it.
    const parent = this.guitar.parent!;
    parent.updateWorldMatrix(true, false);
    parent.worldToLocal(this.targetPos);
    parent.getWorldQuaternion(this.parentQuat).invert();
    this.targetQuat.premultiply(this.parentQuat);
    const k = 1 - Math.exp(-dt * 20);
    this.guitar.position.lerp(this.targetPos, k);
    this.guitar.quaternion.slerp(this.targetQuat, k);
  }

  private setChord(id: number): void {
    if (id === this.chord) return;
    this.chord = id;
    this.blocks[id].pulse = 1;
    trace('chord', CHORDS[id].name);
  }

  private pluck(i: number, velocity: number, when = 0, down = true): void {
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
        // Kept quiet and dark on purpose: six strings ring at once. Upstrokes
        // catch the strings lighter and brighter.
        when, velocity: velocity * (down ? 0.45 : 0.36), brightness: down ? 0.25 : 0.4, live: true,
        x: this.worldPos.x, y: this.worldPos.y, z: this.worldPos.z,
      });
    }
    if (this.learning && this.resumeIn < 0) this.judge(when || audio.now, down);
  }

  /** A strum counts for a beat if it is in time and on the right chord. */
  private judge(t: number, down: boolean): void {
    if (t - this.judgedAt < 0.15) return; // the other strings of the same strum
    this.judgedAt = t;
    const { bars, strokes } = LESSONS[this.lesson];
    for (let n = 0; n < this.beats; n++) {
      if (this.beatState[n] !== 0) continue;
      const off = this.startTime + n * BEAT - t; // > 0: early
      if (Math.abs(off) > HIT_WINDOW) continue;
      if (bars[Math.floor(n / 4)] !== this.chord) {
        this.showFeel(`Wrong chord: hold ${CHORDS[bars[Math.floor(n / 4)]].name}`, '#ff8899');
        return;
      }
      this.beatState[n] = 1;
      this.hits++;
      const wantDown = strokes[n % 4] === 'D';
      if (wantDown !== down) this.showFeel(wantDown ? 'Good - try a downstroke' : 'Good - try an upstroke', '#ffc86b');
      else if (Math.abs(off) <= PERFECT) this.showFeel('Perfect', '#6bffc0');
      else this.showFeel(off > 0 ? 'Early' : 'Late', '#ffc86b');
      const p = this.guitar.position;
      fxAt(stage.stations.guitar, p.x + STRUM_CENTER_X, p.y, p.z, COLORS.mint, 0.3, 0);
      trace('strum hit beat', n, CHORDS[this.chord].name);
      return;
    }
  }

  private showFeel(text: string, color: string): void {
    this.feel.setColor(color);
    this.feel.set(text);
    this.feelAlpha = 1;
  }

  private startLearning(): void {
    audio.start();
    this.learning = true;
    this.lesson = this.pick === 0 ? 0 : BASICS + this.pick - 1;
    this.lastLesson = this.pick === 0 ? BASICS - 1 : this.lesson;
    stage.setPebbleLabel('learnGuitar', 'Stop lesson');
    this.beginAttempt();
  }

  private stopLearning(message: string): void {
    this.learning = false;
    this.resumeIn = -1;
    this.guide.visible = false;
    this.arrow.opacity = 0;
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
      if (this.lesson === this.lastLesson) {
        this.stopLearning(`${this.pick === 0 ? 'You played a song!' : `${LESSONS[this.lesson].name} complete!`} ${this.hits}/${this.beats}`);
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
      this.arrow.opacity = 0;
      if (now > this.startTime + (this.beats - 1) * BEAT + HIT_WINDOW) this.finishAttempt();
      return -1;
    }
    const until = this.startTime + next * BEAT - now;
    const frac = Math.min(1, Math.max(0, until / LEAD));
    this.guide.visible = until < LEAD;
    this.guide.scale.setScalar(0.12 * (1 + frac * 1.8));
    this.guide.material.opacity = 1 - frac * 0.7;
    this.guide.material.color.setHex(frac < 0.12 ? 0xffffff : COLORS.gold);
    const down = LESSONS[this.lesson].strokes[next % 4] === 'D';
    this.arrow.set(down ? '\u2193' : '\u2191');
    this.arrow.setColor(down ? '#ffc86b' : '#6bd8ff');
    this.arrow.opacity = until < LEAD ? 1 - frac * 0.6 : 0;
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
      // Only a fingertip actually at the strings strums: the strings lie at
      // z = 0, so allow just the finger's own thickness either side (plus a
      // little behind, where the finger pushes through toward the body).
      const near = z > -0.03 && z < 0.018;

      // Neck: touching a block selects (and keeps) that chord.
      if (Math.abs(z) < 0.04 && x > NECK_START && x < NECK_START + BLOCK * CHORDS.length && Math.abs(y) < 0.06) {
        const pos = (x - NECK_START) / BLOCK;
        // While holding, the hand is always on the neck: only switch chord
        // once it is clearly inside the next block, so it never flickers.
        const frac = pos - Math.floor(pos);
        if (!this.holding || h !== 0 || (frac > 0.15 && frac < 0.85)) {
          this.setChord(Math.min(CHORDS.length - 1, Math.floor(pos)));
        }
      }

      // Body: a string sounds when the fingertip crosses its line.
      const inStrum = near && x > STRUM_MIN_X && x < STRUM_MAX_X;
      if (inStrum && this.prevValid[h]) {
        const velocity = Math.min(1, Math.max(0.3, speed / 1.2));
        for (let i = 0; i < STRINGS; i++) {
          const sy = stringY(i);
          // Strings are numbered top (low E) to bottom, so a fingertip moving
          // toward negative y is a downstroke.
          if ((this.prevY[h] - sy) * (y - sy) < 0) this.pluck(i, velocity, 0, y < this.prevY[h]);
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
      if (this.holding) this.setHolding(false);
      return;
    }
    const dt = Math.min(delta, 0.05);
    if (this.holding) {
      if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) this.setHolding(false);
      else this.followHands(dt);
    }
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.detectHands(delta);
    const wanted = this.learning ? this.updateLesson(dt) : -1;
    this.feelAlpha = Math.max(0, this.feelAlpha - dt * 1.2);
    this.feel.opacity = this.feelAlpha;

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
