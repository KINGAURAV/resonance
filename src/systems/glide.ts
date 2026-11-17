/**
 * GlideSystem: a synth you play by pinching the air.
 *
 * Pinch (thumb to index finger) to hold a note for as long as you like.
 * Slide the hand sideways to step through two octaves of the scale, and
 * raise or lower it to open or close the filter (bright vs mellow). Each
 * hand is its own voice, so two hands make harmony; with Chords on, every
 * pinch plays a three-note chord.
 *
 * Learn a song: the synth plays a tune while its note markers light up;
 * then you pinch the gold marker for each note in turn (let go and pinch
 * again to repeat a note).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  Pressed,
  RayInteractable,
  Sprite,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { audio, type HeldVoice } from '../audio/engine.js';
import { noteFreq, noteName } from '../audio/scale.js';
import { GlideNote } from '../resonance-components.js';
import { COLORS, setShown, stage, trace } from '../stage.js';
import { glowSprite, Label } from '../visuals/textures.js';
import { NO_NOTE, SCALE_SONGS, SongCoach } from './coach.js';

const NOTES = 10; // two octaves of the pentatonic scale
const STEP = 0.045; // meters of hand travel per note
const BASE_Y = 0.02; // height of the marker row (root-local)
const ROW_Z = 0.12;
const NOTE_COLORS = [COLORS.cyan, COLORS.mint, COLORS.gold, COLORS.magenta, COLORS.violet];
const noteX = (n: number) => (n - (NOTES - 1) / 2) * STEP;

export class GlideSystem extends createSystem({
  pressed: { required: [GlideNote, Pressed] },
}) {
  private group = new Group();
  private markers: Mesh[] = [];
  private glow = new Float32Array(NOTES);
  private beams: Mesh[] = [];
  private orbs: Sprite[] = [];
  private voices: (HeldVoice | null)[] = [null, null];
  private note = [-1, -1];
  private tip = new Vector3();
  private freqs: number[] = [0, 0, 0];
  private chords = false;
  private hint!: Label;
  private coach!: SongCoach;
  private songIndex = -1;
  private guide = glowSprite(COLORS.gold, 0.08, 0.9);

  init(): void {
    const g = this.group;
    g.name = 'GlideSynth';
    const entity = this.world.createTransformEntity(g, { parent: stage.stationEntities.glide });
    const box = new BoxGeometry(0.022, 0.022, 0.022);
    for (let n = 0; n < NOTES; n++) {
      const m = new Mesh(
        box,
        new MeshBasicMaterial({
          color: NOTE_COLORS[n % 5], transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false,
        }),
      );
      m.name = `Glide ${noteName(n - 5)}`;
      m.position.set(noteX(n), BASE_Y, ROW_Z);
      const label = new Label(noteName(n - 5), 0.014);
      label.sprite.position.y = -0.028;
      m.add(label.sprite);
      const e = this.world.createTransformEntity(m, { parent: entity });
      e.addComponent(GlideNote, { id: n });
      e.addComponent(RayInteractable); // click to hear a note in desktop preview
      this.markers.push(m);
    }
    // One light beam and one orb per hand show which note is being held.
    for (let h = 0; h < 2; h++) {
      const beam = new Mesh(
        new BoxGeometry(0.004, 1, 0.004),
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }),
      );
      beam.raycast = () => {};
      beam.visible = false;
      const orb = glowSprite(0xffffff, 0.09, 0.9);
      orb.visible = false;
      this.beams.push(beam);
      this.orbs.push(orb);
      g.add(beam, orb);
    }
    const hint = new Label('Pinch and move', 0.026, '#ffffff');
    hint.sprite.position.set(0, 0.3, 0.02);
    g.add(hint.sprite);
    this.hint = hint;
    this.guide.visible = false;
    g.add(this.guide);
    this.coach = new SongCoach(
      (step) => {
        audio.play('soft', noteFreq(step), { velocity: 0.7 });
        this.glow[step + 5] = 1;
      },
      (text) => this.hint.set(text),
      () => stage.setPebbleLabel('glideLearn', 'Learn a song'),
    );
    stage.actions.glideLearn = () => {
      if (this.coach.active) {
        this.coach.stop();
        this.hint.set('Pinch and move');
        stage.setPebbleLabel('glideLearn', 'Learn a song');
        return;
      }
      audio.start();
      this.songIndex = (this.songIndex + 1) % SCALE_SONGS.length;
      this.coach.start(SCALE_SONGS[this.songIndex]);
      stage.setPebbleLabel('glideLearn', 'Stop song');
    };
    setShown(g, false);

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (e) => {
        if (stage.mode !== 'glide') return;
        const n = e.getValue(GlideNote, 'id') ?? 0;
        audio.start();
        audio.play('soft', noteFreq(n - 5), { velocity: 0.8, live: true });
        this.glow[n] = 1;
        this.coach.hit(n - 5);
      }),
    );
    stage.actions.glideChord = () => {
      this.chords = !this.chords;
      stage.setPebbleLabel('glideChord', this.chords ? 'Chords: on' : 'Chords: off');
    };
  }

  private releaseHand(h: number): void {
    this.voices[h]?.release();
    this.voices[h] = null;
    this.note[h] = -1;
    this.beams[h].visible = false;
    this.orbs[h].visible = false;
  }

  private updateHand(h: number, side: 'left' | 'right'): void {
    const pinching = this.input.xr.gamepads[side]?.getSelecting() ?? false;
    if (!pinching) {
      if (this.voices[h]) this.releaseHand(h);
      return;
    }
    this.player.indexTipSpaces[side].getWorldPosition(this.tip);
    stage.stations.glide.worldToLocal(this.tip);
    // Only play inside the instrument's space, so pinching a pebble or
    // resting a hand in the lap stays silent.
    const inside = Math.abs(this.tip.x) < 0.27 && this.tip.y > -0.06 && this.tip.y < 0.45 && Math.abs(this.tip.z - ROW_Z) < 0.2;
    if (!inside) {
      if (this.voices[h]) this.releaseHand(h);
      return;
    }
    const n = Math.min(NOTES - 1, Math.max(0, Math.round(this.tip.x / STEP + (NOTES - 1) / 2)));
    const height = Math.min(1, Math.max(0, (this.tip.y - BASE_Y) / 0.3));
    const fresh = !this.voices[h];
    if (fresh) {
      audio.start();
      this.voices[h] = audio.hold();
    }
    if (n !== this.note[h] || fresh) {
      this.note[h] = n;
      this.coach.hit(n - 5); // a new pinch or a new note counts for the lesson
      trace('glide', side, noteName(n - 5), this.chords ? 'chord' : '');
    }
    // Pentatonic steps 0, +2, +4 stack into a consonant three-note chord.
    this.freqs[0] = noteFreq(n - 5);
    this.freqs[1] = this.chords ? noteFreq(n - 3) : 0;
    this.freqs[2] = this.chords ? noteFreq(n - 1) : 0;
    this.voices[h]?.set(this.freqs, 350 + height * height * 5200);
    this.glow[n] = 1;

    const beam = this.beams[h];
    const top = Math.max(BASE_Y + 0.02, this.tip.y);
    beam.visible = true;
    beam.position.set(noteX(n), (BASE_Y + top) / 2, ROW_Z);
    beam.scale.y = top - BASE_Y;
    (beam.material as MeshBasicMaterial).color.setHex(NOTE_COLORS[n % 5]);
    const orb = this.orbs[h];
    orb.visible = true;
    orb.position.copy(this.tip);
    orb.material.color.setHex(NOTE_COLORS[n % 5]);
    orb.scale.setScalar(0.07 + height * 0.09); // brighter tone = bigger orb
  }

  update(delta: number): void {
    if (stage.mode !== 'glide' && this.coach.active) {
      // Moving to another instrument ends the lesson.
      this.coach.stop();
      this.hint.set('Pinch and move');
      stage.setPebbleLabel('glideLearn', 'Learn a song');
    }
    const active = stage.mode === 'glide';
    const visible = active || stage.showAll;
    if (this.group.visible !== visible) setShown(this.group, visible);
    if (!active && (this.voices[0] || this.voices[1])) {
      this.releaseHand(0);
      this.releaseHand(1);
    }
    if (!visible) return;
    const dt = Math.min(delta, 0.05);
    const target = this.coach.active ? this.coach.update(dt) : NO_NOTE;
    this.guide.visible = target !== NO_NOTE && target + 5 >= 0 && target + 5 < NOTES;
    if (this.guide.visible) {
      this.guide.position.copy(this.markers[target + 5].position);
      this.guide.scale.setScalar(0.07 + Math.sin(performance.now() / 120) * 0.012);
    }
    if (active && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      this.updateHand(0, 'left');
      this.updateHand(1, 'right');
    }
    for (let n = 0; n < NOTES; n++) {
      this.glow[n] = Math.max(0, this.glow[n] - dt * 4);
      (this.markers[n].material as MeshBasicMaterial).opacity = 0.4 + this.glow[n] * 0.6;
      this.markers[n].scale.setScalar(1 + this.glow[n] * 0.9);
    }
  }
}
