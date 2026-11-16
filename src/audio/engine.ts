/**
 * RESONANCE procedural audio engine (Web Audio).
 *
 * Everything is synthesized: no samples are downloaded, so the app works
 * offline. All note starts take an absolute AudioContext time, which is what
 * lets the sequencer schedule sample-accurately instead of on frame ticks.
 *
 * Signal path:  voice -> panner -> master -> compressor -> destination
 *                               \-> fx send -> delay + reverb -> master
 * The analyser taps the compressor output and feeds the reactive visuals.
 */

export type VoiceKind =
  | 'soft' // sphere: warm synth pad pluck
  | 'perc' // cube: percussive electronic blip
  | 'bell' // ring: inharmonic bell
  | 'bass' // pyramid: deep bass
  | 'air' // crystal: slow atmospheric tone
  | 'pluck' // Karplus-Strong string
  | 'kick'
  | 'snare'
  | 'hat'
  | 'tom'
  | 'crash'
  | 'click'; // quiet metronome tick

export interface PlayOptions {
  /** AudioContext time to start at. Defaults to "now". */
  when?: number;
  /** 0..1 loudness. */
  velocity?: number;
  /** World position of the sound source (meters). */
  x?: number;
  y?: number;
  z?: number;
  /** Pluck only: 0 (dark) .. 1 (bright). */
  brightness?: number;
  /** True when a person just played this note (the looper records these). */
  live?: boolean;
}

const MAX_VOICES = 28;

export class AudioEngine {
  ctx: AudioContext | null = null;
  /** Smoothed 0..1 analysis values, refreshed by analyse() once per frame. */
  level = 0;
  bass = 0;
  mid = 0;
  high = 0;
  /** Latest time-domain samples (0..255, 128 = silence) for waveforms. */
  wave = new Uint8Array(256);

  private master!: GainNode;
  private fxSend!: GainNode;
  private analyser!: AnalyserNode;
  private noise!: AudioBuffer;
  private spectrum = new Uint8Array(256);
  private activeVoices = 0;
  /** Called for every live (hand-played) note; used by the looper. */
  onLive: ((kind: VoiceKind, freq: number, opts: PlayOptions, time: number) => void) | null = null;

  /** Must be called from a user gesture (click, pinch, entering XR). */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Compressor acts as a safety limiter so stacked voices never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(comp);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512; // 256 bins: cheap enough for a headset
    this.analyser.smoothingTimeConstant = 0.6;
    comp.connect(this.analyser);

    // Effects: a dotted-feel feedback delay and a synthetic reverb.
    this.fxSend = ctx.createGain();
    this.fxSend.gain.value = 1;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.33;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.22;
    this.fxSend.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(delayOut).connect(this.master);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(2.6);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.38;
    this.fxSend.connect(reverb).connect(reverbOut).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get running(): boolean {
    return this.ctx != null && this.ctx.state === 'running';
  }

  /** Keep the listener on the player's head so panning matches the scene. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Pull amplitude + three frequency bands. Call once per frame. */
  analyse(): void {
    if (!this.ctx) return;
    this.analyser.getByteFrequencyData(this.spectrum);
    this.analyser.getByteTimeDomainData(this.wave);
    // Bin width is ~94 Hz at 48 kHz: bass <280 Hz, mid <2.2 kHz, high above.
    let b = 0;
    let m = 0;
    let h = 0;
    for (let i = 1; i < 4; i++) b += this.spectrum[i];
    for (let i = 4; i < 24; i++) m += this.spectrum[i];
    for (let i = 24; i < 110; i++) h += this.spectrum[i];
    b /= 3 * 255;
    m /= 20 * 255;
    h /= 86 * 255;
    let peak = 0;
    for (let i = 0; i < this.wave.length; i += 2) {
      const v = Math.abs(this.wave[i] - 128);
      if (v > peak) peak = v;
    }
    const lvl = Math.min(1, peak / 90);
    // Fast attack, slow release so visuals pop and then breathe out.
    this.bass += (b - this.bass) * (b > this.bass ? 0.6 : 0.12);
    this.mid += (m - this.mid) * (m > this.mid ? 0.6 : 0.12);
    this.high += (Math.min(1, h * 2.2) - this.high) * 0.3;
    this.level += (lvl - this.level) * (lvl > this.level ? 0.7 : 0.1);
  }

