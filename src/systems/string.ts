/**
 * StringSystem: the stretchable musical string.
 *  - pinch-grab either glowing end (or both, one per hand) to stretch it
 *  - sweep a fingertip through it to pluck
 * Longer / tighter string = higher note (snapped to the pentatonic scale).
 * Faster plucks are louder; plucking near an end sounds brighter.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  createSystem,
  DoubleSide,
  Grabbed,
  GrabSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  OneHandGrabbable,
  Pressed,
  RayInteractable,
  SphereGeometry,
  Sprite,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { noteFreq, noteName } from '../audio/scale.js';
import { StringBody, StringHandle } from '../resonance-components.js';
import { COLORS, grabOnly, setShown, stage, trace } from '../stage.js';
import { glowSprite, Label } from '../visuals/textures.js';

const SEG = 40;
const PLUCK_RADIUS = 0.016;
const MIN_LEN = 0.1;
const MAX_LEN = 0.55;
const LOW_NOTE = -5; // C3
const HIGH_NOTE = 9; // A5
const X_AXIS = new Vector3(1, 0, 0);

/** Build an indexed triangle strip with two vertices per string point. */
function ribbonGeometry(): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array((SEG + 1) * 6), 3));
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  return geo;
}

export class StringSystem extends createSystem({
  bodyPressed: { required: [StringBody, Pressed] },
}) {
  private group = new Group();
  private handles: Group[] = [];
  private handleEntities: Entity[] = [];
  private core!: Mesh;
  private glow!: Mesh;
  private body!: Mesh;
  private label!: Label;
  private beads: Sprite[] = [];

  private a = new Vector3();
  private b = new Vector3();
  private dir = new Vector3();
  private side = new Vector3();
  private wobble = new Vector3(0, 1, 0);
  private point = new Vector3();
  private cam = new Vector3();
  private tip = new Vector3();
  private sample = new Vector3();
  private prevTip = [new Vector3(), new Vector3()];
  private prevDist = [1, 1];
  private colLow = new Color(COLORS.cyan);
  private colHigh = new Color(COLORS.magenta);

  private note = 0;
  private amp = 0; // current visual vibration amplitude (meters)
  private pluckAge = 10;
  private pluckS = 0.5;
  private lastPluck = -1;

  init(): void {
    this.group.name = 'MusicalString';
    const mat = (opacity: number) =>
      new MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
    this.core = new Mesh(ribbonGeometry(), mat(1));
    this.glow = new Mesh(ribbonGeometry(), mat(0.22));
    for (const m of [this.core, this.glow]) {
      m.frustumCulled = false;
      m.raycast = () => {};
      this.group.add(m);
    }
    for (let i = 0; i < 2; i++) {
      const bead = glowSprite(0xffffff, 0.035, 0);
      this.beads.push(bead);
      this.group.add(bead);
    }
    this.label = new Label('C4', 0.016);
    this.group.add(this.label.sprite);
    stage.root.add(this.group);

    // Grabbable ends.
    for (let end = 0; end < 2; end++) {
      const h = new Group();
      h.name = end === 0 ? 'String End Left' : 'String End Right';
      h.add(
        new Mesh(new SphereGeometry(0.014, 16, 12), new MeshBasicMaterial({ color: 0xe8fbff })),
        glowSprite(end === 0 ? COLORS.cyan : COLORS.magenta, 0.1, 0.7),
      );
      h.position.copy(stage.stringEnds[end]);
      const e = this.world.createTransformEntity(h, { parent: stage.rootEntity! });
      e.addComponent(StringHandle, { end });
      e.addComponent(OneHandGrabbable, {});
      this.handles.push(h);
      this.handleEntities.push(e);
    }

    // Invisible, slightly fat collider so a pinch-ray or mouse can pluck too.
    this.body = new Mesh(
      new BoxGeometry(1, 0.03, 0.03),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.body.name = 'String Body';
    const be = this.world.createTransformEntity(this.body, { parent: stage.rootEntity! });
    be.addComponent(StringBody);
    be.addComponent(RayInteractable);
    this.cleanupFuncs.push(
      this.queries.bodyPressed.subscribe('qualify', () => {
        if (stage.tutorialStep >= 1) this.pluck(0.3 + Math.random() * 0.4, 0.75);
      }),
    );
    this.setVisible(false);
  }

  private setVisible(v: boolean): void {
    setShown(this.group, v);
    this.handles.forEach((h) => setShown(h, v));
    setShown(this.body, v);
  }

  private pluck(s: number, strength: number): void {
    const now = performance.now() / 1000;
    if (now - this.lastPluck < 0.12) return; // debounce
    this.lastPluck = now;
    audio.start();
    this.point.copy(this.a).lerp(this.b, s);
    const local = this.point.clone();
    stage.root.localToWorld(this.point);
    audio.play('pluck', noteFreq(this.note), {
      velocity: strength,
      brightness: 0.3 + Math.abs(s - 0.5) * 1.3,
      x: this.point.x, y: this.point.y, z: this.point.z,
    });
    trace('pluck', noteName(this.note), 's', s.toFixed(2), 'vel', strength.toFixed(2));
    this.amp = 0.006 + strength * 0.016;
    this.pluckAge = 0;
    this.pluckS = s;
    stage.ripple(local.x, local.y, local.z, COLORS.cyan, 0.16 + strength * 0.12);
    stage.burst(local.x, local.y, local.z, COLORS.magenta, 8);
    stage.onPluck();
  }

  /** Detect a fingertip sweeping through the string. */
  private detectPlucks(rawDt: number, len: number): void {
    const grab = this.world.getSystem(GrabSystem);
    const sides = ['left', 'right'] as const;
    for (let h = 0; h < 2; h++) {
      this.player.indexTipSpaces[sides[h]].getWorldPosition(this.tip);
      stage.root.worldToLocal(this.tip);
      const moved = this.tip.distanceTo(this.prevTip[h]);
      const speed = moved / Math.max(rawDt, 0.001);
      const holding =
        grab?.getHolderHand(this.handleEntities[0]) === sides[h] ||
        grab?.getHolderHand(this.handleEntities[1]) === sides[h];
      // A fast finger can cross the whole string between two frames, so walk
      // along its path in small steps instead of testing only the end point.
      const steps = Math.min(10, Math.max(1, Math.ceil(moved / 0.008)));
      let dist = this.prevDist[h];
      for (let k = 1; k <= steps; k++) {
        this.sample.copy(this.prevTip[h]).lerp(this.tip, k / steps);
        // Closest point on the segment a-b.
        this.point.copy(this.sample).sub(this.a);
        const s = Math.min(1, Math.max(0, this.point.dot(this.dir) / len));
        this.point.copy(this.a).addScaledVector(this.dir, s * len);
        const prev = dist;
        dist = this.point.distanceTo(this.sample);
        const entered = dist <= PLUCK_RADIUS && prev > PLUCK_RADIUS;
        // Ignore the ends (that is where you grab) and tracking jumps.
        if (entered && !holding && s > 0.06 && s < 0.94 && speed < 6) {
          // Vibrate in the direction the finger was travelling.
          this.wobble.copy(this.tip).sub(this.prevTip[h]);
          this.wobble.addScaledVector(this.dir, -this.wobble.dot(this.dir));
          if (this.wobble.lengthSq() < 1e-8) this.wobble.set(0, 1, 0);
          this.wobble.normalize();
          this.pluck(s, Math.min(1, Math.max(0.3, speed / 0.9)));
        }
      }
      this.prevDist[h] = dist;
      this.prevTip[h].copy(this.tip);
    }
  }

  private writeRibbon(mesh: Mesh, halfWidth: number, time: number, len: number): void {
    const pos = mesh.geometry.attributes.position as BufferAttribute;
    const arr = pos.array as Float32Array;
    const decay = Math.exp(-this.pluckAge * 2.2);
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      // Standing wave (fundamental + a little 2nd harmonic) that dies away.
      const shape =
        Math.sin(Math.PI * s) * Math.cos(time * 88) +
        0.35 * Math.sin(2 * Math.PI * s) * Math.cos(time * 141 + this.pluckS * 6);
      const d = this.amp * decay * shape * Math.min(1.6, len / 0.26);
      const x = this.a.x + this.dir.x * s * len + this.wobble.x * d;
      const y = this.a.y + this.dir.y * s * len + this.wobble.y * d;
      const z = this.a.z + this.dir.z * s * len + this.wobble.z * d;
      const j = i * 6;
      arr[j] = x + this.side.x * halfWidth;
      arr[j + 1] = y + this.side.y * halfWidth;
      arr[j + 2] = z + this.side.z * halfWidth;
      arr[j + 3] = x - this.side.x * halfWidth;
      arr[j + 4] = y - this.side.y * halfWidth;
      arr[j + 5] = z - this.side.z * halfWidth;
    }
    pos.needsUpdate = true;
  }

  update(delta: number, time: number): void {
    const visible = stage.tutorialStep >= 1;
    if (this.group.visible !== visible) this.setVisible(visible);
    if (!visible) return;
    const dt = Math.min(delta, 0.05);

    // Ends follow their handles; other systems (load/reset) may move them.
    for (let end = 0; end < 2; end++) {
      grabOnly(this.handles[end]);
      const held = this.handleEntities[end].hasComponent(Grabbed);
      if (held) stage.stringEnds[end].copy(this.handles[end].position);
      else this.handles[end].position.lerp(stage.stringEnds[end], 1 - Math.exp(-dt * 12));
    }
    this.a.copy(this.handles[0].position);
    this.b.copy(this.handles[1].position);
    this.dir.copy(this.b).sub(this.a);
    const len = Math.max(0.02, this.dir.length());
    this.dir.divideScalar(len);

    // Tension -> pitch, snapped to the scale so it always harmonises.
    const t = Math.min(1, Math.max(0, (len - MIN_LEN) / (MAX_LEN - MIN_LEN)));
    const note = Math.round(LOW_NOTE + t * (HIGH_NOTE - LOW_NOTE));
    if (note !== this.note) {
      this.note = note;
      this.label.set(noteName(note));
    }
    const mat = this.core.material as MeshBasicMaterial;
    mat.color.copy(this.colLow).lerp(this.colHigh, t);
    (this.glow.material as MeshBasicMaterial).color.copy(mat.color);

    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      this.detectPlucks(delta, len);
    }

    // Ribbon faces the viewer: side = string direction x view direction.
    this.world.camera.getWorldPosition(this.cam);
    stage.root.worldToLocal(this.cam);
    this.point.copy(this.a).lerp(this.b, 0.5);
    this.side.copy(this.cam).sub(this.point).cross(this.dir);
    if (this.side.lengthSq() < 1e-8) this.side.set(0, 1, 0);
    this.side.normalize();
    this.pluckAge += dt;
    const energy = this.amp * Math.exp(-this.pluckAge * 2.2) * 40;
    this.writeRibbon(this.core, 0.0016 + energy * 0.0012, time, len);
    this.writeRibbon(this.glow, 0.007 + energy * 0.006, time, len);

    // Two pulses race from the pluck point to the ends and bounce back.
    const travel = this.pluckAge * 1.6;
    for (let i = 0; i < 2; i++) {
      let s = this.pluckS + (i === 0 ? travel : -travel);
      s = Math.abs(((s % 2) + 2) % 2); // reflect into 0..2
      if (s > 1) s = 2 - s;
      const bead = this.beads[i];
      bead.position.copy(this.a).addScaledVector(this.dir, s * len);
      bead.material.opacity = Math.max(0, 1 - this.pluckAge * 0.9);
      bead.visible = this.pluckAge < 1.1;
    }

    this.label.sprite.position.copy(this.point);
    this.label.sprite.position.y += 0.035;
    this.body.position.copy(this.point);
    this.body.quaternion.setFromUnitVectors(X_AXIS, this.dir);
    this.body.scale.set(len, 1, 1);
  }
}
