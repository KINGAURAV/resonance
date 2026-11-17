/**
 * LooperSystem: record what you play, hear it loop, and layer more on top.
 *
 * Every hand-played note from any instrument reaches the looper through
 * audio.onLive. Press "Record loop" and four count-in clicks play (with a big
 * 4-3-2-1 above the controls); recording then runs for exactly two bars and
 * the loop closes on the bar line. Notes snap to the nearest sixteenth unless
 * snapping is switched off. Press again to add a layer: it starts on the next
 * loop downbeat after a count-in. "Undo layer" removes the newest layer.
 */
import { createSystem, Sprite } from '@iwsdk/core';
import { audio, type VoiceKind } from '../audio/engine.js';
import { COLORS, stage, trace } from '../stage.js';
import { glowSprite, Label } from '../visuals/textures.js';

const MAX_EVENTS = 384;
const MAX_LAYERS = 16;
const BEATS = 8; // two bars of 4/4
const COUNT_IN = 4; // beats
const LOOKAHEAD = 0.12;
const RED = 0xff3350;
const F = 8; // floats per event: offset, freq, vel, bright, x, y, z, validFrom

type State = 'idle' | 'countin' | 'recording' | 'playing' | 'overdubWait' | 'overdub';

export class LooperSystem extends createSystem({}) {
  private state: State = 'idle';
  private count = 0;
  private kinds: VoiceKind[] = new Array(MAX_EVENTS);
  private data = new Float32Array(MAX_EVENTS * F);
  private layerStarts = new Int32Array(MAX_LAYERS); // event index each layer begins at
  private layers = 0;
  private snap = true;
  private loopStart = 0;
  private length = 0;
  private beat = 0; // seconds per beat, fixed when the loop is made
  private scheduledUntil = 0;
  private stateStarts = 0; // audio time recording (or the layer) begins
  private stateEnds = 0; // audio time the current recording pass finishes
  private clicksDone = 0;
  private bead!: Sprite;
  private counter!: Label;
  private shownCount = -1;

  init(): void {
    // A bead circling the core shows where you are in the loop.
    this.bead = glowSprite(COLORS.mint, 0.045, 0.95);
    this.bead.visible = false;
    stage.root.add(this.bead);
    // The count-in number floats over the controls of whichever instrument
    // you are facing.
    this.counter = new Label('', 0.07, '#ffffff');
    this.counter.sprite.position.set(0, 0.2, 0.06);
    this.counter.opacity = 0;
    stage.uiStation.add(this.counter.sprite);

    audio.onLive = (kind, freq, opts, time) => this.capture(kind, freq, opts, time);
    stage.actions.loop = () => this.pressRecord();
    stage.actions.loopClear = () => {
      this.count = 0;
      this.layers = 0;
      this.setState('idle');
      stage.toast('Loop cleared');
    };
    stage.actions.loopUndo = () => this.undo();
    stage.actions.snap = () => {
      this.snap = !this.snap;
      stage.setPebbleLabel('snap', this.snap ? 'Snap: on' : 'Snap: off');
      stage.toast(this.snap ? 'Notes snap to the beat' : 'Notes keep your exact timing');
    };
  }

  private setState(state: State): void {
    this.state = state;
    const label = {
      idle: 'Record loop',
      countin: 'Cancel',
      recording: 'Recording...',
      playing: 'Add layer',
      overdubWait: 'Cancel',
      overdub: 'Adding layer...',
    }[state];
    stage.setPebbleLabel('loop', label);
    this.updateStatus();
    trace('looper', state, 'events', this.count, 'layers', this.layers);
  }

  private updateStatus(): void {
    const s = this.state;
    const layers = `${this.layers} layer${this.layers === 1 ? '' : 's'}`;
    stage.loopStatus =
      s === 'idle' ? 'Loop: empty'
      : s === 'countin' || s === 'overdubWait' ? 'Loop: get ready'
      : s === 'recording' || s === 'overdub' ? `Loop: recording (${layers})`
      : `Loop: playing (${layers})`;
  }

  /** Schedule the count-in clicks for the beats before `start`. */
  private beginCountIn(start: number): void {
    this.stateStarts = start;
    this.clicksDone = 0;
  }

  private pressRecord(): void {
    audio.start();
    const now = audio.now;
    switch (this.state) {
      case 'idle': {
        this.beat = 60 / stage.bpm;
        this.length = this.beat * BEATS;
        this.loopStart = now + this.beat * COUNT_IN + 0.1;
        this.stateEnds = this.loopStart + this.length;
        this.scheduledUntil = this.loopStart;
        this.count = 0;
        this.layers = 1;
        this.layerStarts[0] = 0;
        this.beginCountIn(this.loopStart);
        this.setState('countin');
        stage.toast('Get ready: recording after four clicks');
        break;
      }
      case 'countin':
        this.layers = 0;
        this.setState('idle');
        break;
      case 'playing': {
        if (this.layers >= MAX_LAYERS || this.count >= MAX_EVENTS) {
          stage.toast('Loop is full: undo a layer first');
          return;
        }
        // The new layer starts on the next loop downbeat that leaves room
        // for a full count-in.
        const lead = this.beat * COUNT_IN;
        let k = Math.ceil((now + lead - this.loopStart) / this.length);
        if (k < 1) k = 1;
        const start = this.loopStart + k * this.length;
        this.stateEnds = start + this.length;
        this.layerStarts[this.layers++] = this.count;
        this.beginCountIn(start);
        this.setState('overdubWait');
        break;
      }
      case 'overdubWait':
        this.layers--;
        this.setState('playing');
        break;
      default:
        break; // recording: the loop closes on its own at the bar line
    }
  }

