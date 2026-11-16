/**
 * LooperSystem: record what you play, hear it loop, and layer more on top.
 *
 * Every hand-played note from any instrument reaches the looper through
 * audio.onLive. Recording starts on your first note (so there is no dead air
 * at the start), lasts two bars, then plays back forever on the audio clock.
 * Press record again to add a layer; the loop carries on while you switch
 * between the playground, the drums and the guitar.
 */
import { createSystem, Sprite } from '@iwsdk/core';
import { audio, type VoiceKind } from '../audio/engine.js';
import { COLORS, stage, trace } from '../stage.js';
import { glowSprite } from '../visuals/textures.js';

const MAX_EVENTS = 256;
const BEATS = 8; // two bars of 4/4
const LOOKAHEAD = 0.12;
const RED = 0xff3350;

type State = 'idle' | 'armed' | 'recording' | 'playing' | 'overdub';

export class LooperSystem extends createSystem({}) {
  private state: State = 'idle';
  private count = 0;
  private kinds: VoiceKind[] = new Array(MAX_EVENTS);
  private data = new Float32Array(MAX_EVENTS * 7); // offset, freq, vel, bright, x, y, z
  private loopStart = 0;
  private length = 0;
  private scheduledUntil = 0;
  private stateEnds = 0; // audio time the current recording pass finishes
  private bead!: Sprite;

  init(): void {
    // A bead circling the core shows where you are in the loop.
    this.bead = glowSprite(COLORS.mint, 0.045, 0.95);
    this.bead.visible = false;
    stage.root.add(this.bead);

    audio.onLive = (kind, freq, opts, time) => this.capture(kind, freq, opts, time);
    stage.actions.loop = () => this.pressRecord();
    stage.actions.loopClear = () => {
      this.count = 0;
      this.setState('idle');
      stage.toast('Loop cleared');
    };
  }

  private setState(state: State): void {
    this.state = state;
    const label = {
      idle: 'Record loop',
      armed: 'Play to start',
      recording: 'Recording...',
      playing: 'Add layer',
      overdub: 'Adding layer...',
    }[state];
    stage.setPebbleLabel('loop', label);
    trace('looper', state, 'events', this.count);
  }

  private pressRecord(): void {
    audio.start();
    if (this.state === 'idle') {
      this.setState('armed');
      stage.toast('Play something: recording starts on your first note');
    } else if (this.state === 'armed') {
      this.setState('idle');
    } else if (this.state === 'playing') {
      // Layer for exactly one pass of the loop, starting now.
      this.stateEnds = audio.now + this.length;
      this.setState('overdub');
    }
  }

  private capture(kind: VoiceKind, freq: number, opts: { velocity?: number; brightness?: number; x?: number; y?: number; z?: number }, time: number): void {
    if (this.state === 'armed') {
      // The first note defines the downbeat and the loop length.
      this.length = (60 / stage.bpm) * BEATS;
      this.loopStart = time;
      this.stateEnds = time + this.length;
      this.scheduledUntil = this.stateEnds;
      this.count = 0;
      this.setState('recording');
    }
    if ((this.state !== 'recording' && this.state !== 'overdub') || this.count >= MAX_EVENTS) return;
    const offset = (((time - this.loopStart) % this.length) + this.length) % this.length;
    const i = this.count++;
    trace('loop capture', kind, offset.toFixed(2));
    this.kinds[i] = kind;
    const j = i * 7;
    this.data[j] = offset;
    this.data[j + 1] = freq;
    this.data[j + 2] = opts.velocity ?? 0.8;
    this.data[j + 3] = opts.brightness ?? 0.6;
    this.data[j + 4] = opts.x ?? 0;
    this.data[j + 5] = opts.y ?? 1;
    this.data[j + 6] = opts.z ?? -0.5;
  }

  update(): void {
    const now = audio.now;
    if ((this.state === 'recording' || this.state === 'overdub') && now >= this.stateEnds) {
      if (this.state === 'recording') stage.toast('Looping. Switch instrument and add a layer');
      this.setState('playing');
    }

    // Schedule every recorded note whose next occurrence falls in the window.
    // This also runs during the first recording pass, so that notes right on
    // the downbeat are queued before the loop wraps round, not skipped.
    const to = now + LOOKAHEAD;
    if (this.state !== 'idle' && this.state !== 'armed' && to > this.scheduledUntil) {
      const from = Math.max(this.scheduledUntil, now);
      for (let i = 0; i < this.count; i++) {
        const j = i * 7;
        const k = Math.ceil((from - this.loopStart - this.data[j]) / this.length);
        const t = this.loopStart + k * this.length + this.data[j];
        if (t >= to) continue;
        trace('loop note', this.kinds[i], t.toFixed(2));
        audio.play(this.kinds[i], this.data[j + 1], {
          when: t,
          velocity: this.data[j + 2] * 0.85, // sit slightly under live playing
          brightness: this.data[j + 3],
          x: this.data[j + 4], y: this.data[j + 5], z: this.data[j + 6],
        });
      }
      this.scheduledUntil = to;
    }

    const active = this.state !== 'idle' && this.state !== 'armed';
    this.bead.visible = active || this.state === 'armed';
    if (active) {
      const phase = (((now - this.loopStart) % this.length) + this.length) % this.length / this.length;
      const a = phase * Math.PI * 2;
      this.bead.position.set(Math.sin(a) * 0.075, 0.0, Math.cos(a) * 0.075);
    } else {
      this.bead.position.set(0, 0.085, 0);
    }
    const recording = this.state === 'recording' || this.state === 'overdub' || this.state === 'armed';
    this.bead.material.color.setHex(recording ? RED : COLORS.mint);
    this.bead.scale.setScalar(recording ? 0.06 + Math.sin(now * 8) * 0.012 : 0.045);
  }
}