  play(kind: VoiceKind, freq: number, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || this.activeVoices >= MAX_VOICES) return;
    const t = Math.max(opts.when ?? 0, ctx.currentTime + 0.003);
    const vel = Math.min(1, Math.max(0.05, opts.velocity ?? 0.8));
    if (opts.live && this.onLive) this.onLive(kind, freq, opts, t);

    const out = ctx.createGain();
    out.gain.value = vel;
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower'; // far cheaper than HRTF on a headset
    pan.distanceModel = 'inverse';
    pan.refDistance = 0.6;
    pan.rolloffFactor = 0.5;
    pan.positionX.value = opts.x ?? 0;
    pan.positionY.value = opts.y ?? 1;
    pan.positionZ.value = opts.z ?? -0.5;
    out.connect(pan);
    pan.connect(this.master);
    const send = ctx.createGain();
    pan.connect(send).connect(this.fxSend);

    let end = t + 1;
    switch (kind) {
      case 'soft':
        send.gain.value = 0.35;
        end = this.voiceSoft(out, freq, t);
        break;
      case 'perc':
        send.gain.value = 0.2;
        end = this.voicePerc(out, freq, t);
        break;
      case 'bell':
        send.gain.value = 0.5;
        end = this.voiceBell(out, freq, t);
        break;
      case 'bass':
        send.gain.value = 0.08;
        end = this.voiceBass(out, freq, t);
        break;
      case 'air':
        send.gain.value = 0.8;
        end = this.voiceAir(out, freq, t);
        break;
      case 'pluck':
        send.gain.value = 0.4;
        end = this.voicePluck(out, freq, t, opts.brightness ?? 0.6);
        break;
      case 'kick':
        send.gain.value = 0.03;
        end = this.voiceKick(out, t);
        break;
      case 'snare':
        send.gain.value = 0.25;
        end = this.voiceSnare(out, t);
        break;
      case 'hat':
        send.gain.value = 0.1;
        end = this.voiceHat(out, t);
        break;
      case 'tom':
        send.gain.value = 0.15;
        end = this.voiceTom(out, t);
        break;
      case 'crash':
        send.gain.value = 0.35;
        end = this.voiceCrash(out, t);
        break;
      case 'click':
        send.gain.value = 0;
        end = this.voiceClick(out, freq || 1200, t);
        break;
    }