  private undo(): void {
    if (this.state === 'recording' || this.state === 'countin') {
      this.count = 0;
      this.layers = 0;
      this.setState('idle');
      stage.toast('Recording discarded');
      return;
    }
    if (this.layers === 0) {
      stage.toast('Nothing to undo');
      return;
    }
    if (this.state === 'overdubWait') this.layers--; // drop the empty pending layer too
    this.layers--;
    this.count = this.layers > 0 ? this.layerStarts[this.layers] : 0;
    if (this.layers === 0) {
      this.setState('idle');
      stage.toast('Loop removed');
    } else {
      this.setState('playing');
      stage.toast('Last layer removed');
    }
  }

  private capture(kind: VoiceKind, freq: number, opts: { velocity?: number; brightness?: number; x?: number; y?: number; z?: number }, time: number): void {
    const recording = this.state === 'recording' || this.state === 'overdub';
    // A note played just before the first beat (people rush the downbeat)
    // still belongs to the loop.
    const early = (this.state === 'countin' || this.state === 'overdubWait') && time > this.stateStarts - this.beat * 0.25;
    if ((!recording && !early) || this.count >= MAX_EVENTS) return;
    let offset = (((time - this.loopStart) % this.length) + this.length) % this.length;
    let validFrom = 0;
    if (this.snap) {
      const grid = this.beat / 4; // sixteenth notes
      const snapped = Math.round(offset / grid) * grid;
      // If snapping moved the note later, its first copy would sound right
      // after the live note (a flam): skip that first repeat.
      if (snapped > offset) validFrom = time + this.length * 0.5;
      offset = snapped % this.length;
    }
    const i = this.count++;
    trace('loop capture', kind, offset.toFixed(3));
    this.kinds[i] = kind;
    const j = i * F;
    this.data[j] = offset;
    this.data[j + 1] = freq;
    this.data[j + 2] = opts.velocity ?? 0.8;
    this.data[j + 3] = opts.brightness ?? 0.6;
    this.data[j + 4] = opts.x ?? 0;
    this.data[j + 5] = opts.y ?? 1;
    this.data[j + 6] = opts.z ?? -0.5;
    this.data[j + 7] = validFrom;
  }

  private runCountIn(now: number): void {
    // Clicks on each of the four beats before the start, scheduled ahead.
    while (this.clicksDone < COUNT_IN) {
      const t = this.stateStarts - (COUNT_IN - this.clicksDone) * this.beat;
      if (t > now + 0.15) break;
      const p = stage.root.position;
      if (t > now) audio.play('click', this.clicksDone === 0 ? 1600 : 1100, { when: t, velocity: 0.55, x: p.x, y: p.y, z: p.z });
      this.clicksDone++;
    }
    const left = Math.ceil((this.stateStarts - now) / this.beat);
    const n = left > COUNT_IN ? -1 : left;
    if (n !== this.shownCount) {
      this.shownCount = n;
      this.counter.set(n > 0 ? String(n) : '');
    }
    this.counter.opacity = n > 0 ? 1 : 0;
    const frac = ((this.stateStarts - now) / this.beat) % 1;
    this.counter.sprite.scale.set(0.07 * (512 / 96) * (1 + frac * 0.3), 0.07 * (1 + frac * 0.3), 1);
  }

  update(): void {
    const now = audio.now;
    const s = this.state;
    if (s === 'countin' || s === 'overdubWait') {
      this.runCountIn(now);
      if (now >= this.stateStarts) {
        this.counter.opacity = 0;
        this.shownCount = -1;
        if (s === 'countin') {
          this.setState('recording');
          stage.toast('Recording: two bars');
        } else this.setState('overdub');
      }
    } else if ((s === 'recording' || s === 'overdub') && now >= this.stateEnds) {
      if (s === 'recording' && this.count === 0) {
        this.layers = 0;
        this.setState('idle');
        stage.toast('Nothing was played: loop not saved');
      } else {
        if (s === 'recording') stage.toast('Looping. Turn to another instrument and add a layer');
        this.setState('playing');
      }
    } else if (this.counter.sprite.visible) {
      this.counter.opacity = 0;
    }

    // Schedule every recorded note whose next occurrence falls in the window.
    // This also runs while recording, so notes right on the downbeat are
    // queued before the loop wraps round, not skipped.
    const to = now + LOOKAHEAD;
    const active = s !== 'idle' && s !== 'countin';
    if (active && to > this.scheduledUntil) {
      const from = Math.max(this.scheduledUntil, now);
      for (let i = 0; i < this.count; i++) {
        const j = i * F;
        const k = Math.ceil((from - this.loopStart - this.data[j]) / this.length);
        let t = this.loopStart + k * this.length + this.data[j];
        if (t < this.data[j + 7]) t += this.length;
        if (t >= to) continue;
        audio.play(this.kinds[i], this.data[j + 1], {
          when: t,
          velocity: this.data[j + 2] * 0.85, // sit slightly under live playing
          brightness: this.data[j + 3],
          x: this.data[j + 4], y: this.data[j + 5], z: this.data[j + 6],
        });
      }
      this.scheduledUntil = to;
    }

    const looping = active && now >= this.loopStart;
    this.bead.visible = s !== 'idle';
    if (looping) {
      const phase = (((now - this.loopStart) % this.length) + this.length) % this.length / this.length;
      const a = phase * Math.PI * 2;
      this.bead.position.set(Math.sin(a) * 0.075, 0.0, Math.cos(a) * 0.075);
    } else {
      this.bead.position.set(0, 0.085, 0);
    }
    const rec = s === 'recording' || s === 'overdub' || s === 'countin' || s === 'overdubWait';
    this.bead.material.color.setHex(rec ? RED : COLORS.mint);
    this.bead.scale.setScalar(rec ? 0.06 + Math.sin(now * 8) * 0.012 : 0.045);
  }
}
