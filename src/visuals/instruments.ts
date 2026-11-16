/**
 * Procedural instrument models. Everything is generated in code (geometry
 * and wood-grain textures) so nothing is downloaded and the build stays tiny.
 * These are pure decoration: hit/strum detection lives in the systems.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  type Material,
  type Object3D,
} from '@iwsdk/core';

/** Decorative meshes must never intercept pointer rays. */
function decor<T extends Object3D>(obj: T): T {
  obj.raycast = () => {};
  return obj;
}

/** Wood grain: a base colour with many thin, slightly wavy darker lines. */
function woodTexture(base: string, grain: string, lines: number, repeat: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = grain;
  for (let i = 0; i < lines; i++) {
    const y = (i / lines) * 256 + Math.sin(i * 12.9898) * 3;
    g.globalAlpha = 0.12 + (Math.sin(i * 78.233) * 0.5 + 0.5) * 0.28;
    g.lineWidth = 0.6 + (Math.sin(i * 3.7) * 0.5 + 0.5) * 1.6;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 2.2);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

const chrome = () => new MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.22 });

// ---------------------------------------------------------------- guitar

/** Guitar dimensions shared with the guitar system (guitar-local meters). */
export const GUITAR = {
  nutX: -0.3,
  bridgeX: 0.235,
  spacing: 0.0105, // between strings
  bodyStartX: -0.045,
  bodyEndX: 0.31,
  soundHoleX: 0.105,
};

/** Half-width of the body outline at fraction u (0 = neck end, 1 = tail). */
function bodyHalfWidth(u: number): number {
  const e = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
  // Rounded ends, a wider lower bout, and a pinched waist.
  return Math.pow(e, 0.55) * (0.098 + 0.03 * u) - 0.03 * Math.exp(-(((u - 0.37) / 0.1) ** 2));
}

/**
 * Acoustic guitar lying in the local XY plane: strings run along +x from the
 * nut to the bridge, +y is toward the low strings, +z faces the player.
 */
export function buildGuitarModel(): Group {
  const g = new Group();
  const { nutX, bridgeX, bodyStartX, bodyEndX, soundHoleX } = GUITAR;

  // Body: the outline is extruded into a shallow box with bevelled edges.
  const outline = new Shape();
  const N = 44;
  const len = bodyEndX - bodyStartX;
  outline.moveTo(bodyStartX, 0);
  for (let i = 1; i < N; i++) outline.lineTo(bodyStartX + (i / N) * len, bodyHalfWidth(i / N));
  outline.lineTo(bodyEndX, 0);
  for (let i = N - 1; i > 0; i--) outline.lineTo(bodyStartX + (i / N) * len, -bodyHalfWidth(i / N));
  outline.closePath();
  const top = new MeshStandardMaterial({
    map: woodTexture('#d9a55c', '#8a5a22', 90, 5), roughness: 0.42, metalness: 0.02,
  });
  const sides = new MeshStandardMaterial({
    map: woodTexture('#5b2c14', '#2a1206', 60, 6), roughness: 0.5, metalness: 0.02,
  });
  const body = decor(
    new Mesh(
      new ExtrudeGeometry(outline, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 3, curveSegments: 4 }),
      [top, sides],
    ),
  );
  body.position.z = -0.074; // front face sits just behind the strings
  g.add(body);

  // Sound hole with a rosette ring.
  const hole = decor(new Mesh(new CircleGeometry(0.036, 40), new MeshStandardMaterial({ color: 0x0c0604, roughness: 1 })));
  hole.position.set(soundHoleX, 0, -0.0172);
  const rosette = decor(new Mesh(new TorusGeometry(0.041, 0.0022, 6, 48), new MeshStandardMaterial({ color: 0x2a1408, roughness: 0.6 })));
  rosette.position.copy(hole.position);
  const rosette2 = decor(new Mesh(new TorusGeometry(0.046, 0.001, 6, 48), new MeshStandardMaterial({ color: 0xf0e2c0, roughness: 0.6 })));
  rosette2.position.copy(hole.position);
  g.add(hole, rosette, rosette2);

  // Bridge and saddle.
  const dark = new MeshStandardMaterial({ map: woodTexture('#24170f', '#0c0705', 40, 3), roughness: 0.55 });
  const bridge = decor(new Mesh(new BoxGeometry(0.02, 0.085, 0.007), dark));
  bridge.position.set(bridgeX + 0.004, 0, -0.0145);
  const bone = new MeshStandardMaterial({ color: 0xf3ecdc, roughness: 0.5 });
  const saddle = decor(new Mesh(new BoxGeometry(0.003, 0.066, 0.004), bone));
  saddle.position.set(bridgeX, 0, -0.009);
  g.add(bridge, saddle);

  // Neck, fretboard, nut and headstock.
  const neckLen = bodyStartX + 0.02 - nutX;
  const neck = decor(new Mesh(new BoxGeometry(neckLen, 0.058, 0.02), sides));
  neck.position.set(nutX + neckLen / 2, 0, -0.03);
  const boardEnd = 0.05; // fretboard runs over the body toward the sound hole
  const board = decor(new Mesh(new BoxGeometry(boardEnd - nutX, 0.064, 0.006), dark));
  board.position.set((boardEnd + nutX) / 2, 0, -0.016);
  const nut = decor(new Mesh(new BoxGeometry(0.004, 0.064, 0.008), bone));
  nut.position.set(nutX - 0.002, 0, -0.014);
  const head = decor(new Mesh(new BoxGeometry(0.09, 0.076, 0.014), sides));
  head.position.set(nutX - 0.049, 0, -0.03);
  g.add(neck, board, nut, head);

  // Frets at real equal-temperament positions, plus inlay dots.
  const scale = bridgeX - nutX;
  const metal = chrome();
  const fretGeo = new BoxGeometry(0.0016, 0.064, 0.0016);
  const dotGeo = new CircleGeometry(0.0032, 12);
  const pearl = new MeshStandardMaterial({ color: 0xf5f1e6, roughness: 0.3 });
  let prev = nutX;
  for (let n = 1; n <= 14; n++) {
    const x = nutX + scale * (1 - Math.pow(2, -n / 12));
    const fret = decor(new Mesh(fretGeo, metal));
    fret.position.set(x, 0, -0.0125);
    g.add(fret);
    if ([3, 5, 7, 9, 12].includes(n)) {
      for (const y of n === 12 ? [-0.014, 0.014] : [0]) {
        const dot = decor(new Mesh(dotGeo, pearl));
        dot.position.set((x + prev) / 2, y, -0.0128);
        g.add(dot);
      }
    }
    prev = x;
  }

  // Tuning pegs: three each side of the headstock.
  const pegGeo = new CylinderGeometry(0.004, 0.004, 0.016, 10);
  for (let i = 0; i < 6; i++) {
    const peg = decor(new Mesh(pegGeo, metal));
    peg.position.set(nutX - 0.022 - (i % 3) * 0.026, i < 3 ? 0.044 : -0.044, -0.03);
    g.add(peg);
  }
  return g;
}