    // Free the voice slot and disconnect once the tail has finished.
    this.activeVoices++;
    const ms = (end - ctx.currentTime + 0.1) * 1000;
    setTimeout(() => {
      this.activeVoices--;
      out.disconnect();
      pan.disconnect();
      send.disconnect();
    }, ms);
  }

  /**
   * Start a sustained synth voice (up to three notes) that keeps sounding
   * until released. Used by the Glide synth, where a pinch holds the note.
   */
  hold(): HeldVoice | null {
    if (!this.ctx) return null;
    return new HeldVoice(this.ctx, this.master, this.fxSend);
  }

  // ---- building blocks -------------------------------------------------

  private osc(type: OscillatorType, freq: number, t: number, end: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t);
    o.stop(end);
    return o;
  }

  /** ADSR envelope on a gain node; returns the time the release finishes. */
  private adsr(
    g: GainNode,
    t: number,
    peak: number,
    a: number,
    d: number,
    s: number,
    hold: number,
    r: number,
  ): number {
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d);
    p.setValueAtTime(Math.max(0.0001, peak * s), t + a + d + hold);
    p.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
    return t + a + d + hold + r;
  }

  private noiseSource(t: number, end: number): AudioBufferSourceNode {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    n.start(t, Math.random() * 0.9);
    n.stop(end);
    return n;
  }

  // ---- voices ----------------------------------------------------------

  private voiceSoft(out: GainNode, f: number, t: number): number {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const end = this.adsr(g, t, 0.5, 0.012, 0.25, 0.45, 0.1, 0.7);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 6, t);
    lp.frequency.exponentialRampToValueAtTime(f * 2, t + 0.5);
    const a = this.osc('triangle', f, t, end);
    const b = this.osc('sawtooth', f * 1.004, t, end);
    const bg = ctx.createGain();
    bg.gain.value = 0.25;
    const c = this.osc('sine', f * 2, t, end);
    const cg = ctx.createGain();
    cg.gain.value = 0.2;
    a.connect(lp);
    b.connect(bg).connect(lp);
    c.connect(cg).connect(lp);
    lp.connect(g).connect(out);
    return end;
  }

  private voicePerc(out: GainNode, f: number, t: number): number {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const end = this.adsr(g, t, 0.45, 0.002, 0.09, 0.15, 0, 0.16);
    const o = this.osc('square', f * 2, t, end);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2;
    bp.Q.value = 1.2;
    o.connect(bp).connect(g);
    // A tiny noise click gives the attack a mallet-like edge.
    const n = this.noiseSource(t, t + 0.03);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(ng).connect(g);
    g.connect(out);
    return end;
  }

  private voiceBell(out: GainNode, f: number, t: number): number {
    const ctx = this.ctx!;
    // Inharmonic partials are what make a bell sound like a bell.
    const ratios = [1, 2.76, 5.4, 8.93];
    const gains = [0.4, 0.2, 0.11, 0.05];
    const decays = [2.2, 1.3, 0.7, 0.35];
    let end = t;
    for (let i = 0; i < ratios.length; i++) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gains[i], t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decays[i]);
      const o = this.osc('sine', f * ratios[i], t, t + decays[i]);
      o.connect(g).connect(out);
      end = Math.max(end, t + decays[i]);
    }
    return end;
  }

  private voiceBass(out: GainNode, f: number, t: number): number {
    const ctx = this.ctx!;
    const low = f / 4; // two octaves under the resonator's note
    const g = ctx.createGain();
    const end = this.adsr(g, t, 0.7, 0.008, 0.2, 0.5, 0.15, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.3);
    const a = this.osc('sawtooth', low, t, end);
    const b = this.osc('sine', low, t, end);
    const ag = ctx.createGain();
    ag.gain.value = 0.5;
    a.connect(ag).connect(lp);
    b.connect(lp);
    lp.connect(g).connect(out);
    return end;
  }

  private voiceAir(out: GainNode, f: number, t: number): number {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const end = this.adsr(g, t, 0.3, 0.18, 0.4, 0.7, 0.5, 1.8);
    const a = this.osc('sine', f * 2, t, end);
    const b = this.osc('sine', f * 3.005, t, end);
    const c = this.osc('triangle', f * 0.999, t, end);
    const bg = ctx.createGain();
    bg.gain.value = 0.35;
    const cg = ctx.createGain();
    cg.gain.value = 0.4;
    // Slow vibrato keeps the pad alive.
    const lfo = this.osc('sine', 4.5, t, end);
    const lg = ctx.createGain();
    lg.gain.value = f * 0.008;
    lfo.connect(lg);
    lg.connect(a.frequency);
    a.connect(g);
    b.connect(bg).connect(g);
    c.connect(cg).connect(g);
    g.connect(out);
    return end;
  }

  /**
   * Karplus-Strong plucked string: a burst of noise circulates through a
   * delay line one period long, low-pass filtered on every pass so it decays
   * like a real string. Rendered into a buffer up front (about 1 ms of work)
   * so playback itself costs nothing and starts exactly on time.
   */
  private voicePluck(out: GainNode, f: number, t: number, brightness: number): number {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const dur = Math.min(2.4, 0.9 + 220 / f);
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / f));
    // Brightness shapes the excitation: darker plucks start pre-smoothed.
    let prev = 0;
    const smooth = 1 - 0.85 * (1 - brightness);
    for (let i = 0; i < period; i++) {
      const white = Math.random() * 2 - 1;
      prev = prev + (white - prev) * smooth;
      d[i] = prev;
    }
    const damping = 0.994 + 0.004 * brightness;
    for (let i = period; i < len; i++) {
      d[i] = damping * 0.5 * (d[i - period] + d[i - period + 1]);
    }
    // Short fade-out so the buffer end never clicks.
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(out);
    src.start(t);
    return t + dur;
  }

  private voiceKick(out: GainNode, t: number): number {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    const o = this.osc('sine', 150, t, t + 0.34);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(g).connect(out);
    return t + 0.34;
  }

  private voiceSnare(out: GainNode, t: number): number {
    const ctx = this.ctx!;
    const n = this.noiseSource(t, t + 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(bp).connect(ng).connect(out);
    const o = this.osc('triangle', 190, t, t + 0.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.3, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(og).connect(out);
    return t + 0.2;
  }

  private voiceHat(out: GainNode, t: number): number {
    const ctx = this.ctx!;
    const n = this.noiseSource(t, t + 0.07);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(hp).connect(g).connect(out);
    return t + 0.07;
  }

  private voiceTom(out: GainNode, t: number): number {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    const o = this.osc('sine', 230, t, t + 0.42);
    o.frequency.exponentialRampToValueAtTime(105, t + 0.25);
    o.connect(g).connect(out);
    return t + 0.42;
  }

  private voiceCrash(out: GainNode, t: number): number {
    const ctx = this.ctx!;
    const n = this.noiseSource(t, t + 1.3);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.25);
    n.connect(hp).connect(g).connect(out);
    return t + 1.3;
  }

  private voiceClick(out: GainNode, f: number, t: number): number {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    const o = this.osc('sine', f, t, t + 0.06);
    o.connect(g).connect(out);
    return t + 0.06;
  }

  /** Exponentially decaying stereo noise = a soft, diffuse hall. */
  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
    }
    return buf;
  }
}

