/**
 * Control icons, drawn procedurally on small canvases (no image files, and
 * no reliance on the headset having particular symbol fonts).
 *
 * Colour carries meaning across every instrument:
 *   cyan   play / tempo / navigation    gold   lessons
 *   violet sound settings               red    recording, destructive
 *   mint   files (save / load)
 */
import { CanvasTexture, SRGBColorSpace } from '@iwsdk/core';
import { COLORS } from '../stage.js';

const RED = 0xff4d63;

type Draw = (g: CanvasRenderingContext2D) => void;

const line = (g: CanvasRenderingContext2D, pts: number[]) => {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
};
const poly = (g: CanvasRenderingContext2D, pts: number[]) => {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fill();
};
const dot = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
};
const arrowHead = (g: CanvasRenderingContext2D, x: number, y: number, ang: number) => {
  const s = 16;
  poly(g, [
    x + Math.cos(ang) * s, y + Math.sin(ang) * s,
    x + Math.cos(ang + 2.4) * s, y + Math.sin(ang + 2.4) * s,
    x + Math.cos(ang - 2.4) * s, y + Math.sin(ang - 2.4) * s,
  ]);
};

const note: Draw = (g) => {
  // A music note: the lesson icon.
  dot(g, 50, 86, 15);
  g.fillRect(60, 30, 8, 58);
  poly(g, [60, 30, 92, 42, 92, 56, 68, 46]);
};

const DRAW: Record<string, Draw> = {
  play: (g) => poly(g, [44, 32, 96, 64, 44, 96]),
  pause: (g) => {
    g.fillRect(40, 34, 16, 60);
    g.fillRect(72, 34, 16, 60);
  },
  beat: (g) => {
    // Drum with two sticks.
    g.beginPath();
    g.ellipse(64, 78, 34, 14, 0, 0, Math.PI * 2);
    g.stroke();
    line(g, [36, 30, 60, 66]);
    line(g, [92, 30, 68, 66]);
  },
  minus: (g) => g.fillRect(34, 58, 60, 12),
  plus: (g) => {
    g.fillRect(34, 58, 60, 12);
    g.fillRect(58, 34, 12, 60);
  },
  save: (g) => {
    line(g, [64, 26, 64, 78]);
    arrowHead(g, 64, 86, Math.PI / 2);
    line(g, [30, 80, 30, 100, 98, 100, 98, 80]);
  },
  load: (g) => {
    line(g, [64, 90, 64, 40]);
    arrowHead(g, 64, 30, -Math.PI / 2);
    line(g, [30, 80, 30, 100, 98, 100, 98, 80]);
  },
  reset: (g) => {
    g.beginPath();
    g.arc(64, 66, 30, -Math.PI * 0.35, Math.PI * 1.4);
    g.stroke();
    arrowHead(g, 82, 36, -0.4);
  },
  undo: (g) => {
    g.beginPath();
    g.arc(68, 70, 26, Math.PI, Math.PI * 2.25);
    g.stroke();
    arrowHead(g, 40, 64, Math.PI / 2 + 0.2);
  },
  help: (g) => {
    g.beginPath();
    g.arc(64, 48, 20, Math.PI, Math.PI * 2.4);
    g.stroke();
    line(g, [64, 68, 64, 80]);
    dot(g, 64, 96, 7);
  },
  record: (g) => dot(g, 64, 64, 30),
  clear: (g) => {
    line(g, [38, 38, 90, 90]);
    line(g, [90, 38, 38, 90]);
  },
  snap: (g) => {
    // Magnet.
    g.beginPath();
    g.arc(64, 60, 26, Math.PI, 0, true);
    g.stroke();
    line(g, [38, 60, 38, 34]);
    line(g, [90, 60, 90, 34]);
  },
  chord: (g) => {
    dot(g, 64, 36, 11);
    dot(g, 64, 64, 11);
    dot(g, 64, 92, 11);
  },
  arp: (g) => line(g, [26, 92, 46, 40, 64, 80, 82, 36, 102, 76]),
  learn: note,
  guitar: (g) => {
    dot(g, 48, 82, 22);
    g.save();
    g.translate(64, 64);
    g.rotate(-0.8);
    g.fillRect(0, -6, 52, 12);
    g.restore();
  },
  down: (g) => line(g, [36, 50, 64, 80, 92, 50]),
  up: (g) => line(g, [36, 80, 64, 50, 92, 80]),
  sustain: (g) => {
    // Piano pedal.
    poly(g, [36, 76, 92, 60, 96, 72, 40, 88]);
    line(g, [64, 30, 64, 64]);
  },
  volume: (g) => {
    poly(g, [28, 52, 46, 52, 70, 32, 70, 96, 46, 76, 28, 76]);
    g.beginPath();
    g.arc(72, 64, 22, -0.8, 0.8);
    g.stroke();
  },
  wave: (g) => {
    g.beginPath();
    for (let x = 22; x <= 106; x += 2) {
      const y = 64 - Math.sin(((x - 22) / 84) * Math.PI * 2) * 24;
      if (x === 22) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  },
  text: (g) => {
    g.font = '700 54px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Aa', 64, 68);
  },
  scale: (g) => {
    g.fillRect(24, 84, 20, 16);
    g.fillRect(44, 68, 20, 32);
    g.fillRect(64, 52, 20, 48);
    g.fillRect(84, 36, 20, 64);
  },
  list: (g) => {
    for (let i = 0; i < 3; i++) {
      dot(g, 34, 40 + i * 24, 6);
      g.fillRect(48, 35 + i * 24, 50, 10);
    }
  },
  more: (g) => {
    // Gear.
    g.beginPath();
    g.arc(64, 64, 18, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      line(g, [64 + Math.cos(a) * 26, 64 + Math.sin(a) * 26, 64 + Math.cos(a) * 38, 64 + Math.sin(a) * 38]);
    }
  },
};