// ----------------------------------------------------------------- drums

export interface DrumModel {
  group: Group;
  /** Surface that flashes when struck (skin or cymbal). */
  hitMaterial: MeshStandardMaterial;
  cymbal: boolean;
}

/**
 * A drum whose skin sits at local y = 0 (where strikes are detected): shell
 * and stand hang below it.
 */
export function buildDrum(radius: number, depth: number, shellColor: number, glow: number): DrumModel {
  const group = new Group();
  // Electronic-pad look: a dark rubber head inside a ring of coloured light.
  const skin = new MeshStandardMaterial({
    color: 0x0c0c18, roughness: 0.35, metalness: 0.3, emissive: glow, emissiveIntensity: 0.1,
  });
  const shellMat = new MeshStandardMaterial({ color: shellColor, metalness: 0.75, roughness: 0.3 });
  const metal = chrome();
  // The head stays clickable so a mouse or pinch-ray can play the pad.
  const head = new Mesh(new CylinderGeometry(radius, radius, 0.004, 40), skin);
  head.position.y = -0.002;
  const shell = decor(new Mesh(new CylinderGeometry(radius * 0.985, radius * 0.985, depth, 40, 1, true), shellMat));
  shell.position.y = -0.004 - depth / 2;
  group.add(head, shell, neonRing(radius + 0.001, 0.003, glow, 0.002));
  const hoop = decor(new Mesh(new TorusGeometry(radius + 0.0015, 0.0028, 8, 48), metal));
  hoop.rotation.x = Math.PI / 2;
  hoop.position.y = -0.006 - depth;
  group.add(hoop);
  group.add(stand(-0.006 - depth, 0.16, metal));
  return { group, hitMaterial: skin, cymbal: false };
}

/** A brass cymbal (or a closed hi-hat pair) on a chrome stand. */
export function buildCymbal(radius: number, pair: boolean, glow: number): DrumModel {
  const group = new Group();
  const brass = new MeshStandardMaterial({
    color: 0xd9ab45, metalness: 1, roughness: 0.3, emissive: glow, emissiveIntensity: 0.05,
  });
  const metal = chrome();
  // A very shallow cone reads as a cymbal bow; a small dome is the bell.
  const top = new Mesh(new CylinderGeometry(radius * 0.2, radius, 0.007, 48), brass); // clickable
  top.position.y = -0.0035;
  const bell = decor(new Mesh(new CylinderGeometry(radius * 0.08, radius * 0.22, 0.007, 24), brass));
  bell.position.y = 0.0035;
  group.add(top, bell, neonRing(radius, 0.002, glow, -0.006));
  if (pair) {
    const bottom = decor(new Mesh(new CylinderGeometry(radius * 0.2, radius, 0.007, 48), brass));
    bottom.rotation.x = Math.PI; // mirrored underneath: a closed hi-hat
    bottom.position.y = -0.0125;
    group.add(bottom);
  }
  group.add(stand(pair ? -0.016 : -0.007, 0.22, metal));
  return { group, hitMaterial: brass, cymbal: true };
}

/** A flat ring of pure light (additive, so it reads as glowing). */
function neonRing(radius: number, tube: number, color: number, y: number): Mesh {
  const ring = decor(
    new Mesh(
      new TorusGeometry(radius, tube, 8, 56),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }),
    ),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y;
  return ring;
}

function stand(top: number, length: number, metal: Material): Mesh {
  const rod = decor(new Mesh(new CylinderGeometry(0.004, 0.004, length, 10), metal));
  rod.position.y = top - length / 2;
  return rod;
}