/** One engine for the whole app. */
export const audio = new AudioEngine();

/** A held, glidable synth voice: three detuned oscillator pairs and a filter. */
export class HeldVoice {
  private oscs: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private filter: BiquadFilterNode;
  private out: GainNode;
  private send: GainNode;

  constructor(private ctx: AudioContext, master: AudioNode, fx: AudioNode) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.send = ctx.createGain();
    this.send.gain.value = 0.45;
    this.filter.connect(this.out);
    this.out.connect(master);
    this.out.connect(this.send).connect(fx);
    for (let i = 0; i < 3; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.filter);
      for (const [type, detune] of [['sawtooth', -6], ['triangle', 5]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.detune.value = detune;
        o.connect(g);
        o.start();
        this.oscs.push(o);
      }
      this.gains.push(g);
    }
    // Soft attack so a pinch never clicks.
    this.out.gain.setTargetAtTime(0.16, ctx.currentTime, 0.03);
  }

  /** Glide to new notes (1 to 3 frequencies) and filter brightness (Hz). */
  set(freqs: number[], cutoff: number): void {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const f = freqs[i];
      this.gains[i].gain.setTargetAtTime(f ? (i === 0 ? 1 : 0.6) : 0, t, 0.02);
      if (!f) continue;
      this.oscs[i * 2].frequency.setTargetAtTime(f, t, 0.025);
      this.oscs[i * 2 + 1].frequency.setTargetAtTime(f, t, 0.025);
    }
    this.filter.frequency.setTargetAtTime(cutoff, t, 0.04);
  }

  release(): void {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0.0001, t, 0.12);
    for (const o of this.oscs) o.stop(t + 1);
    setTimeout(() => {
      this.out.disconnect();
      this.send.disconnect();
    }, 1200);
  }
}
