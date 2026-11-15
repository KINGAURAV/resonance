/** C major pentatonic: every combination of these notes sounds consonant. */
const SEMITONES = [0, 2, 4, 7, 9];
const NAMES = ['C', 'D', 'E', 'G', 'A'];
const C4 = 261.63;

/** Highest selectable scale step (two octaves: C4..A5). */
export const MAX_NOTE = 9;

/** Frequency of pentatonic step `index` (0 = C4; negative goes lower). */
export function noteFreq(index: number): number {
  const octave = Math.floor(index / 5);
  const degree = ((index % 5) + 5) % 5;
  return C4 * Math.pow(2, octave + SEMITONES[degree] / 12);
}

export function noteName(index: number): string {
  const octave = Math.floor(index / 5);
  const degree = ((index % 5) + 5) % 5;
  return `${NAMES[degree]}${4 + octave}`;
}
