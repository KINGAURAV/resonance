/**
 * Composition save/load. Stored locally as versioned JSON so later releases
 * can migrate older saves instead of breaking them. No network involved.
 */
import { stage } from './stage.js';
import { dockResonator, resetResonator, setNote } from './systems/resonators.js';

const KEY = 'resonance.composition';
const VERSION = 1;

interface CompositionV1 {
  version: 1;
  bpm: number;
  beat: boolean;
  resonators: { kind: string; note: number; slot: number; pos: [number, number, number] }[];
  string: [number, number, number][];
}

export function captureComposition(): CompositionV1 {
  return {
    version: VERSION,
    bpm: stage.bpm,
    beat: stage.beat,
    resonators: stage.resonators.map((r) => ({
      kind: r.kind,
      note: r.note,
      slot: r.slot,
      pos: [r.rest.x, r.rest.y, r.rest.z],
    })),
    string: stage.stringEnds.map((v) => [v.x, v.y, v.z] as [number, number, number]),
  };
}

export function applyComposition(data: CompositionV1): void {
  stage.bpm = Math.min(160, Math.max(60, data.bpm));
  stage.beat = !!data.beat;
  stage.resonators.forEach((r) => resetResonator(r));
  for (const saved of data.resonators) {
    const r = stage.resonators.find((x) => x.kind === saved.kind);
    if (!r) continue;
    setNote(r, saved.note);
    if (saved.slot >= 0 && saved.slot < stage.slots.length && stage.slots[saved.slot] < 0) {
      dockResonator(r, saved.slot);
    } else {
      r.rest.set(saved.pos[0], saved.pos[1], saved.pos[2]);
    }
  }
  data.string?.forEach((p, i) => stage.stringEnds[i]?.set(p[0], p[1], p[2]));
}

export function saveComposition(): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(captureComposition()));
    return true;
  } catch {
    return false;
  }
}

export function loadComposition(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    // Future versions: migrate here before applying.
    if (data?.version !== VERSION || !Array.isArray(data.resonators)) return false;
    applyComposition(data as CompositionV1);
    return true;
  } catch {
    return false;
  }
}
