/**
 * EchoSystem: the playground's lesson, a call-and-response game.
 *
 * The five shapes each have their own sound. The playground plays a short
 * phrase on them (step 1, listen), then you echo it back by touching the
 * shape that glows gold (step 2). Each round's phrase is a little longer;
 * finish all five rounds to complete the lesson.
 */
import { createSystem } from '@iwsdk/core';
import { audio } from '../audio/engine.js';
import { COLORS, stage } from '../stage.js';
import { glowSprite, Label } from '../visuals/textures.js';
import { NO_NOTE, song, SongCoach, type Song } from './coach.js';
import { flashResonator, soundResonator } from './resonators.js';

// Resonator ids: 0 sphere, 1 cube, 2 ring, 3 pyramid, 4 crystal.
const ROUNDS: Song[] = [
  song('Echo round 1', 90, '0 1 2:2'),
  song('Echo round 2', 90, '2 1 0 1:2'),
  song('Echo round 3', 90, '0 2 4 2 0:2'),
  song('Echo round 4', 96, '4 3 2 1 0:2'),
  song('Echo round 5', 100, '0 0 2 2 4 3:2'),
];

export class EchoSystem extends createSystem({}) {
  private coach!: SongCoach;
  private round = 0;
  private label = new Label('', 0.03, '#ffffff');
  private guide = glowSprite(COLORS.gold, 0.12, 0.9);
  private nextRoundIn = -1;

  init(): void {
    this.label.sprite.position.set(0, 0.33, -0.04);
    this.label.opacity = 0;
    stage.stations.playground.add(this.label.sprite);
    this.guide.visible = false;
    stage.root.add(this.guide);

    this.coach = new SongCoach(
      (id) => {
        const r = stage.resonators[id];
        if (!r) return;
        soundResonator(r, 0, 0.8);
        flashResonator(r, 0.8);
      },
      (text) => this.label.set(text),
      () => {
        if (this.round < ROUNDS.length - 1) {
          this.round++;
          this.nextRoundIn = 2;
        } else {
          this.label.set('You finished every echo!');
          stage.setPebbleLabel('echo', 'Learn: Echo');
        }
      },
    );

    // Wrap the shared hook so touches still drive the intro as well.
    const prev = stage.onNote;
    stage.onNote = (id) => {
      prev(id);
      this.coach.hit(id);
    };

    stage.actions.echo = () => {
      if (this.coach.active || this.nextRoundIn >= 0) this.endLesson('Echo stopped');
      else {
        audio.start();
        this.round = 0;
        this.coach.start(ROUNDS[0]);
        this.label.opacity = 1;
        stage.setPebbleLabel('echo', 'Stop echo');
      }
    };
  }

  private endLesson(text: string): void {
    this.coach.stop();
    this.nextRoundIn = -1;
    this.label.set(text);
    stage.setPebbleLabel('echo', 'Learn: Echo');
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.05);
    if (stage.mode !== 'playground') {
      if (this.coach.active || this.nextRoundIn >= 0) this.endLesson('');
      this.label.opacity = 0;
      this.guide.visible = false;
      return;
    }
    if (this.nextRoundIn >= 0) {
      this.nextRoundIn -= dt;
      if (this.nextRoundIn < 0) this.coach.start(ROUNDS[this.round]);
    }
    const target = this.coach.active ? this.coach.update(dt) : NO_NOTE;
    const r = target !== NO_NOTE ? stage.resonators[target] : undefined;
    this.guide.visible = !!r && r.shown;
    if (r && r.shown) {
      this.guide.position.copy(r.object.position);
      this.guide.scale.setScalar(0.12 + Math.sin(performance.now() / 120) * 0.02);
    }
  }
}