/** Icon and category colour for each control action. */
export const BUTTONS: Record<string, { icon: string; color: number }> = {
  play: { icon: 'pause', color: COLORS.cyan },
  beat: { icon: 'beat', color: COLORS.cyan },
  slower: { icon: 'minus', color: COLORS.cyan },
  faster: { icon: 'plus', color: COLORS.cyan },
  save: { icon: 'save', color: COLORS.mint },
  load: { icon: 'load', color: COLORS.mint },
  clear: { icon: 'reset', color: RED },
  intro: { icon: 'help', color: COLORS.cyan },
  glideChord: { icon: 'chord', color: COLORS.violet },
  arp: { icon: 'arp', color: COLORS.violet },
  arpClear: { icon: 'clear', color: RED },
  learn: { icon: 'learn', color: COLORS.gold },
  learnGuitar: { icon: 'learn', color: COLORS.gold },
  holdGuitar: { icon: 'guitar', color: COLORS.violet },
  pianoDown: { icon: 'down', color: COLORS.violet },
  pianoUp: { icon: 'up', color: COLORS.violet },
  pianoSustain: { icon: 'sustain', color: COLORS.violet },
  pianoVolume: { icon: 'volume', color: COLORS.violet },
  pianoSound: { icon: 'wave', color: COLORS.violet },
  pianoLabels: { icon: 'text', color: COLORS.violet },
  pianoScale: { icon: 'scale', color: COLORS.violet },
  pianoChord: { icon: 'chord', color: COLORS.gold },
  pianoLearn: { icon: 'learn', color: COLORS.gold },
  pianoSong: { icon: 'list', color: COLORS.gold },
  echo: { icon: 'learn', color: COLORS.gold },
  latticeLearn: { icon: 'learn', color: COLORS.gold },
  glideLearn: { icon: 'learn', color: COLORS.gold },
  loop: { icon: 'record', color: RED },
  loopClear: { icon: 'clear', color: RED },
  loopUndo: { icon: 'undo', color: COLORS.violet },
  snap: { icon: 'snap', color: COLORS.violet },
  more: { icon: 'more', color: COLORS.cyan },
};

const cache = new Map<string, CanvasTexture>();

/** A white icon on a transparent 128x128 texture (cached per icon). */
export function iconTexture(name: string): CanvasTexture {
  let tex = cache.get(name);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  (DRAW[name] ?? DRAW.more)(g);
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  cache.set(name, tex);
  return tex;
}
