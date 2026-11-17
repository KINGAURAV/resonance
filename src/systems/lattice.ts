/**
 * LatticeSystem: a block of floating note cubes you reach into.
 *
 * Columns are the five notes of the scale, rows are octaves, and the two
 * depth layers are two timbres (soft synth in front, bells behind), so every
 * cube is in key. Touch a cube to play it. With the arpeggiator on, touching
 * a cube latches it instead, and the arp cycles through every latched cube
 * in time with the tempo: tap a few cubes and you have a pattern.
 * The cube under your fingertip (or mouse) shows its note name.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  createSystem,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  Hovered,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Pressed,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { noteFreq, noteName } from '../audio/scale.js';
import { LatticeCell } from '../resonance-components.js';
import { COLORS, fxAt, setShown, stage, trace } from '../stage.js';
import { Label } from '../visuals/textures.js';

const COLS = 5;
const ROWS = 3;
const LAYERS = 2;
const CELLS = COLS * ROWS * LAYERS;
const PITCH = 0.058; // spacing between cube centres (m)
const SIZE = 0.034;
const REACH = 0.024; // fingertip distance from a centre that counts as inside
const NOTE_COLORS = [COLORS.cyan, COLORS.mint, COLORS.gold, COLORS.magenta, COLORS.violet];
const LOOKAHEAD = 0.1;

export class LatticeSystem extends createSystem({
  pressed: { required: [LatticeCell, Pressed] },
  hovered: { required: [LatticeCell, Hovered] },
}) {
  private tag!: Label;
  private tagCell = -1;
  private group = new Group();
  private mats: MeshBasicMaterial[] = [];
  private cubes: Mesh[] = [];
  private flash = new Float32Array(CELLS);
  private latched = new Uint8Array(CELLS);
  private handCell = [-1, -1];
  private dwell = [0, 0];
  private fired = [false, false];
  private tip = new Vector3();
  private prevTip = [new Vector3(), new Vector3()];
  private speed = [0, 0];
  private world3 = new Vector3();
  private status!: Label;

  private arp = false;
  private arpNext = 0; // audio time of the next arp step
  private arpPos = 0;

  init(): void {
    const g = this.group;
    g.name = 'Lattice';
    g.position.set(0, 0.13, 0.15);
    const entity = this.world.createTransformEntity(g, { parent: stage.stationEntities.lattice });

    const box = new BoxGeometry(SIZE, SIZE, SIZE);
    const edge = new EdgesGeometry(box);
    const edgePos = edge.attributes.position.array as Float32Array;
    const lines: number[] = [];
    const lineColors: number[] = [];
    for (let id = 0; id < CELLS; id++) {
      const col = id % COLS;
      const row = Math.floor(id / COLS) % ROWS;
      const layer = Math.floor(id / (COLS * ROWS));
      const color = NOTE_COLORS[col];
      const mat = new MeshBasicMaterial({
        color, transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false,
      });
      const cube = new Mesh(box, mat);
      cube.name = `Cube ${id}`;
      cube.position.set((col - 2) * PITCH, (row - 1) * PITCH, (0.5 - layer) * PITCH);
      const e = this.world.createTransformEntity(cube, { parent: entity });
      e.addComponent(LatticeCell, { id });
      e.addComponent(RayInteractable); // mouse fallback
      this.mats.push(mat);
      this.cubes.push(cube);
      // All cube outlines go into one line mesh (a single draw call).
      const r = ((color >> 16) & 255) / 255;
      const gr = ((color >> 8) & 255) / 255;
      const b = (color & 255) / 255;
      for (let k = 0; k < edgePos.length; k += 3) {
        lines.push(edgePos[k] + cube.position.x, edgePos[k + 1] + cube.position.y, edgePos[k + 2] + cube.position.z);
        lineColors.push(r, gr, b);
      }
    }
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new Float32BufferAttribute(lines, 3));
    lineGeo.setAttribute('color', new Float32BufferAttribute(lineColors, 3));
    const outline = new LineSegments(
      lineGeo,
      new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
    );
    outline.raycast = () => {};
    g.add(outline);

    this.status = new Label('', 0.03, '#ffffff');
    this.status.sprite.position.set(0, 0.16, 0);
    g.add(this.status.sprite);
    this.tag = new Label('', 0.022, '#ffffff');
    this.tag.opacity = 0;
    g.add(this.tag.sprite);
    setShown(g, false);

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (e) => {
        if (stage.mode === 'lattice') this.touch(e.getValue(LatticeCell, 'id') ?? 0, 0.8);
      }),
    );
    stage.actions.arp = () => {
      this.arp = !this.arp;
      this.arpNext = 0;
      stage.setPebbleLabel('arp', this.arp ? 'Arp: on' : 'Arp: off');
      this.status.set(this.arp ? 'Arp on: tap cubes to add notes' : 'Touch the cubes');
      if (!this.arp) this.latched.fill(0);
    };
    stage.actions.arpClear = () => this.latched.fill(0);
  }

  private sound(id: number, velocity: number, when: number, live: boolean): void {
    const col = id % COLS;
    const row = Math.floor(id / COLS) % ROWS;
    const back = id >= COLS * ROWS;
    this.cubes[id].getWorldPosition(this.world3);
    audio.play(back ? 'bell' : 'soft', noteFreq(col + 5 * (row - 1)), {
      when, velocity, live, x: this.world3.x, y: this.world3.y, z: this.world3.z,
    });
    this.flash[id] = 1;
  }

  /** A fingertip (or click) arrived in a cube. */
  private touch(id: number, velocity: number): void {
    audio.start();
    if (this.arp) {
      this.latched[id] = this.latched[id] ? 0 : 1;
      if (this.latched[id]) this.sound(id, velocity * 0.5, 0, false);
      trace('lattice latch', id, this.latched[id]);
    } else {
      this.sound(id, velocity, 0, true);
      trace('lattice note', id);
    }
    const c = this.cubes[id].position;
    const p = this.group.position;
    fxAt(stage.stations.lattice, p.x + c.x, p.y + c.y, p.z + c.z, NOTE_COLORS[id % COLS], 0.06 + velocity * 0.08, Math.round(2 + velocity * 6));
  }

  private detectHands(rawDt: number): void {
    const sides = ['left', 'right'] as const;
    for (let h = 0; h < 2; h++) {
      this.player.indexTipSpaces[sides[h]].getWorldPosition(this.tip);
      const raw = this.tip.distanceTo(this.prevTip[h]) / Math.max(rawDt, 0.001);
      this.speed[h] += (Math.min(raw, 4) - this.speed[h]) * 0.4;
      this.prevTip[h].copy(this.tip);
      this.group.worldToLocal(this.tip);
      // Snap to the nearest cube centre on each axis, then check distance.
      const col = Math.round(this.tip.x / PITCH + 2);
      const row = Math.round(this.tip.y / PITCH + 1);
      const layer = Math.round(0.5 - this.tip.z / PITCH);
      let cell = -1;
      if (col >= 0 && col < COLS && row >= 0 && row < ROWS && layer >= 0 && layer < LAYERS) {
        const id = layer * COLS * ROWS + row * COLS + col;
        const c = this.cubes[id].position;
        if (
          Math.abs(this.tip.x - c.x) < REACH &&
          Math.abs(this.tip.y - c.y) < REACH &&
          Math.abs(this.tip.z - c.z) < REACH
        ) cell = id;
      }
      // Sliding from one cube into the next plays the next: easy melodies.
      if (cell !== this.handCell[h]) {
        this.handCell[h] = cell;
        this.dwell[h] = 0;
        this.fired[h] = false;
      }
      // With the arp on, a cube only latches once the finger rests in it for
      // a moment, so reaching through the block does not toggle everything.
      if (cell >= 0 && !this.fired[h]) {
        this.dwell[h] += rawDt;
        if (!this.arp || this.dwell[h] > 0.14) {
          this.fired[h] = true;
          this.touch(cell, Math.min(1, Math.max(0.45, this.speed[h] / 0.7)));
        }
      }
    }
  }

  private runArp(): void {
    const now = audio.now;
    const step = 60 / stage.bpm / 2; // eighth notes
    if (this.arpNext < now - 0.3) this.arpNext = now + 0.05;
    while (this.arpNext < now + LOOKAHEAD) {
      // Next latched cube in pitch order, wrapping round.
      let found = -1;
      for (let n = 1; n <= CELLS; n++) {
        const id = (this.arpPos + n) % CELLS;
        if (this.latched[id]) {
          found = id;
          break;
        }
      }
      if (found >= 0) {
        this.arpPos = found;
        this.sound(found, 0.7, this.arpNext, false);
      }
      this.arpNext += step;
    }
  }

  update(delta: number): void {
    const active = stage.mode === 'lattice';
    const visible = active || stage.showAll;
    if (this.group.visible !== visible) {
      setShown(this.group, visible);
      if (visible) this.status.set(this.arp ? 'Arp on: tap cubes to add notes' : 'Touch the cubes');
    }
    // The arp keeps running in other modes, like the looper, so you can
    // play drums or guitar over it.
    if (this.arp && audio.running) this.runArp();
    if (!visible) return;
    const dt = Math.min(delta, 0.05);
    if (active && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.detectHands(delta);
    // Note-name tag over the cube a finger is in, else the hovered one.
    let tagCell = this.handCell[1] >= 0 ? this.handCell[1] : this.handCell[0];
    if (tagCell < 0) for (const e of this.queries.hovered.entities) tagCell = e.getValue(LatticeCell, 'id') ?? -1;
    if (tagCell !== this.tagCell) {
      this.tagCell = tagCell;
      if (tagCell >= 0) {
        const col = tagCell % COLS;
        const row = Math.floor(tagCell / COLS) % ROWS;
        const back = tagCell >= COLS * ROWS;
        this.tag.set(`${noteName(col + 5 * (row - 1))} ${back ? 'bell' : 'synth'}`);
        this.tag.sprite.position.copy(this.cubes[tagCell].position);
        this.tag.sprite.position.y += SIZE * 0.5 + 0.018;
      }
    }
    this.tag.opacity = tagCell >= 0 ? 1 : 0;
    for (let id = 0; id < CELLS; id++) {
      this.flash[id] = Math.max(0, this.flash[id] - dt * 3);
      const held = id === this.handCell[0] || id === this.handCell[1];
      this.mats[id].opacity = 0.2 + this.flash[id] * 0.8 + (this.latched[id] ? 0.3 : 0) + (held ? 0.25 : 0);
      this.cubes[id].scale.setScalar(1 + this.flash[id] * 0.25);
    }
  }
}
