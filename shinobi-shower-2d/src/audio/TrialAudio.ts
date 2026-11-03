const MAX_SPLASHES_PER_SECOND = 8;
const VOLUME = 0.35;

/** Fully synthesized: running water, drips that can be followed by ear, and the ring of the blade. */
export class TrialAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private bed!: GainNode;
  private rush!: GainNode;
  private muffle!: BiquadFilterNode;
  private splashBudget = 0;
  muted = false;

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
    this.muffle.frequency.value = 16000;
    this.muffle.connect(this.master);

    const reverb = ctx.createConvolver();
    const length = Math.ceil(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    reverb.connect(wet).connect(this.master);

    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    this.fx.connect(reverb);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noise(3);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2200;
    band.Q.value = 0.35;
    this.bed = ctx.createGain();
    this.bed.gain.value = 0.05;
    noise.connect(band).connect(this.bed).connect(this.muffle);

    const rushBand = ctx.createBiquadFilter();
    rushBand.type = 'highpass';
    rushBand.frequency.value = 800;
    this.rush = ctx.createGain();
    this.rush.gain.value = 0;
    noise.connect(rushBand).connect(this.rush).connect(this.master);
    noise.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  suspend(paused: boolean): void {
    if (this.ctx) void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  /** In steam the room goes quiet, which leaves the drips to steer by. */
  update(dt: number, speed: number, inSteam: boolean, timeScale: number): void {
    if (!this.ctx) return;
    this.splashBudget = Math.min(3, this.splashBudget + MAX_SPLASHES_PER_SECOND * dt);
    const now = this.ctx.currentTime;
    this.bed.gain.setTargetAtTime(inSteam ? 0.025 : 0.06, now, 0.25);
    this.rush.gain.setTargetAtTime(Math.min(0.07, Math.max(0, speed - 8) * 0.006), now, 0.08);
    this.muffle.frequency.setTargetAtTime(timeScale < 0.6 ? 700 : inSteam ? 2400 : 16000, now, 0.08);
  }

  private tone(from: number, to: number, length: number, gain: number, type: OscillatorType, pan = 0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + length);
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.connect(env).connect(panner).connect(this.fx);
    osc.start(now);
    osc.stop(now + length + 0.02);
  }

  private burst(length: number, gain: number, frequency: number, type: BiquadFilterType): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise(length);
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + length);
    src.connect(filter).connect(env).connect(this.fx);
    src.start(now);
  }

  private noise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** A drip on tile. The warning drip before a stream fires is higher and louder. */
  drip(pan: number, warning: boolean): void {
    if (warning) this.tone(2300, 1100, 0.09, 0.26, 'sine', pan);
    else this.tone(1250, 700, 0.07, 0.11, 'sine', pan);
  }

  slash(): void {
    this.burst(0.12, 0.2, 4200, 'highpass');
  }

  /** The glassy cut: high partials ringing over a tick of noise. */
  cleave(): void {
    this.tone(5200, 4700, 0.32, 0.12, 'sine');
    this.tone(7800, 7300, 0.2, 0.07, 'sine');
    this.burst(0.05, 0.25, 6000, 'highpass');
  }

  parry(): void {
    this.tone(1900, 1500, 0.3, 0.14, 'triangle');
    this.burst(0.2, 0.25, 2800, 'bandpass');
  }

  hit(): void {
    this.tone(210, 70, 0.3, 0.42, 'sine');
    this.burst(0.2, 0.3, 1400, 'lowpass');
  }

  splash(): void {
    if (this.splashBudget < 1) return;
    this.splashBudget -= 1;
    this.tone(1500 + Math.random() * 1400, 500, 0.06, 0.05, 'sine');
  }

  step(kind: 'jump' | 'land' | 'slide' | 'wall' | 'rail' | 'dash' | 'wire' | 'bounce', value = 1): void {
    switch (kind) {
      case 'jump': this.burst(0.07, 0.07, 1300, 'lowpass'); break;
      case 'land': this.tone(170, 70, 0.1, 0.12 + value * 0.2, 'sine'); break;
      case 'slide': this.burst(0.28, 0.14, 3600, 'bandpass'); break;
      case 'wall': this.burst(0.14, 0.09, 2300, 'bandpass'); break;
      case 'rail': this.tone(3100, 2500, 0.35, 0.08, 'sawtooth'); break;
      case 'dash': this.burst(0.2, 0.34, 2600, 'bandpass'); this.tone(2400, 900, 0.16, 0.12, 'sine'); break;
      case 'wire': this.tone(900, 2400, 0.13, 0.13, 'triangle'); break;
      case 'bounce': this.tone(190, 720, 0.2, 0.18, 'sine'); break;
    }
  }

  chime(): void {
    this.tone(880, 880, 0.5, 0.11, 'sine');
    this.tone(1320, 1320, 0.7, 0.08, 'sine');
  }
}
