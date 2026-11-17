import { CanvasTexture, Sprite, SpriteMaterial, AdditiveBlending, SRGBColorSpace } from '@iwsdk/core';

let glow: CanvasTexture | null = null;
let ring: CanvasTexture | null = null;

/** Soft radial falloff used for halos and particles (a cheap fake bloom). */
export function glowTexture(): CanvasTexture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glow = new CanvasTexture(c);
  return glow;
}

/** Thin soft circle used for expanding ripples. */
export function ringTexture(): CanvasTexture {
  if (ring) return ring;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 22;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  ring = new CanvasTexture(c);
  return ring;
}

export function glowSprite(color: number, size: number, opacity = 1): Sprite {
  const s = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity,
    }),
  );
  s.scale.setScalar(size);
  s.raycast = () => {}; // decorative: never block pointers
  return s;
}

/** A floating text label that always faces the viewer. */
export class Label {
  sprite: Sprite;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private text = '';

  constructor(text: string, private height = 0.022, private color = '#d8f6ff') {
    this.canvas.width = 512;
    this.canvas.height = 96;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.sprite = new Sprite(
      new SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false }),
    );
    this.sprite.renderOrder = 10;
    this.sprite.raycast = () => {};
    this.sprite.scale.set(height * (512 / 96), height, 1);
    this.set(text);
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 96);
    // Shrink long text so it always fits the canvas.
    let px = 52;
    do {
      g.font = `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      px -= 3;
    } while (px > 16 && g.measureText(text).width > 480);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(60,200,255,0.9)';
    g.shadowBlur = 14;
    g.fillStyle = this.color;
    g.fillText(text, 256, 50);
    this.tex.needsUpdate = true;
  }

  get value(): string {
    return this.text;
  }

  setColor(color: string): void {
    if (color === this.color) return;
    this.color = color;
    const t = this.text;
    this.text = '';
    this.set(t);
  }

  set opacity(v: number) {
    this.sprite.material.opacity = v;
    this.sprite.visible = v > 0.01;
  }
}
