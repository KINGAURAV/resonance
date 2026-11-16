/**
 * SequencerSystem: two tilted orbits of eight steps around the core.
 * Resonators docked on a slot are triggered as the playhead passes.
 *
 * Timing uses the AudioContext clock with a short look-ahead: each frame we
 * schedule every step that falls inside the next 120 ms at its exact time.
 * Frame hitches therefore never shift the rhythm; only the visuals wait.
 */
import {
  AdditiveBlending,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { COLORS, LAYOUT, setShown, slotPosition, stage, trace } from '../stage.js';
import { glowSprite } from '../visuals/textures.js';
import { flashResonator, soundResonator } from './resonators.js';

const LOOKAHEAD = 0.12;
const QUEUE = 32;
const tmp = new Vector3();

export class SequencerSystem extends createSystem({}) {
  private group = new Group();
  private dots: Sprite[] = [];
  private heads: Sprite[] = [];
  private nextTime = 0;
  private stepCount = 0; // total steps scheduled since play started
  private wasRunning = false;
  // Visual events waiting for their audio time (fixed-size ring buffer).
  private qTime = new Float64Array(QUEUE);
  private qId = new Int8Array(QUEUE).fill(-1);
  private qNext = 0;

  init(): void {
    this.group.name = 'Orbits';
    const rings = new Group();
    rings.rotation.x = LAYOUT.ringTilt;
    LAYOUT.ringRadii.forEach((r, i) => {
      const torus = new Mesh(
        new TorusGeometry(r, 0.0012, 6, 96),
        new MeshBasicMaterial({
          color: i === 0 ? COLORS.cyan : COLORS.violet,
          transparent: true,
          opacity: 0.55,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      torus.rotation.x = Math.PI / 2;
      torus.raycast = () => {};
      rings.add(torus);
      const head = glowSprite(0xffffff, 0.05, 0.9);
      this.heads.push(head);
      this.group.add(head);
    });
    this.group.add(rings);
    for (let s = 0; s < stage.slots.length; s++) {
      const dot = glowSprite(s < LAYOUT.steps ? COLORS.cyan : COLORS.violet, 0.022, 0.5);
      dot.position.copy(slotPosition(s, tmp));
      this.dots.push(dot);
      this.group.add(dot);
    }
    stage.root.add(this.group);
    setShown(this.group, false);
  }

  private queueFlash(id: number, time: number): void {
    this.qId[this.qNext] = id;
    this.qTime[this.qNext] = time;
    this.qNext = (this.qNext + 1) % QUEUE;
  }

  update(): void {
    const visible = stage.tutorialStep >= 2 && (stage.mode === 'playground' || stage.showAll);
    if (this.group.visible !== visible) setShown(this.group, visible);
    if (!visible) {
      this.wasRunning = false; // restart cleanly when the orbits return
      return;
    }

    const now = audio.now;
    const stepDur = 60 / stage.bpm / 2; // eighth notes
    const running = stage.playing && audio.running;
    if (running && !this.wasRunning) {
      this.nextTime = now + 0.06;
      this.stepCount = 0;
    }
    this.wasRunning = running;

    if (running) {
      // After a long stall (tab hidden, headset removed) skip ahead instead
      // of firing a burst of late notes.
      if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
      while (this.nextTime < now + LOOKAHEAD) {
        const step = this.stepCount % LAYOUT.steps;
        for (let ring = 0; ring < LAYOUT.ringRadii.length; ring++) {
          const id = stage.slots[ring * LAYOUT.steps + step];
          if (id < 0) continue;
          soundResonator(stage.resonators[id], this.nextTime, ring === 0 ? 0.85 : 0.7);
          trace('seq', step, stage.resonators[id].kind, this.nextTime.toFixed(3));
          this.queueFlash(id, this.nextTime);
        }
        if (stage.beat) {
          const p = stage.root.position;
          const o = { when: this.nextTime, x: p.x, y: p.y, z: p.z };
          if (step % 4 === 0) audio.play('kick', 0, { ...o, velocity: 0.8 });
          if (step % 4 === 2) audio.play('snare', 0, { ...o, velocity: 0.45 });
          audio.play('hat', 0, { ...o, velocity: step % 2 ? 0.35 : 0.2 });
        }
        this.nextTime += stepDur;
        this.stepCount++;
      }
    }

    // Fire queued glows when their scheduled moment arrives.
    for (let i = 0; i < QUEUE; i++) {
      const id = this.qId[i];
      if (id >= 0 && this.qTime[i] <= now) {
        flashResonator(stage.resonators[id]);
        this.qId[i] = -1;
      }
    }

    // Playhead position is derived from the audio clock, not frame count.
    const pos = running ? this.stepCount - (this.nextTime - now) / stepDur - 1 : -1;
    const a = (pos / LAYOUT.steps) * Math.PI * 2;
    for (let ring = 0; ring < this.heads.length; ring++) {
      const r = LAYOUT.ringRadii[ring];
      const flatZ = Math.cos(a) * r;
      const h = this.heads[ring];
      h.visible = running;
      h.position.set(
        Math.sin(a) * r,
        -flatZ * Math.sin(LAYOUT.ringTilt),
        flatZ * Math.cos(LAYOUT.ringTilt),
      );
    }
    const current = ((Math.round(pos) % LAYOUT.steps) + LAYOUT.steps) % LAYOUT.steps;
    for (let s = 0; s < this.dots.length; s++) {
      const lit = running && s % LAYOUT.steps === current;
      const d = this.dots[s];
      d.visible = stage.slots[s] < 0;
      d.material.opacity = lit ? 1 : s % LAYOUT.steps === 0 ? 0.6 : 0.35;
      d.scale.setScalar(lit ? 0.036 : 0.022);
    }
  }
}
