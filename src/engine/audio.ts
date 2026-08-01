import { clamp01 } from '../core/math';

/**
 * Procedural audio engine.
 *
 * Every sound is synthesised at runtime with the Web Audio API — impacts,
 * crowd, footsteps and music. That means zero audio download, instant load,
 * and infinite variation (no two slams sound identical). Perfect for a mobile
 * APK where every megabyte counts.
 */

export type SfxName =
  | 'hit_light'
  | 'hit_medium'
  | 'hit_heavy'
  | 'slam'
  | 'throw'
  | 'grapple'
  | 'whoosh'
  | 'block'
  | 'reversal'
  | 'submission'
  | 'bell'
  | 'whistle'
  | 'ui_tap'
  | 'ui_confirm'
  | 'ui_back'
  | 'ui_error'
  | 'unlock'
  | 'levelup'
  | 'coin'
  | 'footstep'
  | 'breath'
  | 'countdown'
  | 'victory'
  | 'defeat'
  | 'finisher_charge';

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  crowd: number;
  commentary: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private crowdGain!: GainNode;
  private voiceGain!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private noiseBuffer: AudioBuffer | null = null;
  private crowdSource: AudioBufferSourceNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private crowdLevel = 0;
  private musicNodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private currentTrack: 'menu' | 'match' | 'victory' | null = null;
  private settings: AudioSettings = { master: 0.9, music: 0.55, sfx: 0.95, crowd: 0.8, commentary: true };
  private unlocked = false;
  private speechAvailable = false;
  private lastCommentary = 0;

  get isReady(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture on mobile. */
  async unlock(): Promise<void> {
    if (this.unlocked) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      await this.ctx.resume();

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.22;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.settings.master;
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.settings.sfx;
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.settings.music;
      this.crowdGain = this.ctx.createGain();
      this.crowdGain.gain.value = 0;
      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.value = 0.85;

      this.sfxGain.connect(this.compressor);
      this.musicGain.connect(this.compressor);
      this.crowdGain.connect(this.compressor);
      this.voiceGain.connect(this.compressor);
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.buildNoise();
      this.startCrowdBed();
      this.unlocked = true;
      this.speechAvailable = typeof globalThis.speechSynthesis !== 'undefined';
    } catch {
      this.ctx = null;
    }
  }

  applySettings(s: Partial<AudioSettings>): void {
    Object.assign(this.settings, s);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.settings.master, t, 0.05);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.settings.music * 0.5, t, 0.15);
  }

  private buildNoise(): void {
    if (!this.ctx) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Pink-ish noise: sounds far more like a crowd than white noise.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    this.noiseBuffer = buf;
  }

  private startCrowdBed(): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.7;

    const shaper = this.ctx.createBiquadFilter();
    shaper.type = 'lowpass';
    shaper.frequency.value = 2400;

    src.connect(filter);
    filter.connect(shaper);
    shaper.connect(this.crowdGain);
    src.start();
    this.crowdSource = src;
    this.crowdFilter = filter;
  }

  /** Drive the crowd bed from the sim's crowd intensity. */
  setCrowd(intensity: number): void {
    if (!this.ctx) return;
    const target = clamp01(intensity);
    this.crowdLevel = target;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(target * 0.35 * this.settings.crowd, t, 0.25);
    if (this.crowdFilter) {
      this.crowdFilter.frequency.setTargetAtTime(600 + target * 900, t, 0.4);
      this.crowdFilter.Q.setTargetAtTime(0.6 + target * 1.6, t, 0.4);
    }
  }

  /** A sharp crowd reaction spike on top of the bed. */
  crowdPop(strength: number): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.3;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900 + strength * 700;
    filter.Q.value = 0.9;

    const gain = this.ctx.createGain();
    const peak = clamp01(strength) * 0.5 * this.settings.crowd;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 + strength * 1.4);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.crowdGain);
    src.start(t, Math.random());
    src.stop(t + 2.6);
  }

  // ------------------------------------------------------------------- sfx

  play(name: SfxName, opts: { volume?: number; pitch?: number } = {}): void {
    if (!this.ctx) return;
    const vol = (opts.volume ?? 1) * 0.9;
    const pitch = opts.pitch ?? 1;
    const t = this.ctx.currentTime;

    switch (name) {
      case 'hit_light':
        this.impactSound(t, vol * 0.5, 220 * pitch, 0.08, 0.3);
        break;
      case 'hit_medium':
        this.impactSound(t, vol * 0.75, 150 * pitch, 0.14, 0.55);
        break;
      case 'hit_heavy':
        this.impactSound(t, vol, 92 * pitch, 0.22, 0.85);
        break;
      case 'slam':
        this.slamSound(t, vol);
        break;
      case 'throw':
        this.whoosh(t, vol * 0.8, 0.34);
        globalThis.setTimeout(() => this.ctx && this.slamSound(this.ctx.currentTime, vol * 0.9), 280);
        break;
      case 'grapple':
        this.clothSound(t, vol * 0.6);
        break;
      case 'whoosh':
        this.whoosh(t, vol * 0.6, 0.22);
        break;
      case 'block':
        this.impactSound(t, vol * 0.5, 320 * pitch, 0.06, 0.2);
        this.clothSound(t, vol * 0.4);
        break;
      case 'reversal':
        this.sweep(t, vol * 0.7, 300, 1200, 0.28, 'sawtooth');
        this.clothSound(t + 0.05, vol * 0.5);
        break;
      case 'submission':
        this.sweep(t, vol * 0.6, 180, 90, 0.7, 'sine');
        break;
      case 'bell':
        this.bellSound(t, vol);
        break;
      case 'whistle':
        this.whistleSound(t, vol * 0.7);
        break;
      case 'ui_tap':
        this.blip(t, vol * 0.28, 880 * pitch, 0.05, 'sine');
        break;
      case 'ui_confirm':
        this.blip(t, vol * 0.32, 660, 0.07, 'triangle');
        this.blip(t + 0.07, vol * 0.32, 990, 0.09, 'triangle');
        break;
      case 'ui_back':
        this.blip(t, vol * 0.26, 520, 0.06, 'sine');
        this.blip(t + 0.05, vol * 0.24, 370, 0.08, 'sine');
        break;
      case 'ui_error':
        this.blip(t, vol * 0.3, 200, 0.14, 'square');
        break;
      case 'unlock':
        for (let i = 0; i < 4; i++) {
          this.blip(t + i * 0.075, vol * 0.28, 520 * Math.pow(1.26, i), 0.13, 'triangle');
        }
        break;
      case 'levelup':
        for (let i = 0; i < 6; i++) {
          this.blip(t + i * 0.09, vol * 0.3, 440 * Math.pow(1.2, i), 0.2, 'triangle');
        }
        break;
      case 'coin':
        this.blip(t, vol * 0.24, 1180, 0.05, 'square');
        this.blip(t + 0.045, vol * 0.22, 1560, 0.08, 'square');
        break;
      case 'footstep':
        this.impactSound(t, vol * 0.18, 90, 0.05, 0.16);
        break;
      case 'breath':
        this.breathSound(t, vol * 0.4);
        break;
      case 'countdown':
        this.blip(t, vol * 0.4, 440 * pitch, 0.22, 'sine');
        break;
      case 'victory':
        this.fanfare(t, vol, true);
        break;
      case 'defeat':
        this.fanfare(t, vol * 0.8, false);
        break;
      case 'finisher_charge':
        this.sweep(t, vol * 0.6, 120, 900, 1.1, 'sawtooth');
        break;
    }
  }

  private env(node: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(this.sfxGain);
    return g;
  }

  private impactSound(t: number, vol: number, freq: number, attack: number, decay: number): void {
    const ctx = this.ctx!;
    // Body: pitched thud.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 2.2, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.55), t + decay * 0.7);
    this.env(osc, t, vol * 0.85, 0.004, decay);
    osc.start(t);
    osc.stop(t + attack + decay + 0.1);

    // Slap: filtered noise transient.
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = 1.4;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1400 + vol * 900;
      f.Q.value = 1.1;
      src.connect(f);
      this.env(f, t, vol * 0.5, 0.002, decay * 0.4);
      src.start(t, Math.random());
      src.stop(t + 0.3);
    }
  }

  private slamSound(t: number, vol: number): void {
    const ctx = this.ctx!;
    // Deep mat boom.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    this.env(osc, t, vol * 1.1, 0.005, 0.62);
    osc.start(t);
    osc.stop(t + 0.8);

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(74, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.42);
    this.env(sub, t, vol * 0.7, 0.006, 0.5);
    sub.start(t);
    sub.stop(t + 0.7);

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(320, t + 0.3);
      src.connect(f);
      this.env(f, t, vol * 0.65, 0.002, 0.34);
      src.start(t, Math.random());
      src.stop(t + 0.5);
    }
  }

  private clothSound(t: number, vol: number): void {
    if (!this.noiseBuffer) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2200;
    src.connect(f);
    this.env(f, t, vol * 0.4, 0.01, 0.2);
    src.start(t, Math.random());
    src.stop(t + 0.35);
  }

  private whoosh(t: number, vol: number, dur: number): void {
    if (!this.noiseBuffer) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.6);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    src.connect(f);
    this.env(f, t, vol * 0.55, dur * 0.3, dur * 0.7);
    src.start(t, Math.random());
    src.stop(t + dur + 0.2);
  }

  private sweep(
    t: number,
    vol: number,
    from: number,
    to: number,
    dur: number,
    type: OscillatorType,
  ): void {
    const osc = this.ctx!.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const f = this.ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3200;
    osc.connect(f);
    this.env(f, t, vol * 0.4, 0.02, dur);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private blip(t: number, vol: number, freq: number, dur: number, type: OscillatorType): void {
    const osc = this.ctx!.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    this.env(osc, t, vol, 0.006, dur);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  private bellSound(t: number, vol: number): void {
    // Ring bell = stacked inharmonic partials.
    const partials = [1, 2.76, 5.4, 8.93];
    const base = 620;
    for (let i = 0; i < partials.length; i++) {
      const osc = this.ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * partials[i];
      this.env(osc, t, (vol * 0.4) / (i + 1), 0.003, 1.6 / (i * 0.5 + 1));
      osc.start(t);
      osc.stop(t + 2.2);
    }
  }

  private whistleSound(t: number, vol: number): void {
    const osc = this.ctx!.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2100, t);
    const lfo = this.ctx!.createOscillator();
    lfo.frequency.value = 26;
    const lfoGain = this.ctx!.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    this.env(osc, t, vol * 0.3, 0.02, 0.5);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.7);
    lfo.stop(t + 0.7);
  }

  private breathSound(t: number, vol: number): void {
    if (!this.noiseBuffer) return;
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.5;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(900, t + 0.3);
    f.Q.value = 1.4;
    src.connect(f);
    this.env(f, t, vol * 0.35, 0.09, 0.32);
    src.start(t, Math.random());
    src.stop(t + 0.6);
  }

  private fanfare(t: number, vol: number, win: boolean): void {
    const notes = win ? [523, 659, 784, 1047, 1319] : [392, 349, 294, 233];
    for (let i = 0; i < notes.length; i++) {
      const start = t + i * (win ? 0.13 : 0.22);
      for (const [mult, gain] of [[1, 0.28] as const, [2, 0.1] as const, [0.5, 0.16] as const]) {
        const osc = this.ctx!.createOscillator();
        osc.type = win ? 'sawtooth' : 'sine';
        osc.frequency.value = notes[i] * mult;
        const f = this.ctx!.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 2600;
        osc.connect(f);
        this.env(f, start, vol * gain, 0.02, win ? 0.5 : 0.8);
        osc.start(start);
        osc.stop(start + 1.2);
      }
    }
  }

  // ----------------------------------------------------------------- music

  /**
   * Adaptive procedural score. A driving bassline + pads whose intensity
   * follows the match, so menus feel calm and title fights feel enormous.
   */
  playMusic(track: 'menu' | 'match' | 'victory'): void {
    if (!this.ctx || this.currentTrack === track) return;
    this.stopMusic();
    this.currentTrack = track;
    const ctx = this.ctx;

    const scales = {
      menu: [55, 65.4, 73.4, 82.4, 98, 110],
      match: [49, 58.3, 65.4, 73.4, 87.3, 98],
      victory: [65.4, 82.4, 98, 130.8, 164.8, 196],
    } as const;
    const scale = scales[track];
    const tempo = track === 'menu' ? 620 : track === 'victory' ? 300 : 380;

    // Sustained pad for atmosphere.
    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padGain.connect(this.musicGain);
    padGain.gain.setTargetAtTime(track === 'menu' ? 0.1 : 0.07, ctx.currentTime, 1.5);

    for (const mult of [1, 1.5, 2.02]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = scale[0] * mult;
      osc.detune.value = (Math.random() - 0.5) * 14;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 480;
      f.Q.value = 1.2;
      osc.connect(f);
      f.connect(padGain);
      osc.start();
      this.musicNodes.push({ osc, gain: padGain });
    }

    this.musicStep = 0;
    this.musicTimer = setInterval(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const step = this.musicStep++;
      const intensity = track === 'match' ? 0.5 + this.crowdLevel * 0.5 : 0.6;

      // Bass pulse on the beat.
      const noteIdx = [0, 0, 3, 0, 2, 0, 4, 1][step % 8];
      const bass = this.ctx.createOscillator();
      bass.type = 'triangle';
      bass.frequency.value = scale[noteIdx];
      const bg = this.ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.16 * intensity, t + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      bass.connect(bg);
      bg.connect(this.musicGain);
      bass.start(t);
      bass.stop(t + 0.5);

      // Percussion on off-beats when the match is hot.
      if (track !== 'menu' && step % 2 === 1 && this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.playbackRate.value = 2.4;
        const f = this.ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 5200;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.05 * intensity, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        src.connect(f);
        f.connect(g);
        g.connect(this.musicGain);
        src.start(t, Math.random());
        src.stop(t + 0.15);
      }

      // Melodic accent every bar.
      if (step % 8 === 0 || (track === 'victory' && step % 2 === 0)) {
        const lead = this.ctx.createOscillator();
        lead.type = 'square';
        lead.frequency.value = scale[(step / 2 + 2) % scale.length] * 4;
        const lg = this.ctx.createGain();
        lg.gain.setValueAtTime(0.0001, t);
        lg.gain.linearRampToValueAtTime(0.035 * intensity, t + 0.04);
        lg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        const lf = this.ctx.createBiquadFilter();
        lf.type = 'lowpass';
        lf.frequency.value = 2200;
        lead.connect(lf);
        lf.connect(lg);
        lg.connect(this.musicGain);
        lead.start(t);
        lead.stop(t + 0.7);
      }
    }, tempo);
  }

  stopMusic(): void {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    for (const { osc, gain } of this.musicNodes) {
      try {
        if (this.ctx) gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
        osc.stop(this.ctx ? this.ctx.currentTime + 1.2 : 0);
      } catch {
        /* already stopped */
      }
    }
    this.musicNodes = [];
    this.currentTrack = null;
  }

  // ------------------------------------------------------------ commentary

  /**
   * Persian in-match commentary ("گزارش‌گر"). Uses the platform TTS voice set
   * to Persian (fa-IR) where available, falls back to any Persian voice, and
   * finally to the default. No recorded VO to ship — every line is dynamic.
   */
  say(line: string, priority = false): void {
    if (!this.settings.commentary || !this.speechAvailable) return;
    const now = Date.now();
    if (!priority && now - this.lastCommentary < 3200) return;
    this.lastCommentary = now;
    try {
      const synth = globalThis.speechSynthesis;
      if (priority) synth.cancel();
      else if (synth.speaking) return;
      const u = new SpeechSynthesisUtterance(line);
      u.lang = 'fa-IR';
      u.rate = 1.05;
      u.pitch = 1.05;
      u.volume = clamp01(this.settings.master * 0.9);
      // Try to pick a Persian voice if one exists on this device.
      const voices = synth.getVoices();
      const fa = voices.find((v) => /fa[-_]?IR|persian|farsi/i.test(v.lang + ' ' + v.name));
      if (fa) u.voice = fa;
      synth.speak(u);
    } catch {
      /* TTS unavailable */
    }
  }

  /** Say a Persian line with fallback English (if user switches later). */
  sayFa(faLine: string, _enLine: string, priority = false): void {
    this.say(faLine, priority);
  }

  stopCommentary(): void {
    try {
      globalThis.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
  }

  suspend(): void {
    this.stopMusic();
    this.stopCommentary();
    void this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    await this.ctx?.resume();
  }

  dispose(): void {
    this.stopMusic();
    this.stopCommentary();
    try {
      this.crowdSource?.stop();
    } catch {
      /* noop */
    }
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
