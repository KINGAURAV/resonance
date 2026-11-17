/**
 * SongCoach: a step-by-step song lesson shared by the Lattice, the Glide
 * synth and the playground shapes.
 *
 * Step 1, Listen: the instrument plays the tune by itself, lighting up each
 * note as it sounds. Step 2, Your turn: the next note to play glows gold and
 * the lesson waits for you, one note at a time, so nobody gets left behind.
 * Wrong notes are counted but never stop you.
 *
 * The coach is instrument-agnostic: notes are whatever ids the instrument
 * uses (scale steps, resonator ids), and the instrument supplies callbacks to
 * play a note and to show text.
 */
import { trace } from '../stage.js';

export interface Song {
  name: string;
  bpm: number;
  /** Note ids, in order. */
  notes: number[];
  /** Length of each note in beats (same length as notes). */
  beats: number[];
}

/** Build a Song from "id:beats" tokens, e.g. "7:1 6:1 5:2". */
export function song(name: string, bpm: number, text: string): Song {
  const notes: number[] = [];
  const beats: number[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    const [n, b] = tok.split(':');
    notes.push(parseInt(n, 10));
    beats.push(b ? parseFloat(b) : 1);
  }
  return { name, bpm, notes, beats };
}

type Phase = 'off' | 'listen' | 'gap' | 'play';

/** update() result when nothing should be highlighted (ids can be negative). */
export const NO_NOTE = -1000;

export class SongCoach {
  private phase: Phase = 'off';
  private song: Song | null = null;
  private clock = 0;
  private nextAt = 0;
  private index = 0;
  private wrong = 0;
  private lit = NO_NOTE; // note lit during Listen
  private litFor = 0;

  private say: (text: string) => void;

  constructor(
    private playNote: (note: number) => void,
    say: (text: string) => void,
    private onFinish: (song: Song, wrong: number) => void = () => {},
  ) {
    this.say = (text) => {
      trace('coach', text);
      say(text);
    };
  }

  get active(): boolean {
    return this.phase !== 'off';
  }

  /** Begin a lesson: listen first, then play. */
  start(s: Song): void {
    this.song = s;
    this.phase = 'listen';
    this.clock = 0;
    this.index = 0;
    this.nextAt = 1.2; // a breath before the first note
    this.wrong = 0;
    this.say(`${s.name} - step 1: listen and watch`);
  }

  stop(): void {
    this.phase = 'off';
    this.lit = NO_NOTE;
  }

  /**
   * Advance the lesson. Returns the note to highlight in gold (the note
   * sounding during Listen, or the one to play next), or NO_NOTE.
   */
  update(dt: number): number {
    const s = this.song;
    if (!s || this.phase === 'off') return NO_NOTE;
    this.clock += dt;
    const beat = 60 / s.bpm;
    if (this.phase === 'listen') {
      this.litFor -= dt;
      if (this.index < s.notes.length && this.clock >= this.nextAt) {
        this.lit = s.notes[this.index];
        this.litFor = Math.min(0.4, s.beats[this.index] * beat * 0.8);
        this.playNote(this.lit);
        this.nextAt += s.beats[this.index] * beat;
        this.index++;
      }
      if (this.index >= s.notes.length && this.clock >= this.nextAt) {
        this.phase = 'gap';
        this.nextAt = this.clock + 1.2;
        this.say('Step 2: your turn - play the gold notes');
      }
      return this.litFor > 0 ? this.lit : NO_NOTE;
    }
    if (this.phase === 'gap') {
      if (this.clock >= this.nextAt) {
        this.phase = 'play';
        this.index = 0;
        this.say(`Your turn: note 1 of ${s.notes.length}`);
      }
      return NO_NOTE;
    }
    return s.notes[this.index];
  }

  /** The player played `note`. */
  hit(note: number): void {
    const s = this.song;
    if (!s || this.phase !== 'play') return;
    if (note !== s.notes[this.index]) {
      this.wrong++;
      this.say('Not that one - play the gold note');
      return;
    }
    this.index++;
    if (this.index >= s.notes.length) {
      this.phase = 'off';
      this.say(this.wrong === 0 ? `${s.name}: perfect!` : `${s.name} complete! ${this.wrong} wrong note${this.wrong === 1 ? '' : 's'}`);
      this.onFinish(s, this.wrong);
      return;
    }
    this.say(`Your turn: note ${this.index + 1} of ${s.notes.length}`);
  }
}

/**
 * Public-domain melodies in scale steps (0 = C4, 1 = D4, 2 = E4, 3 = G4,
 * 4 = A4, 5 = C5; negative goes lower), so they fit the pentatonic
 * instruments exactly.
 */
export const SCALE_SONGS: Song[] = [
  song('Mary Had a Little Lamb', 100,
    '2 1 0 1 2 2 2:2 1 1 1:2 2 3 3:2 2 1 0 1 2 2 2 2 1 1 2 1 0:4'),
  song('Amazing Grace', 84,
    '-2 0:2 2:0.5 0:0.5 2:2 1 0:2 -1 -2:2 -2 0:2 2:0.5 0:0.5 2:2 1 3:3'),
  song('Hot Cross Buns', 100, '2 1 0:2 2 1 0:2 0:0.5 0:0.5 0:0.5 0:0.5 1:0.5 1:0.5 1:0.5 1:0.5 2 1 0:2'),
];
