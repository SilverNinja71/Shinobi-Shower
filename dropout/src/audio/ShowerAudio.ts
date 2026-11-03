const MAX_PLINKS_PER_SECOND = 22;
const VOLUME = 0.35;

/** Everything is synthesized: a filtered noise bed for the water, plinks and thuds on tile, and a generated room reverb. */
export class ShowerAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private fx!: GainNode;
  private bed!: GainNode;
  private hiss!: GainNode;
  private plinkBudget = 0;
  muted = false;

  /** Browsers only allow sound after a click, so this is called from the Start button. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AudioCtor = window.AudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : VOLUME;
    this.master.connect(ctx.destination);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.connect(this.master);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.roomImpulse(ctx, 1.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    reverb.connect(wet).connect(this.muffle);

    this.fx = ctx.createGain();
    this.fx.connect(this.muffle);
    this.fx.connect(reverb);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 3);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600;
    band.Q.value = 0.4;
    this.bed = ctx.createGain();
    this.bed.gain.value = 0.05;
    noise.connect(band).connect(this.bed).connect(this.muffle);
    this.bed.connect(reverb);

    const hissBand = ctx.createBiquadFilter();
    hissBand.type = 'highpass';
    hissBand.frequency.value = 5200;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    noise.connect(hissBand).connect(this.hiss).connect(this.muffle);
    noise.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  pause(paused: boolean): void {
    if (!this.ctx) return;
    void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  /** Pressure drives the water bed, skid drives the hiss, and sogginess muffles the room. */
  update(dt: number, pressure: number, skid: number, moisture: number): void {
    if (!this.ctx) return;
    this.plinkBudget = Math.min(6, this.plinkBudget + MAX_PLINKS_PER_SECOND * dt);
    const now = this.ctx.currentTime;
    this.bed.gain.setTargetAtTime(0.04 + pressure * 0.09, now, 0.3);
    this.hiss.gain.setTargetAtTime(Math.min(0.1, skid * 0.012), now, 0.05);
    const cutoff = 18000 * Math.pow(1 - Math.min(1, moisture / 100) * 0.9, 2) + 500;
    this.muffle.frequency.setTargetAtTime(cutoff, now, 0.2);
  }

  plink(size: number): void {
    if (!this.ctx || this.plinkBudget < 1) return;
    this.plinkBudget -= 1;
    const pitch = 3400 - size * 12000 + Math.random() * 1400;
    this.tone(pitch, pitch * 0.55, 0.05, 0.05 + Math.random() * 0.05, 'sine');
  }

  thud(gain = 0.5): void {
    this.tone(150, 42, 0.32, gain, 'sine');
    this.burst(0.09, gain * 0.4, 1200);
  }

  whoosh(): void {
    this.burst(0.18, 0.2, 3200);
  }

  blip(from: number, to: number, gain = 0.12): void {
    this.tone(from, to, 0.13, gain, 'triangle');
  }

  private tone(from: number, to: number, length: number, gain: number, type: OscillatorType): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + length);
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.connect(env).connect(this.fx);
    osc.start(now);
    osc.stop(now + length + 0.02);
  }

  private burst(length: number, gain: number, cutoff: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(this.ctx, length);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + length);
    src.connect(filter).connect(env).connect(this.fx);
    src.start(now);
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Decaying noise with bright early reflections: a small room with hard walls. */
  private roomImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.ceil(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
      }
    }
    return buffer;
  }
}
