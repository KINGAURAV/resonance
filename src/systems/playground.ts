/**
 * PlaygroundSystem: owns the environment (core, particles, ripples), places
 * the whole playground in front of the seated player, and feeds the audio
 * analysis into the visuals every frame.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  createSystem,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { COLORS, LAYOUT, stage } from '../stage.js';
import { glowSprite, glowTexture, Label, ringTexture } from '../visuals/textures.js';

const RIPPLES = 14;
const SPARKS = 240;
const DUST = 320;
const WAVE_POINTS = 96;

export class PlaygroundSystem extends createSystem({}) {
  private headPos = new Vector3();
  private headDir = new Vector3();
  private tmpColor = new Color();
  private placed = false;
  private settleFrames = 0;

  private core!: Group;
  private coreInner!: Mesh;
  private coreShell!: Mesh;
  private coreGlow!: Sprite;
  private coreAura!: Sprite;
  private wave!: LineLoop;
  private dust!: Points;
  private dustMat!: PointsMaterial;

  private ripples: Sprite[] = [];
  private rippleLife = new Float32Array(RIPPLES);
  private rippleSize = new Float32Array(RIPPLES);
  private nextRipple = 0;

  private sparks!: Points;
  private sparkPos = new Float32Array(SPARKS * 3);
  private sparkVel = new Float32Array(SPARKS * 3);
  private sparkCol = new Float32Array(SPARKS * 3);
  private sparkBase = new Float32Array(SPARKS * 3);
  private sparkLife = new Float32Array(SPARKS);
  private nextSpark = 0;

  private toast!: Label;
  private toastLife = 0;

  init(): void {
    const root = stage.root;
    root.name = 'PlaygroundRoot';
    // Default (non-XR) placement for a seated-height camera at the origin.
    root.position.set(0, 0.83, -LAYOUT.forward);
    stage.rootEntity = this.world.createTransformEntity(root);

    this.buildCore(root);
    this.buildDust(root);
    this.buildFx(root);

    this.toast = new Label('', 0.03);
    this.toast.sprite.position.set(0, 0.34, -0.05);
    this.toast.opacity = 0;
    root.add(this.toast.sprite);

    stage.ripple = (x, y, z, color, size) => this.spawnRipple(x, y, z, color, size);
    stage.burst = (x, y, z, color, count) => this.spawnBurst(x, y, z, color, count);
    stage.toast = (text) => {
      this.toast.set(text);
      this.toastLife = 2.6;
    };

    // Browsers only allow audio after a user gesture.
    const unlock = () => audio.start();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', unlock, true),
      () => window.removeEventListener('keydown', unlock, true),
      this.world.visibilityState.subscribe((state) => {
        if (state !== VisibilityState.NonImmersive) {
          audio.start();
          // Re-seat the playground around the player on every session start.
          this.placed = false;
          this.settleFrames = 0;
        }
      }),
    );
  }

  private buildCore(root: Group): void {
    this.core = new Group();
    this.core.name = 'Core';
    this.coreInner = new Mesh(
      new IcosahedronGeometry(0.026, 3),
      new MeshBasicMaterial({ color: 0xbff4ff }),
    );
    this.coreShell = new Mesh(
      new IcosahedronGeometry(0.045, 1),
      new MeshBasicMaterial({
        color: COLORS.violet,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.coreGlow = glowSprite(COLORS.cyan, 0.22, 0.9);
    this.coreAura = glowSprite(COLORS.magenta, 0.5, 0.25);
    this.core.add(this.coreInner, this.coreShell, this.coreGlow, this.coreAura);

    // Live waveform drawn as a ring around the core, in the orbit plane.
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(WAVE_POINTS * 3), 3));
    this.wave = new LineLoop(
      geo,
      new LineBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.8,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.wave.rotation.x = LAYOUT.ringTilt;
    this.wave.frustumCulled = false;
    this.wave.raycast = () => {};
    this.core.add(this.wave);
    root.add(this.core);

    // Distant nebula glows give the dark space some depth.
    const far: [number, number, number, number, number][] = [
      [-2.2, 0.9, -3.4, COLORS.violet, 4.5],
      [2.4, 0.2, -3.0, COLORS.magenta, 3.6],
      [0.3, 1.8, -4.2, COLORS.cyan, 3.8],
      [-1.5, -0.6, 2.8, COLORS.violet, 4.0],
    ];
    for (const [x, y, z, c, s] of far) {
      const n = glowSprite(c, s, 0.1);
      n.position.set(x, y, z);
      root.add(n);
    }
  }

  private buildDust(root: Group): void {
    const pos = new Float32Array(DUST * 3);
    const col = new Float32Array(DUST * 3);
    const palette = [COLORS.cyan, COLORS.violet, COLORS.magenta];
    for (let i = 0; i < DUST; i++) {
      // Random points in a shell so nothing floats inside the player's face.
      const r = 0.45 + Math.random() * 2.2;
      const a = Math.random() * Math.PI * 2;
      const h = (Math.random() - 0.35) * 1.8;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = Math.sin(a) * r;
      this.tmpColor.setHex(palette[i % 3]).multiplyScalar(0.35 + Math.random() * 0.65);
      col[i * 3] = this.tmpColor.r;
      col[i * 3 + 1] = this.tmpColor.g;
      col[i * 3 + 2] = this.tmpColor.b;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    this.dustMat = new PointsMaterial({
      size: 0.018,
      map: glowTexture(),
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.dust = new Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.raycast = () => {};
    root.add(this.dust);
  }

  private buildFx(root: Group): void {
    for (let i = 0; i < RIPPLES; i++) {
      const s = new Sprite(
        new SpriteMaterial({
          map: ringTexture(),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      s.visible = false;
      s.raycast = () => {};
      this.ripples.push(s);
      root.add(s);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.sparkPos, 3));
    geo.setAttribute('color', new BufferAttribute(this.sparkCol, 3));
    this.sparks = new Points(
      geo,
      new PointsMaterial({
        size: 0.014,
        map: glowTexture(),
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.sparks.frustumCulled = false;
    this.sparks.raycast = () => {};
    root.add(this.sparks);
  }

  /** Pooled expanding ring at a root-local position. */
  private spawnRipple(x: number, y: number, z: number, color: number, size: number): void {
    const i = this.nextRipple;
    this.nextRipple = (i + 1) % RIPPLES;
    const s = this.ripples[i];
    s.position.set(x, y, z);
    s.material.color.setHex(color);
    s.visible = true;
    this.rippleLife[i] = 1;
    this.rippleSize[i] = size;
  }

  /** Pooled particle burst at a root-local position. */
  private spawnBurst(x: number, y: number, z: number, color: number, count: number): void {
    this.tmpColor.setHex(color);
    for (let n = 0; n < count; n++) {
      const i = this.nextSpark;
      this.nextSpark = (i + 1) % SPARKS;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const k = Math.sqrt(1 - u * u);
      const speed = 0.08 + Math.random() * 0.22;
      this.sparkPos[i * 3] = x;
      this.sparkPos[i * 3 + 1] = y;
      this.sparkPos[i * 3 + 2] = z;
      this.sparkVel[i * 3] = Math.cos(a) * k * speed;
      this.sparkVel[i * 3 + 1] = u * speed + 0.04;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * k * speed;
      this.sparkBase[i * 3] = this.tmpColor.r;
      this.sparkBase[i * 3 + 1] = this.tmpColor.g;
      this.sparkBase[i * 3 + 2] = this.tmpColor.b;
      this.sparkLife[i] = 0.7 + Math.random() * 0.6;
    }
  }

  /** Seat the playground in front of and below the player's head. */
  private place(): void {
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    if (this.headPos.y < 0.3) return; // no valid head pose yet
    if (++this.settleFrames < 20) return;
    head.getWorldDirection(this.headDir);
    // getWorldDirection points along +Z of the object; the view looks down -Z.
    this.headDir.multiplyScalar(-1);
    this.headDir.y = 0;
    if (this.headDir.lengthSq() < 0.01) this.headDir.set(0, 0, -1);
    this.headDir.normalize();
    const root = stage.root;
    root.position.set(
      this.headPos.x + this.headDir.x * LAYOUT.forward,
      this.headPos.y - LAYOUT.below,
      this.headPos.z + this.headDir.z * LAYOUT.forward,
    );
    root.rotation.set(0, Math.atan2(-this.headDir.x, -this.headDir.z), 0);
    this.placed = true;
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive && !this.placed) this.place();

    // Audio analysis + listener follow the head.
    audio.analyse();
    const cam = this.world.camera;
    cam.getWorldPosition(this.headPos);
    cam.getWorldDirection(this.headDir);
    audio.setListener(
      this.headPos.x, this.headPos.y, this.headPos.z,
      this.headDir.x, this.headDir.y, this.headDir.z,
    );
    const { bass, mid, high, level } = audio;

    // Core: bass swells it, amplitude brightens it, mids spin the shell.
    const breathe = 1 + Math.sin(time * 1.3) * 0.04;
    this.coreInner.scale.setScalar(breathe * (1 + bass * 0.9));
    this.coreShell.scale.setScalar(breathe * (1 + bass * 0.5 + level * 0.25));
    this.coreShell.rotation.y += dt * (0.25 + mid * 3);
    this.coreShell.rotation.x += dt * (0.12 + mid * 1.5);
    this.coreGlow.scale.setScalar(0.2 + level * 0.3 + bass * 0.12);
    this.coreGlow.material.opacity = 0.55 + level * 0.45;
    this.coreAura.scale.setScalar(0.45 + bass * 0.5);
    this.coreAura.material.opacity = 0.16 + level * 0.3;

    // Waveform ring: radius displaced by the live time-domain signal.
    const wp = this.wave.geometry.attributes.position as BufferAttribute;
    const arr = wp.array as Float32Array;
    for (let i = 0; i < WAVE_POINTS; i++) {
      const a = (i / WAVE_POINTS) * Math.PI * 2;
      const s = (audio.wave[(i * 2) % 256] - 128) / 128;
      const r = 0.066 + s * 0.035;
      arr[i * 3] = Math.sin(a) * r;
      arr[i * 3 + 1] = 0;
      arr[i * 3 + 2] = Math.cos(a) * r;
    }
    wp.needsUpdate = true;

    // Dust: bass stirs it, highs make it sparkle.
    this.dust.rotation.y += dt * (0.015 + bass * 0.35);
    this.dustMat.size = 0.016 + high * 0.03 + level * 0.006;

    // Ripples.
    for (let i = 0; i < RIPPLES; i++) {
      let life = this.rippleLife[i];
      if (life <= 0) continue;
      life -= dt * 1.25;
      this.rippleLife[i] = life;
      const s = this.ripples[i];
      if (life <= 0) {
        s.visible = false;
        continue;
      }
      const grow = 1 - life * life; // ease-out
      s.scale.setScalar(0.03 + grow * this.rippleSize[i]);
      s.material.opacity = life * 0.9;
    }

    // Sparks: simple drag + fade; reverb-ish long tails come from slow fade.
    for (let i = 0; i < SPARKS; i++) {
      const life = this.sparkLife[i];
      if (life <= 0) continue;
      const nl = life - dt;
      this.sparkLife[i] = nl;
      const j = i * 3;
      const f = nl > 0 ? Math.min(1, nl * 1.6) : 0;
      this.sparkCol[j] = this.sparkBase[j] * f;
      this.sparkCol[j + 1] = this.sparkBase[j + 1] * f;
      this.sparkCol[j + 2] = this.sparkBase[j + 2] * f;
      const drag = 1 - dt * 1.8;
      this.sparkVel[j] *= drag;
      this.sparkVel[j + 1] *= drag;
      this.sparkVel[j + 2] *= drag;
      this.sparkPos[j] += this.sparkVel[j] * dt;
      this.sparkPos[j + 1] += this.sparkVel[j + 1] * dt;
      this.sparkPos[j + 2] += this.sparkVel[j + 2] * dt;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;

    if (this.toastLife > 0) {
      this.toastLife -= dt;
      this.toast.opacity = Math.min(1, Math.max(0, this.toastLife * 2));
    }
  }
}
