import type { DropKind } from './DropletPhysics.ts';

const VOLUME = 0.35;

/** Fully synthesized: a rain bed that swells with the weather, the shing of the blade, the clank of hail. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bed!: GainNode;
  private bedFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private budget = 0;
  muted = false;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : VOLUME;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.bedFilter = ctx.createBiquadFilter();
    this.bedFilter.type = 'lowpass';
    this.bedFilter.frequency.value = 1200;
    this.bed = ctx.createGain();
    this.bed.gain.value = 0;
    src.connect(this.bedFilter).connect(this.bed).connect(this.master);
    src.start();
  }

  suspend(on: boolean): void {
    if (!this.ctx) return;
    void (on ? this.ctx.suspend() : this.ctx.resume());
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, this.ctx.currentTime, 0.03);
    return this.muted;
  }

  /** The rain bed follows how much water is in the air; snow muffles it. */
  update(dt: number, dropCount: number, snowy: boolean): void {
    if (!this.ctx) return;
    this.budget = Math.min(6, this.budget + dt * 12);
    const t = this.ctx.currentTime;
    this.bed.gain.setTargetAtTime(Math.min(0.32, dropCount / 260), t, 0.4);
    this.bedFilter.frequency.setTargetAtTime(snowy ? 500 : 1500, t, 0.6);
  }

  private burst(freq: number, q: number, gain: number, decay: number, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + decay + 0.05);
  }

  private tone(freq: number, gain: number, decay: number, type: OscillatorType = 'sine', slide = 1): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  slash(flame: boolean): void {
    if (!this.ctx) return;
    this.burst(flame ? 2200 : 4200, 0.8, 0.35, 0.16, 'highpass');
    this.tone(flame ? 1500 : 2600, 0.05, 0.25, 'sine', 1.08);
  }

  slice(kind: DropKind): void {
    if (!this.ctx || this.budget < 1) return;
    this.budget--;
    if (kind === 'snow') this.burst(900, 1.2, 0.25, 0.12);
    else this.tone(kind === 'drizzle' ? 1900 : 1300, 0.06, 0.09, 'triangle', 0.6);
  }

  perfect(): void {
    if (!this.ctx) return;
    this.tone(180, 0.35, 0.3, 'sine', 0.5);
    this.tone(3100, 0.08, 0.6, 'sine');
    this.burst(2500, 3, 0.4, 0.25);
  }

  clang(): void {
    if (!this.ctx) return;
    this.tone(820, 0.08, 0.35, 'square', 0.98);
    this.tone(1237, 0.06, 0.3, 'square', 0.97);
  }

  steam(): void {
    if (!this.ctx || this.budget < 1) return;
    this.budget--;
    this.burst(6000, 0.5, 0.18, 0.35, 'highpass');
  }

  hit(kind: DropKind): void {
    if (!this.ctx) return;
    if (kind === 'hail') {
      this.tone(110, 0.5, 0.4, 'sine', 0.4);
      this.burst(300, 1, 0.5, 0.3);
    } else {
      this.burst(1100, 1.5, kind === 'drizzle' ? 0.08 : 0.3, 0.14);
    }
  }

  shatter(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) this.tone(1800 + i * 430, 0.05, 0.4 + i * 0.05, 'triangle', 0.7);
  }

  dash(): void {
    if (!this.ctx) return;
    this.burst(700, 0.7, 0.22, 0.2, 'lowpass');
  }

  splash(kind: DropKind): void {
    if (!this.ctx || kind !== 'hail') return;
    this.tone(70, 0.25, 0.25, 'sine', 0.6);
  }

  chime(up: boolean): void {
    if (!this.ctx) return;
    const notes = up ? [523, 659, 784, 1047] : [392, 523];
    notes.forEach((n, i) => setTimeout(() => this.ctx && this.tone(n, 0.08, 0.5, 'triangle'), i * 90));
  }

  focus(): void {
    if (!this.ctx) return;
    this.tone(90, 0.4, 1.2, 'sawtooth', 0.5);
    this.burst(3000, 0.4, 0.5, 0.9, 'highpass');
  }
}
