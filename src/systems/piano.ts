/**
 * PianoSystem: a two-octave keyboard (24 keys, C3-B4 by default) played with
 * all ten fingertips.
 *
 * Hand tracking gives every finger joint, so each fingertip is tested
 * against the keys in the keyboard's own frame: a key goes down when a
 * fingertip dips onto it and comes up when the finger lifts (with a little
 * hysteresis so it never chatters). Faster presses play louder. Notes ring
 * while the key is held, like a real piano, and Sustain keeps them ringing
 * after release until it is switched off.
 *
 * Every note is reported to the looper with its start time and how long it
 * was held, so recorded piano parts replay with the right lengths.
 *
 * Controls (pebbles): octave down/up, sustain, volume, sound (grand,
 * electric, soft), note labels, scale highlight, chord guide.
 *
 * Move it: pinch the gold bar along the back and carry the piano wherever
 * suits your reach (like the drum pads).
 *
 * Learn a song: glowing tiles fall onto the keys in time with the tune, and
 * you press each key as its tile lands. The song waits for you if you miss
 * one (so beginners can go at their own pace) and scores how many notes you
 * played on time. Songs are public-domain melodies.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  createSystem,
  CylinderGeometry,
  Grabbed,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OneHandGrabbable,
  Pressed,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio, PIANO_KINDS } from '../audio/engine.js';
import { PianoKey } from '../resonance-components.js';
import { COLORS, fxAt, grabOnly, setShown, stage, trace } from '../stage.js';
import { decor } from '../visuals/instruments.js';
import { glowSprite, Label } from '../visuals/textures.js';

const KEYS = 24;
const WHITE_W = 0.03; // a little wider than a real key (23.5 mm): easier in VR
const WHITE_L = 0.13;
const WHITE_H = 0.018;
const BLACK_W = 0.017;
const BLACK_L = 0.082;
const BLACK_UP = 0.012; // black key tops sit this far above the white tops
const TRAVEL = 0.007; // how far a key moves when pressed
// Fingertip joints sit inside the finger, ~7 mm above the skin pad.
const PRESS = 0.006;
const LIFT = 0.015;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'] as const;
const FINGERS = 10;
const SOUND_NAMES = ['Grand', 'Electric', 'Soft'];
const VOLUMES = [1, 0.7, 0.4];

const SCALES: { name: string; root: number; steps: number[] }[] = [
  { name: 'C major', root: 0, steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'G major', root: 7, steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'D major', root: 2, steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'A minor', root: 9, steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'E minor', root: 4, steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'C minor', root: 0, steps: [0, 2, 3, 5, 7, 8, 10] },
];
const CHORDS: { name: string; notes: number[] }[] = [
  { name: 'C major', notes: [0, 4, 7] },
  { name: 'G major', notes: [7, 11, 2] },
  { name: 'A minor', notes: [9, 0, 4] },
  { name: 'F major', notes: [5, 9, 0] },
  { name: 'D minor', notes: [2, 5, 9] },
  { name: 'E minor', notes: [4, 7, 11] },
];

// Public-domain melodies as "note:beats" (r = rest). Octave 4 = middle C.
const SONGS: { name: string; bpm: number; notes: string }[] = [
  {
    name: 'Twinkle Twinkle',
    bpm: 84,
    notes: 'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 ' +
      'G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 ' +
      'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2',
  },
  {
    name: 'Ode to Joy',
    bpm: 96,
    notes: 'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2 ' +
      'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2',
  },
  {
    name: 'Jingle Bells',
    bpm: 108,
    notes: 'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4 ' +
      'F4:1 F4:1 F4:1.5 F4:0.5 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 E4:1 D4:1 D4:1 E4:1 D4:2 G4:2 ' +
      'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4 ' +
      'F4:1 F4:1 F4:1.5 F4:0.5 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 G4:1 G4:1 F4:1 D4:1 C4:4',
  },
  {
    name: 'Mary Had a Little Lamb',
    bpm: 100,
    notes: 'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 D4:1 D4:1 D4:2 E4:1 G4:1 G4:2 ' +
      'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:1 E4:1 D4:1 D4:1 E4:1 D4:1 C4:4',
  },
  {
    name: 'Brother John',
    bpm: 100,
    notes: 'C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 F4:1 G4:2 E4:1 F4:1 G4:2 ' +
      'G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 ' +
      'C4:1 G3:1 C4:2 C4:1 G3:1 C4:2',
  },
  {
    name: 'London Bridge',
    bpm: 100,
    notes: 'G4:1.5 A4:0.5 G4:1 F4:1 E4:1 F4:1 G4:2 D4:1 E4:1 F4:2 E4:1 F4:1 G4:2 ' +
      'G4:1.5 A4:0.5 G4:1 F4:1 E4:1 F4:1 G4:2 D4:2 G4:2 E4:1 C4:3',
  },
  {
    name: 'Amazing Grace',
    bpm: 80,
    notes: 'G3:1 C4:2 E4:0.5 C4:0.5 E4:2 D4:1 C4:2 A3:1 G3:2 G3:1 ' +
      'C4:2 E4:0.5 C4:0.5 E4:2 D4:1 G4:3',
  },
  {
    name: 'Fur Elise (opening)',
    bpm: 66,
    notes: 'E4:0.5 D#4:0.5 E4:0.5 D#4:0.5 E4:0.5 B3:0.5 D4:0.5 C4:0.5 A3:1.5 ' +
      'C3:0.5 E3:0.5 A3:0.5 B3:1.5 E3:0.5 G#3:0.5 B3:0.5 C4:1.5 E3:0.5 ' +
      'E4:0.5 D#4:0.5 E4:0.5 D#4:0.5 E4:0.5 B3:0.5 D4:0.5 C4:0.5 A3:1.5 ' +
      'C3:0.5 E3:0.5 A3:0.5 B3:1.5 E3:0.5 C4:0.5 B3:0.5 A3:3',
  },
];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Parse "E4:1.5" tokens into MIDI note, start and length (seconds). */
function parseSong(text: string, bpm: number): { midi: number; t: number; dur: number }[] {
  const beat = 60 / bpm;
  const out: { midi: number; t: number; dur: number }[] = [];
  let t = 0;
  for (const tok of text.trim().split(/\s+/)) {
    const [n, b] = tok.split(':');
    const len = parseFloat(b) * beat;
    if (n !== 'r') {
      const sharp = n[1] === '#' ? 1 : 0;
      const midi = 12 * (parseInt(n.slice(1 + sharp), 10) + 1) + LETTER[n[0]] + sharp;
      out.push({ midi, t, dur: len });
    }
    t += len;
  }
  return out;
}
const TILE_SPEED = 0.11; // metres a tile falls per second
const TILE_LEAD = 2.6; // seconds a tile is visible before it lands
const TILES = 18;
const ON_TIME = 0.3; // seconds early/late that still counts as on time

