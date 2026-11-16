/**
 * DrumSystem: a five-pad kit played with bare hands, plus "Learn a beat".
 *
 * Free play: strike any pad with a fingertip; faster strikes are louder.
 * Learn mode: a ring closes in on the pad you should hit and lands exactly
 * on the beat. Hits are judged against the audio clock, so the feedback is
 * about your timing, not the frame rate. Three short lessons build one groove.
 */
import {
  AdditiveBlending,
  createSystem,
  Grabbed,
  Group,
  OneHandGrabbable,
  type Entity,
  Mesh,
  MeshStandardMaterial,
  Pressed,
  Quaternion,
  RayInteractable,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  MeshBasicMaterial,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio, type VoiceKind } from '../audio/engine.js';
import { DrumPad } from '../resonance-components.js';
import { COLORS, grabOnly, setShown, stage, trace } from '../stage.js';
import { buildCymbal, buildDrum } from '../visuals/instruments.js';
import { glowSprite, Label, ringTexture } from '../visuals/textures.js';

interface PadDef {
  voice: VoiceKind;
  name: string;
  color: number;
  radius: number;
  pos: [number, number, number];
}

// Laid out like a real kit, but shrunk to fit a seated two-foot reach.
const KIT: PadDef[] = [
  { voice: 'kick', name: 'Kick', color: COLORS.violet, radius: 0.062, pos: [0, -0.03, 0.17] },
  { voice: 'snare', name: 'Snare', color: COLORS.cyan, radius: 0.052, pos: [-0.15, 0.01, 0.09] },
  { voice: 'tom', name: 'Tom', color: COLORS.mint, radius: 0.052, pos: [0.15, 0.01, 0.09] },
  { voice: 'hat', name: 'Hi-hat', color: COLORS.gold, radius: 0.044, pos: [-0.27, 0.07, -0.03] },
  { voice: 'crash', name: 'Crash', color: COLORS.magenta, radius: 0.05, pos: [0.27, 0.07, -0.03] },
];
const PAD_TILT = 0.5; // radians: pads lean toward the player
const SHELL_COLOR = 0x16162c; // dark anodised metal
const DEPTH: Partial<Record<VoiceKind, number>> = { kick: 0.09, snare: 0.045, tom: 0.065 };

// Each lesson is one bar of eighth notes; -1 is a rest. Pad ids index KIT.
const LESSONS: { name: string; steps: number[] }[] = [
  { name: 'Lesson 1: Heartbeat', steps: [0, -1, 1, -1, 0, -1, 1, -1] },
  { name: 'Lesson 2: Add the hi-hat', steps: [0, 3, 1, 3, 0, 3, 1, 3] },
  { name: 'Lesson 3: The groove', steps: [0, 3, 1, 3, 0, 0, 1, 2] },
];
const LESSON_BPM = 80;
const STEP = 60 / LESSON_BPM / 2; // seconds per eighth note
const PASS_STEPS = 16; // two bars per attempt
const HIT_WINDOW = 0.17; // seconds either side of the beat that still counts
const LEAD = 0.9; // seconds a guide ring is visible before its beat
const PASS_MARK = 0.7;
const GUIDES = 6;

interface PadState {
  def: PadDef;
  object: Group;
  model: Group;
  cymbal: boolean;
  mat: MeshStandardMaterial;
  pulse: number;
  lastHit: number;
}