interface KeyState {
  semi: number; // 0..23 above the lowest C
  black: boolean;
  x: number;
  mesh: Mesh;
  mat: MeshStandardMaterial;
  baseColor: number;
  fingers: number; // how many fingers (or the mouse) hold it down
  voice: number; // engine piano note id, -1 if silent
  start: number; // audio time the note began
  velocity: number;
  sustained: boolean; // released while Sustain was on: still ringing
  travel: number; // 0 up .. 1 fully down (animated)
  glow: number;
  label: Label | null;
}

export class PianoSystem extends createSystem({
  pressed: { required: [PianoKey, Pressed] },
}) {
  private piano = new Group();
  private keys: KeyState[] = [];
  private base = 48; // MIDI note of the lowest key (C3)
  private sustain = false;
  private sound = 0;
  private volume = 0;
  private labels = true;
  private scale = -1;
  private chord = -1;

  // Per fingertip: which key it holds (-1 none), previous height, speed.
  private fingerKey = new Int8Array(FINGERS).fill(-1);
  private prevY = new Float32Array(FINGERS);
  private downSpeed = new Float32Array(FINGERS);
  private tips: Vector3[] = [];
  private tipValid = new Uint8Array(FINGERS);
  private inv = new Matrix4();
  private tmp = new Vector3();
  private mouseKey = -1;

  private status!: Label;
  private statusAlpha = 0;
  private tag!: Label;
  private tagAlpha = 0;
  private chordDone = -1;
  private wasActive = false;
  // Move handle: the piano follows it, keeping this offset.
  private handle = new Group();
  private handleEntity!: ReturnType<PianoSystem['world']['createTransformEntity']>;
  private handleOffset = new Vector3(0, 0.048, -0.118);

  // Learn a song.
  private song = 0;
  private learning = false;
  private notes: { midi: number; t: number; dur: number }[] = [];
  private songTime = 0;
  private next = 0; // index of the next note to play
  private waited = 0; // seconds the song has been waiting on the next note
  private onTime = 0;
  private tiles: Mesh[] = [];
  private tileMats: MeshBasicMaterial[] = [];

  init(): void {
    const g = this.piano;
    g.name = 'Piano';
    g.position.set(0, -0.05, 0.19);
    g.rotation.x = 0.06; // front edge dips slightly toward you
    const entity = this.world.createTransformEntity(g, { parent: stage.stationEntities.piano });

    // A gold bar along the back: pinch it to carry the piano somewhere else.
    const h = this.handle;
    h.name = 'Piano handle';
    const bar = new Mesh(
      new CylinderGeometry(0.009, 0.009, 0.16, 12),
      new MeshStandardMaterial({ color: COLORS.gold, emissive: COLORS.gold, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.5 }),
    );
    bar.rotation.z = Math.PI / 2;
    const handleLabel = new Label('Pinch to move', 0.014);
    handleLabel.sprite.position.y = 0.025;
    h.add(bar, glowSprite(COLORS.gold, 0.12, 0.35), handleLabel.sprite);
    h.position.copy(g.position).add(this.handleOffset);
    this.handleEntity = this.world.createTransformEntity(h, { parent: stage.stationEntities.piano });
    this.handleEntity.addComponent(OneHandGrabbable, { rotate: false });
    setShown(h, false);
    for (let i = 0; i < FINGERS; i++) this.tips.push(new Vector3());

    this.buildCase();

    const whiteGeo = new BoxGeometry(WHITE_W - 0.0015, WHITE_H, WHITE_L);
    const blackGeo = new BoxGeometry(BLACK_W, WHITE_H, BLACK_L);
    let white = 0;
    for (let semi = 0; semi < KEYS; semi++) {
      const black = BLACK[semi % 12];
      // Black keys sit on the line between two white keys.
      const x = black ? (white - 7) * WHITE_W : (white - 6.5) * WHITE_W;
      const color = black ? 0x0d0d18 : 0xf2f0f6;
      const mat = new MeshStandardMaterial({
        color, roughness: black ? 0.28 : 0.22, metalness: black ? 0.3 : 0.05,
        emissive: COLORS.violet, emissiveIntensity: 0,
      });
      const mesh = new Mesh(black ? blackGeo : whiteGeo, mat);
      mesh.name = `Piano key ${semi}`;
      mesh.position.set(x, black ? BLACK_UP - WHITE_H / 2 : -WHITE_H / 2, black ? -WHITE_L / 2 + BLACK_L / 2 : 0);
      const e = this.world.createTransformEntity(mesh, { parent: entity });
      e.addComponent(PianoKey, { id: semi });
      e.addComponent(RayInteractable); // mouse fallback
      let label: Label | null = null;
      if (!black) {
        label = new Label('', 0.016, '#3a3a66');
        label.sprite.position.set(0, WHITE_H / 2 + 0.002, WHITE_L / 2 - 0.018);
        mesh.add(label.sprite);
        white++;
      }
      this.keys.push({
        semi, black, x, mesh, mat, baseColor: color, fingers: 0, voice: -1, start: 0,
        velocity: 0, sustained: false, travel: 0, glow: 0, label,
      });
    }
    this.refreshLabels();

    this.status = new Label('', 0.03, '#ffffff');
    this.status.sprite.position.set(0, 0.17, -0.1);
    this.status.opacity = 0;
    g.add(this.status.sprite);
    this.tag = new Label('', 0.03, '#ffffff');
    this.tag.opacity = 0;
    g.add(this.tag.sprite);
    // Pool of note tiles for Learn a song.
    const tileGeo = new BoxGeometry(1, 1, 1);
    for (let i = 0; i < TILES; i++) {
      const m = new MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false });
      const tile = decor(new Mesh(tileGeo, m));
      tile.visible = false;
      this.tiles.push(tile);
      this.tileMats.push(m);
      g.add(tile);
    }
    setShown(g, false);

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (e) => {
        if (stage.mode !== 'piano') return;
        audio.start();
        this.mouseKey = e.getValue(PianoKey, 'id') ?? 0;
        this.keyDown(this.mouseKey, 0.75);
      }),
      this.queries.pressed.subscribe('disqualify', () => {
        if (this.mouseKey >= 0) this.keyUp(this.mouseKey);
        this.mouseKey = -1;
      }),
    );

    const a = stage.actions;
    a.pianoLearn = () => (this.learning ? this.stopSong('Song stopped') : this.startSong());
    a.pianoSong = () => {
      this.song = (this.song + 1) % SONGS.length;
      stage.setPebbleLabel('pianoSong', `Song: ${SONGS[this.song].name}`);
      if (this.learning) this.startSong();
      else this.say(`${SONGS[this.song].name}: press Learn a song to start`);
    };
    a.pianoDown = () => this.shift(-12);
    a.pianoUp = () => this.shift(12);
    a.pianoSustain = () => {
      this.sustain = !this.sustain;
      stage.setPebbleLabel('pianoSustain', this.sustain ? 'Sustain: on' : 'Sustain: off');
      if (!this.sustain) this.releaseSustained();
    };
    a.pianoVolume = () => {
      this.volume = (this.volume + 1) % VOLUMES.length;
      stage.setPebbleLabel('pianoVolume', `Volume: ${Math.round(VOLUMES[this.volume] * 100)}%`);
    };
    a.pianoSound = () => {
      this.sound = (this.sound + 1) % PIANO_KINDS.length;
      stage.setPebbleLabel('pianoSound', `Sound: ${SOUND_NAMES[this.sound]}`);
      this.say(`${SOUND_NAMES[this.sound]} piano`);
    };
    a.pianoLabels = () => {
      this.labels = !this.labels;
      stage.setPebbleLabel('pianoLabels', this.labels ? 'Labels: on' : 'Labels: off');
      this.refreshLabels();
    };
    a.pianoScale = () => {
      this.scale = this.scale + 1 >= SCALES.length ? -1 : this.scale + 1;
      stage.setPebbleLabel('pianoScale', this.scale < 0 ? 'Scale: off' : SCALES[this.scale].name);
      if (this.scale >= 0) this.say(`${SCALES[this.scale].name}: glowing keys are in the scale`);
    };
    a.pianoChord = () => {
      this.chord = this.chord + 1 >= CHORDS.length ? -1 : this.chord + 1;
      this.chordDone = -1;
      stage.setPebbleLabel('pianoChord', this.chord < 0 ? 'Chord: off' : `Chord: ${CHORDS[this.chord].name}`);
      if (this.chord >= 0) this.say(`Press the three gold keys together: ${CHORDS[this.chord].name}`);
    };
  }

  /** A dark lacquered case with a neon strip, so it reads as one instrument. */
  private buildCase(): void {
    const width = 14 * WHITE_W + 0.05;
    const body = new MeshStandardMaterial({ color: 0x121228, roughness: 0.25, metalness: 0.6 });
    const base = decor(new Mesh(new BoxGeometry(width, 0.022, WHITE_L + 0.07), body));
    base.position.set(0, -WHITE_H - 0.011, -0.02);
    const back = decor(new Mesh(new BoxGeometry(width, 0.05, 0.05), body));
    back.position.set(0, 0.008, -WHITE_L / 2 - 0.03);
    const cheekGeo = new BoxGeometry(0.022, 0.04, WHITE_L + 0.07);
    const left = decor(new Mesh(cheekGeo, body));
    left.position.set(-width / 2 + 0.011, -0.002, -0.02);
    const right = decor(new Mesh(cheekGeo, body));
    right.position.set(width / 2 - 0.011, -0.002, -0.02);
    const neon = decor(new Mesh(
      new BoxGeometry(width - 0.03, 0.004, 0.004),
      new MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 1.6 }),
    ));
    neon.position.set(0, 0.034, -WHITE_L / 2 - 0.006);
    const neon2 = decor(new Mesh(
      new BoxGeometry(width - 0.03, 0.003, 0.003),
      new MeshStandardMaterial({ color: COLORS.violet, emissive: COLORS.violet, emissiveIntensity: 1.4 }),
    ));
    neon2.position.set(0, -WHITE_H - 0.023, WHITE_L / 2 + 0.014);
    const glow = glowSprite(COLORS.violet, 0.7, 0.18);
    glow.position.set(0, -0.03, -0.03);
    this.piano.add(base, back, left, right, neon, neon2, glow);
  }

  private say(text: string): void {
    this.status.set(text);
    this.statusAlpha = 4; // seconds-ish of full visibility before fading
  }

  private noteName(k: KeyState): string {
    const midi = this.base + k.semi;
    return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  }

  private refreshLabels(): void {
    for (const k of this.keys) {
      if (!k.label) continue;
      k.label.set(this.noteName(k));
      // Always mark the Cs so you can find your place; others when enabled.
      k.label.opacity = this.labels || k.semi % 12 === 0 ? 0.95 : 0;
    }
  }

  private shift(by: number): void {
    const next = Math.min(72, Math.max(36, this.base + by));
    if (next === this.base) {
      this.say(by > 0 ? 'Highest octave' : 'Lowest octave');
      return;
    }
    this.releaseAll();
    this.base = next;
    this.refreshLabels();
    this.say(`Keys from ${this.noteName(this.keys[0])} to ${this.noteName(this.keys[KEYS - 1])}`);
  }

  private startSong(): void {
    audio.start();
    const s = SONGS[this.song];
    this.notes = parseSong(s.notes, s.bpm);
    // The songs sit between C3 and B4: make sure those keys are showing.
    if (this.base !== 48) {
      this.releaseAll();
      this.base = 48;
      this.refreshLabels();
    }
    this.learning = true;
    this.songTime = -TILE_LEAD; // first tile starts at the top
    this.next = 0;
    this.waited = 0;
    this.onTime = 0;
    stage.setPebbleLabel('pianoLearn', 'Stop song');
    this.say(`${s.name}: press each key as its tile lands`);
    trace('piano song', s.name, this.notes.length, 'notes');
  }

  private stopSong(message: string): void {
    this.learning = false;
    for (const t of this.tiles) t.visible = false;
    stage.setPebbleLabel('pianoLearn', 'Learn a song');
    this.say(message);
  }

  /** Called on every key press while a song is running. */
  private judgeSong(midi: number): void {
    const n = this.notes[this.next];
    if (!n || n.midi !== midi) return;
    // Close enough to its landing time (or the song is waiting for it).
    if (n.t - this.songTime > ON_TIME) return;
    const early = n.t - this.songTime;
    const good = this.waited < ON_TIME && early < ON_TIME;
    if (good) this.onTime++;
    this.next++;
    this.waited = 0;
    // Rejoin the beat from this note, so the next tiles keep their spacing.
    this.songTime = Math.max(this.songTime, n.t - 0.05);
    trace('song note', this.next, '/', this.notes.length, good ? 'on time' : 'late');
    if (this.next >= this.notes.length) {
      const total = this.notes.length;
      fxAt(stage.stations.piano, 0, 0.1, this.piano.position.z, COLORS.gold, 0.25, 40);
      this.stopSong(`${SONGS[this.song].name} complete! ${this.onTime}/${total} on time`);
    }
  }

  private updateSong(dt: number, time: number): void {
    const n = this.notes[this.next];
    if (!n) return;
    // The song waits on the next note until you play it.
    if (this.songTime + dt >= n.t) {
      this.waited += dt;
      this.songTime = n.t;
    } else this.songTime += dt;
    if (this.waited > 1.2 && Math.floor(this.waited * 2) !== Math.floor((this.waited - dt) * 2)) {
      this.status.set(`Play ${NAMES[n.midi % 12]}${Math.floor(n.midi / 12) - 1} - the gold key`);
      this.statusAlpha = 1.5;
    }
    let used = 0;
    for (let i = this.next; i < this.notes.length && used < TILES; i++) {
      const note = this.notes[i];
      const until = note.t - this.songTime;
      if (until > TILE_LEAD) break;
      const semi = note.midi - this.base;
      if (semi < 0 || semi >= KEYS) continue;
      const k = this.keys[semi];
      const tile = this.tiles[used];
      const mat = this.tileMats[used++];
      const len = Math.max(0.012, note.dur * TILE_SPEED - 0.006);
      const w = (k.black ? BLACK_W : WHITE_W) * 0.8;
      tile.visible = true;
      tile.scale.set(w, len, 0.012);
      // The tile's bottom lands on the key top exactly when it should be played.
      tile.position.set(k.x, (k.black ? BLACK_UP : 0) + 0.004 + until * TILE_SPEED + len / 2, k.black ? -0.045 : -0.035);
      const isNext = i === this.next;
      mat.color.setHex(isNext ? COLORS.gold : k.black ? COLORS.magenta : COLORS.cyan);
      mat.opacity = isNext ? 0.75 + Math.sin(time * 10) * 0.2 : 0.55;
    }
    for (let i = used; i < TILES; i++) this.tiles[i].visible = false;
  }

  private keyDown(id: number, velocity: number): void {
    const k = this.keys[id];
    k.fingers++;
    if (k.fingers > 1) return; // already held by another finger
    // Re-striking a key that is still ringing under Sustain.
    if (k.voice >= 0) this.finish(k);
    const midi = this.base + k.semi;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    k.mesh.getWorldPosition(this.tmp);
    k.velocity = Math.min(1, velocity) * VOLUMES[this.volume];
    k.start = audio.now;
    k.voice = audio.pianoOn(PIANO_KINDS[this.sound], freq, k.velocity, this.tmp.x, this.tmp.y, this.tmp.z);
    k.sustained = false;
    k.glow = 1;
    // Note name pops up over the key for a moment.
    this.tag.set(this.noteName(k));
    this.tag.sprite.position.set(k.x, 0.05, k.black ? -0.04 : -0.01);
    this.tagAlpha = 1.4;
    fxAt(stage.stations.piano, this.piano.position.x + k.x, this.piano.position.y + 0.02, this.piano.position.z + (k.black ? -0.03 : 0.02),
      k.black ? COLORS.magenta : COLORS.cyan, 0.03 + velocity * 0.03, Math.round(1 + velocity * 4));
    trace('piano', this.noteName(k), velocity.toFixed(2));
    this.checkChord();
    if (this.learning) this.judgeSong(midi);
  }

  private keyUp(id: number): void {
    const k = this.keys[id];
    if (k.fingers === 0) return;
    k.fingers--;
    if (k.fingers > 0) return;
    if (this.sustain) k.sustained = true;
    else this.finish(k);
  }

  /** Stop the note and hand it, with its length, to the looper. */
  private finish(k: KeyState): void {
    if (k.voice < 0) return;
    const now = audio.now;
    audio.pianoOff(k.voice);
    k.voice = -1;
    k.sustained = false;
    const midi = this.base + k.semi;
    k.mesh.getWorldPosition(this.tmp);
    audio.emitLive(PIANO_KINDS[this.sound], 440 * Math.pow(2, (midi - 69) / 12), {
      velocity: k.velocity, duration: now - k.start, x: this.tmp.x, y: this.tmp.y, z: this.tmp.z,
    }, k.start);
  }

  private releaseSustained(): void {
    for (const k of this.keys) if (k.sustained && k.fingers === 0) this.finish(k);
  }

  private releaseAll(): void {
    this.fingerKey.fill(-1);
    this.mouseKey = -1;
    for (const k of this.keys) {
      k.fingers = 0;
      this.finish(k);
    }
  }

  /** Chord guide: celebrate when the three gold notes are held together. */
  private checkChord(): void {
    if (this.chord < 0) return;
    const want = CHORDS[this.chord].notes;
    let found = 0;
    for (const pc of want) {
      for (const k of this.keys) {
        if (k.fingers > 0 && (this.base + k.semi) % 12 === pc) {
          found++;
          break;
        }
      }
    }
    if (found === 3 && this.chordDone !== this.chord) {
      this.chordDone = this.chord;
      this.say(`${CHORDS[this.chord].name}!`);
      fxAt(stage.stations.piano, 0, 0.08, this.piano.position.z, COLORS.gold, 0.2, 24);
    }
  }

  /** World positions of every fingertip that hand tracking can see. */
  private readFingertips(): void {
    this.tipValid.fill(0);
    const xr = this.world.renderer.xr;
    const frame = xr.getFrame();
    const ref = xr.getReferenceSpace();
    const session = xr.getSession();
    let anyHand = false;
    if (frame && ref && session) {
      // Joint poses are relative to the XR origin, which is the player rig.
      this.player.updateMatrixWorld();
      for (const src of session.inputSources) {
        const hand = src.hand;
        if (!hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
        anyHand = true;
        const offset = src.handedness === 'left' ? 0 : 5;
        for (let j = 0; j < TIPS.length; j++) {
          const space = hand.get(TIPS[j]);
          const pose = space && frame.getJointPose ? frame.getJointPose(space, ref) : undefined;
          if (!pose) continue;
          const p = pose.transform.position;
          this.tips[offset + j].set(p.x, p.y, p.z).applyMatrix4(this.player.matrixWorld);
          this.tipValid[offset + j] = 1;
        }
      }
    }
    if (!anyHand) {
      // Controllers (or no joint data): the index tips IWSDK tracks.
      this.player.indexTipSpaces.left.getWorldPosition(this.tips[1]);
      this.player.indexTipSpaces.right.getWorldPosition(this.tips[6]);
      this.tipValid[1] = 1;
      this.tipValid[6] = 1;
    }
  }

  /** Which key a point (in keyboard space) is over, or -1. */
  private keyAt(p: Vector3): number {
    const halfW = 7 * WHITE_W;
    if (p.x < -halfW || p.x >= halfW || p.z < -WHITE_L / 2 || p.z > WHITE_L / 2 + 0.01) return -1;
    // The back part of the keyboard has black keys between some whites.
    if (p.z < -WHITE_L / 2 + BLACK_L + 0.004) {
      for (const k of this.keys) {
        if (k.black && Math.abs(p.x - k.x) < BLACK_W / 2 + 0.002) return k.semi;
      }
    }
    const white = Math.floor(p.x / WHITE_W + 7);
    let n = 0;
    for (const k of this.keys) {
      if (k.black) continue;
      if (n === white) return k.semi;
      n++;
    }
    return -1;
  }

  private detectFingers(dt: number): void {
    this.readFingertips();
    this.piano.updateMatrixWorld();
    this.inv.copy(this.piano.matrixWorld).invert();
    for (let f = 0; f < FINGERS; f++) {
      const held = this.fingerKey[f];
      if (!this.tipValid[f]) {
        if (held >= 0) {
          this.fingerKey[f] = -1;
          this.keyUp(held);
        }
        continue;
      }
      const p = this.tmp.copy(this.tips[f]).applyMatrix4(this.inv);
      // Downward speed, smoothed: hand poses arrive in steps.
      const v = (this.prevY[f] - p.y) / Math.max(dt, 0.001);
      this.prevY[f] = p.y;
      this.downSpeed[f] += (Math.min(Math.max(v, 0), 2) - this.downSpeed[f]) * 0.5;

      if (held >= 0) {
        // Stay on the held key while the finger is down and roughly over it,
        // so sliding a little near an edge never re-triggers.
        const k = this.keys[held];
        const top = k.black ? BLACK_UP : 0;
        const halfW = (k.black ? BLACK_W : WHITE_W) / 2 + 0.006;
        if (p.y > top + LIFT || Math.abs(p.x - k.x) > halfW || p.z > WHITE_L / 2 + 0.02 || p.z < -WHITE_L / 2 - 0.01) {
          this.fingerKey[f] = -1;
          this.keyUp(held);
        }
        continue;
      }
      const id = this.keyAt(p);
      if (id < 0) continue;
      const top = this.keys[id].black ? BLACK_UP : 0;
      // Pressed once the fingertip reaches the key top; a finger coming up
      // from below (through the case) is ignored.
      if (p.y < top + PRESS && p.y > top - 0.03) {
        this.fingerKey[f] = id;
        // Slow presses are soft, quick ones loud; noise cannot go below 0.3.
        const vel = Math.min(1, Math.max(0.3, 0.3 + (this.downSpeed[f] - 0.05) * 1.2));
        this.keyDown(id, vel);
      }
    }
  }

  update(delta: number, time: number): void {
    const active = stage.mode === 'piano';
    const visible = active || stage.showAll;
    if (this.piano.visible !== visible) {
      setShown(this.piano, visible);
      setShown(this.handle, visible);
    }
    if (visible) {
      grabOnly(this.handle);
      // The keyboard rides along with its handle.
      this.piano.position.copy(this.handle.position).sub(this.handleOffset);
      if (this.handleEntity.hasComponent(Grabbed)) this.releaseAll();
    }
    if (active !== this.wasActive) {
      this.wasActive = active;
      if (active) this.say('Play with your fingertips');
      else {
        this.releaseAll(); // never leave notes hanging when you move on
        if (this.learning) this.stopSong('');
      }
    }
    if (!active) return;
    const dt = Math.min(delta, 0.05);
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.detectFingers(delta);
    if (this.learning) this.updateSong(dt, time);
    const want = this.learning && this.notes[this.next] ? this.notes[this.next].midi - this.base : -1;

    const scale = this.scale >= 0 ? SCALES[this.scale] : null;
    const chord = this.chord >= 0 ? CHORDS[this.chord] : null;
    for (const k of this.keys) {
      const down = k.fingers > 0 ? 1 : 0;
      k.travel += (down - k.travel) * (1 - Math.exp(-dt * 40));
      k.mesh.position.y = (k.black ? BLACK_UP : 0) - WHITE_H / 2 - k.travel * TRAVEL;
      k.glow = Math.max(k.sustained || k.fingers > 0 ? 0.55 : 0, k.glow - dt * 3);
      const pc = (this.base + k.semi) % 12;
      // Gold = notes of the chord guide, cyan = in the chosen scale (root brighter).
      let hint = 0;
      let hintColor = COLORS.cyan;
      if (k.semi === want) {
        // Learn a song: the next key to play glows gold.
        hint = 0.7 + Math.sin(time * 8) * 0.25;
        hintColor = COLORS.gold;
      } else if (chord && chord.notes.includes(pc)) {
        hint = 0.55 + Math.sin(time * 6) * 0.2;
        hintColor = COLORS.gold;
      } else if (scale && scale.steps.includes((pc - scale.root + 12) % 12)) {
        hint = pc === scale.root ? 0.55 : 0.28;
      }
      if (k.glow > hint) {
        k.mat.emissive.setHex(k.black ? COLORS.magenta : COLORS.violet);
        k.mat.emissiveIntensity = k.glow * (k.black ? 2 : 0.9);
      } else {
        k.mat.emissive.setHex(hintColor);
        k.mat.emissiveIntensity = hint * (k.black ? 1.6 : 0.6);
      }
    }
    this.statusAlpha = Math.max(0, this.statusAlpha - dt);
    this.status.opacity = Math.min(1, this.statusAlpha);
    this.tagAlpha = Math.max(0, this.tagAlpha - dt * 1.5);
    this.tag.opacity = Math.min(1, this.tagAlpha);
  }
}