export class DrumSystem extends createSystem({
  pressed: { required: [DrumPad, Pressed] },
}) {
  private kit = new Group();
  private pads: PadState[] = [];
  private entities: Entity[] = [];
  private halos: Sprite[] = [];
  private guides: Sprite[] = [];
  private status!: Label;
  private invTilt = new Quaternion();
  private tip = new Vector3();
  private local = new Vector3();
  private prevTip = [new Vector3(), new Vector3()];
  private speed = [0, 0];
  private armed = new Uint8Array(2 * KIT.length).fill(1);

  // Learn-mode state.
  private learning = false;
  private lesson = 0;
  private startTime = 0; // audio time of step 0 of this attempt
  private noteState = new Uint8Array(PASS_STEPS); // 0 pending, 1 hit, 2 missed
  private clicksScheduled = 0;
  private hits = 0;
  private resumeIn = -1; // pause between attempts (seconds)

  init(): void {
    this.kit.name = 'DrumKit';
    stage.root.add(this.kit);
    this.invTilt.setFromAxisAngle(new Vector3(1, 0, 0), -PAD_TILT);

    KIT.forEach((def, id) => {
      const object = new Group();
      object.name = `Drum ${def.name}`;
      const cymbal = def.voice === 'hat' || def.voice === 'crash';
      const model = cymbal
        ? buildCymbal(def.radius, def.voice === 'hat', def.color)
        : buildDrum(def.radius, DEPTH[def.voice] ?? 0.05, SHELL_COLOR, def.color);
      const mat = model.hitMaterial;
      const label = new Label(def.name, 0.021);
      label.sprite.position.set(0, -0.034, def.radius + 0.022);
      const halo = glowSprite(def.color, def.radius * 3.4, 0.3);
      halo.position.y = 0.004;
      this.halos.push(halo);
      object.add(model.group, halo, label.sprite);
      object.position.set(def.pos[0], def.pos[1], def.pos[2]);
      object.rotation.x = PAD_TILT;
      const e = this.world.createTransformEntity(object, { parent: stage.rootEntity! });
      e.addComponent(DrumPad, { id });
      e.addComponent(RayInteractable); // mouse fallback
      // Pinch a pad to move it: build the kit that suits your reach. Rotation
      // is locked so strike detection keeps its known tilt.
      e.addComponent(OneHandGrabbable, { rotate: false });
      this.entities.push(e);
      this.pads.push({ def, object, model: model.group, cymbal, mat, pulse: 0, lastHit: -1 });
      setShown(object, false);
    });

    for (let i = 0; i < GUIDES; i++) {
      const g = new Sprite(
        new SpriteMaterial({ map: ringTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false }),
      );
      g.raycast = () => {};
      g.visible = false;
      g.renderOrder = 5;
      this.guides.push(g);
      this.kit.add(g);
    }
    this.status = new Label('', 0.034, '#ffffff');
    this.status.sprite.position.set(0, 0.25, -0.08);
    this.kit.add(this.status.sprite);
    setShown(this.kit, false);

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (entity) => {
        if (stage.mode === 'drums') this.strike(entity.getValue(DrumPad, 'id') ?? 0, 0.8);
      }),
    );
    stage.actions.learn = () => (this.learning ? this.stopLearning('Free play') : this.startLearning());
  }

  private startLearning(): void {
    audio.start();
    this.learning = true;
    this.lesson = 0;
    stage.setPebbleLabel('learn', 'Stop lesson');
    this.beginAttempt();
  }

  private stopLearning(message: string): void {
    this.learning = false;
    this.resumeIn = -1;
    this.status.set(message);
    stage.setPebbleLabel('learn', 'Learn a beat');
    for (const g of this.guides) g.visible = false;
  }

  /** Start (or restart) the current lesson after a four-click count-in. */
  private beginAttempt(): void {
    this.noteState.fill(0);
    this.hits = 0;
    this.clicksScheduled = -4; // four count-in clicks before step 0
    this.startTime = audio.now + 4 * STEP * 2 + 0.1;
    this.resumeIn = -1;
    this.status.set(LESSONS[this.lesson].name);
    stage.toast('Hit when the ring lands');
    trace('lesson', this.lesson, 'start', this.startTime.toFixed(2));
  }

  private finishAttempt(): void {
    const steps = LESSONS[this.lesson].steps;
    let total = 0;
    for (let n = 0; n < PASS_STEPS; n++) if (steps[n % steps.length] >= 0) total++;
    const score = this.hits / total;
    trace('lesson', this.lesson, 'score', this.hits, '/', total);
    if (score >= PASS_MARK) {
      stage.burst(0, 0.1, 0, COLORS.mint, 40);
      if (this.lesson === LESSONS.length - 1) {
        this.stopLearning(`You can drum! ${this.hits}/${total}`);
        return;
      }
      this.lesson++;
      this.status.set(`Nice! ${this.hits}/${total}`);
    } else {
      this.status.set(`${this.hits}/${total} - try again`);
    }
    this.resumeIn = 2.2;
  }

  private strike(id: number, velocity: number): void {
    const now = performance.now() / 1000;
    const pad = this.pads[id];
    if (now - pad.lastHit < 0.07) return; // debounce
    pad.lastHit = now;
    audio.start();
    const p = pad.object.position;
    this.local.copy(p);
    stage.root.localToWorld(this.local);
    audio.play(pad.def.voice, 0, { velocity, live: true, x: this.local.x, y: this.local.y, z: this.local.z });
    pad.pulse = 1;
    let judged = '';
    if (this.learning && this.resumeIn < 0) judged = this.judge(id) ? 'hit' : 'stray';
    const color = judged === 'hit' ? COLORS.mint : pad.def.color;
    stage.ripple(p.x, p.y, p.z, color, pad.def.radius * (judged === 'hit' ? 5 : 3.2));
    stage.burst(p.x, p.y + 0.01, p.z, color, judged === 'hit' ? 14 : 7);
    trace('drum', pad.def.name, velocity.toFixed(2), judged);
  }

  /** Match a strike to the closest pending note for that pad. */
  private judge(id: number): boolean {
    const steps = LESSONS[this.lesson].steps;
    const t = audio.now;
    let best = -1;
    let bestD = HIT_WINDOW;
    for (let n = 0; n < PASS_STEPS; n++) {
      if (this.noteState[n] !== 0 || steps[n % steps.length] !== id) continue;
      const d = Math.abs(this.startTime + n * STEP - t);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best < 0) return false;
    this.noteState[best] = 1;
    this.hits++;
    return true;
  }

  /** Fingertip strikes, tested in each pad's own tilted frame. */
  private detectStrikes(rawDt: number): void {
    const sides = ['left', 'right'] as const;
    for (let h = 0; h < 2; h++) {
      this.player.indexTipSpaces[sides[h]].getWorldPosition(this.tip);
      stage.root.worldToLocal(this.tip);
      // Hand poses update less often than frames render: smooth the speed.
      const raw = this.tip.distanceTo(this.prevTip[h]) / Math.max(rawDt, 0.001);
      this.speed[h] += (Math.min(raw, 4) - this.speed[h]) * 0.4;
      const speed = this.speed[h];
      this.prevTip[h].copy(this.tip);
      for (let id = 0; id < this.pads.length; id++) {
        const pad = this.pads[id];
        if (this.entities[id].hasComponent(Grabbed)) continue; // being moved
        this.local.copy(this.tip).sub(pad.object.position).applyQuaternion(this.invTilt);
        const radial = Math.hypot(this.local.x, this.local.z);
        const r = pad.def.radius;
        const k = h * KIT.length + id;
        if (this.local.y > 0.05 || radial > r + 0.035) this.armed[k] = 1;
        else if (this.armed[k] && radial < r + 0.008 && this.local.y < 0.028 && this.local.y > -0.05) {
          this.armed[k] = 0;
          this.strike(id, Math.min(1, Math.max(0.35, speed / 1.0)));
        }
      }
    }
  }

  private updateLesson(dt: number): void {
    const now = audio.now;
    if (this.resumeIn >= 0) {
      this.resumeIn -= dt;
      if (this.resumeIn < 0) this.beginAttempt();
      return;
    }
    const steps = LESSONS[this.lesson].steps;

    // Metronome: a click on every quarter note, scheduled slightly ahead.
    while (this.clicksScheduled < PASS_STEPS / 2) {
      const t = this.startTime + this.clicksScheduled * STEP * 2;
      if (t > now + 0.15) break;
      const p = stage.root.position;
      const accent = ((this.clicksScheduled % 4) + 4) % 4 === 0;
      if (t > now) audio.play('click', accent ? 1600 : 1100, { when: t, velocity: 0.5, x: p.x, y: p.y, z: p.z });
      this.clicksScheduled++;
    }

    // Guide rings shrink onto their pad and arrive exactly on the beat.
    let used = 0;
    for (let n = 0; n < PASS_STEPS; n++) {
      const padId = steps[n % steps.length];
      if (padId < 0 || this.noteState[n] !== 0) continue;
      const until = this.startTime + n * STEP - now;
      if (until < -HIT_WINDOW) {
        this.noteState[n] = 2; // missed
        const p = this.pads[padId].object.position;
        stage.ripple(p.x, p.y, p.z, 0xff3355, 0.08);
        continue;
      }
      if (until > LEAD || used >= GUIDES) continue;
      const pad = this.pads[padId];
      const frac = Math.max(0, until / LEAD);
      const g = this.guides[used++];
      g.visible = true;
      g.position.copy(pad.object.position);
      g.position.y += 0.012;
      g.scale.setScalar(pad.def.radius * 2.3 * (1 + frac * 2.4));
      g.material.color.setHex(frac < 0.12 ? 0xffffff : pad.def.color);
      g.material.opacity = 1 - frac * 0.75;
      if (frac < 0.15) pad.pulse = Math.max(pad.pulse, 0.45);
    }
    for (let i = used; i < GUIDES; i++) this.guides[i].visible = false;

    if (now > this.startTime + (PASS_STEPS - 1) * STEP + HIT_WINDOW + 0.05) this.finishAttempt();
  }

  update(delta: number, time: number): void {
    const visible = stage.mode === 'drums';
    if (this.kit.visible !== visible) {
      setShown(this.kit, visible);
      this.pads.forEach((p) => setShown(p.object, visible));
      if (visible) this.status.set('Free play');
      else if (this.learning) this.stopLearning('');
    }
    if (!visible) return;
    const dt = Math.min(delta, 0.05);
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.detectStrikes(delta);
    if (this.learning) this.updateLesson(dt);
    for (let id = 0; id < this.pads.length; id++) {
      const pad = this.pads[id];
      grabOnly(pad.object);
      this.halos[id].material.opacity = 0.28 + pad.pulse * 0.7;
      this.halos[id].scale.setScalar(pad.def.radius * (3.4 + pad.pulse * 2.2));
      pad.pulse = Math.max(0, pad.pulse - dt * (pad.cymbal ? 1.6 : 4));
      pad.mat.emissiveIntensity = 0.1 + pad.pulse * (pad.cymbal ? 0.9 : 1.6);
      // Cymbals rock on their stand after a hit; drums stay put.
      if (pad.cymbal) pad.model.rotation.z = Math.sin(time * 34) * pad.pulse * 0.1;
    }
  }
}
