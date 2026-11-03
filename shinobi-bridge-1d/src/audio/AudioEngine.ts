import type { Game, GameEvent } from '../core/Game.ts';
import type { DropKind } from '../weather/PrecipitationDroplet.ts';

const VOLUME = 0.35;
const SPEED_OF_SOUND = 343;

/**
 * Every sound is synthesized. A storm bed (rain that swells as curtains pass, mist hiss, a wind that
 * howls with the crosswind, all muffled under snow), thunder that arrives after each flash at the
 * speed of sound, a bridge that creaks and groans as it sways, and one-shots for the blade, ice,
 * wood and snow. Starts only from a user gesture; master volume 0.35.
 */
export class AudioEngine {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private muffle!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private rain!: GainNode;
  private rainTone!: BiquadFilterNode;
  private mist!: GainNode;
  private wind!: GainNode;
  private windTone!: BiquadFilterNode;
  /** Small budget of cheap one-shots per second (cut ticks, splashes), so a curtain doesn't drown the mix. */
  private budget = 0;
  private lastEnergy = 0;
  private creakCooldown = 0;

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
    // Snow wraps the whole mix in a low-pass.
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.connect(this.master);
    this.fx = ctx.createGain();
    this.fx.connect(this.muffle);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const white = this.noise.getChannelData(0);
    for (let i = 0; i < white.length; i++) white[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const brown = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < brown.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      brown[i] = last * 3.5;
    }

    const loop = (buffer: AudioBuffer, filter: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.muffle);
      src.start(0, Math.random() * 1.5);
      return { gain: g, filter: f };
    };
    ({ gain: this.rain, filter: this.rainTone } = loop(this.noise, 'lowpass', 2400, 0.4));
    ({ gain: this.mist } = loop(this.noise, 'highpass', 5200, 0.3));
    ({ gain: this.wind, filter: this.windTone } = loop(this.brown, 'bandpass', 420, 2.2));
  }

  suspend(on: boolean): void {
    if (!this.ctx) return;
    void (on ? this.ctx.suspend() : this.ctx.resume());
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, this.ctx.currentTime, 0.04);
    return this.muted;
  }

  update(dt: number, game: Game): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.budget = Math.min(8, this.budget + dt * 14);
    const w = game.waves.weights;
    const wx = game.warrior.x;
    // A curtain swells the rain as it sweeps over the warrior.
    let curtain = 0;
    for (const c of game.storm.curtains) curtain = Math.max(curtain, 1 - Math.min(1, Math.abs(c.center - wx) / (c.width * 1.5 + 4)));
    this.rain.gain.setTargetAtTime(Math.min(0.5, w.rain * 0.22 + curtain * 0.28 * Math.min(1, w.rain * 2)), t, 0.25);
    this.rainTone.frequency.setTargetAtTime(1800 + curtain * 2600, t, 0.3);
    this.mist.gain.setTargetAtTime(Math.min(0.12, game.storm.mist * 0.12), t, 0.6);
    const gust = Math.min(1, Math.abs(game.storm.wind) / 8);
    this.wind.gain.setTargetAtTime(0.03 + gust * 0.2, t, 0.5);
    this.windTone.frequency.setTargetAtTime(260 + gust * 520 + Math.sin(t * 0.7) * 60, t, 0.4);
    this.muffle.frequency.setTargetAtTime(18000 - Math.min(1, w.snow) * 14000, t, 0.8);

    // The bridge creaks when its sway picks up, and groans while it rings.
    const e = game.bridge.energy;
    this.creakCooldown = Math.max(0, this.creakCooldown - dt);
    if (e - this.lastEnergy > 0.004 && this.creakCooldown === 0) {
      this.creak(Math.min(1, (e - this.lastEnergy) * 60));
      this.creakCooldown = 0.35;
    } else if (e > 0.02 && this.creakCooldown === 0 && Math.random() < dt * 0.6) {
      this.creak(Math.min(0.6, e * 4));
      this.creakCooldown = 1.2;
    }
    this.lastEnergy = e;
  }

  /* ---------------- building blocks ---------------- */

  private burst(freq: number, q: number, gain: number, decay: number, type: BiquadFilterType = 'bandpass', delay = 0, buffer = this.noise): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.fx);
    src.start(t, Math.random() * 1.2);
    src.stop(t + decay + 0.05);
  }

  private tone(freq: number, gain: number, decay: number, type: OscillatorType = 'sine', slide = 1, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.fx);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private creak(strength: number): void {
    if (!this.ctx) return;
    // Wood on rope: a resonant, slowly bending squeal under a soft rasp.
    const base = 180 + Math.random() * 140;
    this.tone(base, 0.025 + strength * 0.05, 0.35 + strength * 0.4, 'sawtooth', 0.82 + Math.random() * 0.1);
    this.burst(base * 3, 6, 0.03 + strength * 0.05, 0.3, 'bandpass');
  }

  private thunder(distance: number, power: number): void {
    const delay = Math.min(3, Math.max(0.2, distance / SPEED_OF_SOUND));
    const near = delay < 0.8;
    if (near) {
      this.burst(2400, 0.6, 0.35 * power, 0.25, 'highpass', delay);
      this.tone(70, 0.3 * power, 0.4, 'square', 0.5, delay);
    }
    this.burst(90, 0.7, (near ? 0.7 : 0.45) * power, 2.6 + power * 1.6, 'lowpass', delay + 0.05, this.brown);
    this.burst(160, 0.9, 0.25 * power, 1.8, 'lowpass', delay + 0.5, this.brown);
  }

  /* ---------------- events ---------------- */

  handleEvent(e: GameEvent, game: Game): void {
    if (!this.ctx) return;
    const s = game.stance;
    switch (e.type) {
      case 'slash':
        if (e.side !== game.katana.facing) break; // one sound for both blades of a triple cut
        this.burst(s.flame ? 2300 : 4200, 0.7, 0.32, 0.18, 'highpass');
        this.tone(s.tier >= 5 ? 1900 : 2700, 0.045, 0.35, 'sine', 1.06);
        if (s.flame) this.burst(900, 0.8, 0.12, 0.3, 'bandpass');
        if (s.tier >= 5) this.tone(110, 0.08, 0.18, 'sawtooth', 3.2);
        break;
      case 'cut':
        if (this.budget < 1) break;
        this.budget--;
        if (e.kind === 'snow') this.burst(800, 1.2, 0.16, 0.12);
        else this.tone(e.kind === 'drizzle' ? 2100 : 1500, 0.035, 0.08, 'triangle', 0.6);
        break;
      case 'perfect':
        this.tone(160, 0.35, 0.35, 'sine', 0.45);
        this.burst(5200, 2, 0.4, 0.3, 'bandpass');
        this.tone(3300, 0.07, 0.7, 'sine');
        break;
      case 'clang':
        this.tone(820, 0.08, 0.4, 'square', 0.98);
        this.tone(1237, 0.06, 0.32, 'square', 0.97);
        break;
      case 'steam':
        if (this.budget < 1) break;
        this.budget--;
        this.burst(6000, 0.4, 0.14, 0.35, 'highpass');
        break;
      case 'melt':
        this.burst(5000, 0.4, 0.25, 0.7, 'highpass');
        break;
      case 'hit':
        if (e.kind === 'hail') {
          this.tone(90, 0.5, 0.5, 'sine', 0.4);
          this.burst(300, 1, 0.45, 0.35);
        } else {
          this.hitSplash(e.kind);
        }
        break;
      case 'shatter':
        for (let i = 0; i < 4; i++) this.tone(1700 + i * 470, 0.05, 0.45 + i * 0.05, 'triangle', 0.7);
        break;
      case 'reform':
        this.tone(880, 0.04, 0.6, 'sine', 1.5);
        break;
      case 'land':
        if (e.kind === 'hail') {
          this.tone(70, 0.3, 0.35, 'sine', 0.55);
          this.burst(600, 1.4, 0.25, 0.18);
        }
        break;
      case 'plank':
        // Splintering wood: a sharp snap, then a rattle of fibres.
        this.burst(2600, 1.5, e.damage === 'break' ? 0.5 : 0.28, 0.08, 'bandpass');
        this.burst(900, 2.5, e.damage === 'break' ? 0.3 : 0.15, 0.25, 'bandpass', 0.03);
        if (e.damage === 'break') this.tone(140, 0.2, 0.3, 'sawtooth', 0.6, 0.02);
        break;
      case 'dash':
        this.burst(700, 0.7, 0.2, 0.22, 'lowpass');
        break;
      case 'kick':
        this.burst(320, 0.8, e.area > 0 ? 0.35 : 0.15, 0.22, 'lowpass');
        if (e.area > 0) this.burst(1800, 0.6, 0.1, 0.3, 'highpass', 0.05);
        break;
      case 'stumble':
        this.burst(400, 1, 0.25, 0.2, 'lowpass');
        break;
      case 'lightning':
        this.thunder(Math.abs(e.x - game.warrior.x) * 6 + 120, e.power);
        break;
      case 'wave':
        // A deep taiko strike to open each wave.
        this.tone(64, 0.6, 1.1, 'sine', 0.6);
        this.burst(180, 1, 0.3, 0.4, 'lowpass');
        break;
      case 'clear':
        [392, 523, 659].forEach((n, i) => this.tone(n, 0.06, 0.8, 'triangle', 1, i * 0.12));
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((n, i) => this.tone(n, 0.07, 0.6, 'triangle', 1, i * 0.09));
        break;
      case 'focus':
        this.tone(80, 0.45, 1.3, 'sawtooth', 0.5);
        this.burst(3200, 0.4, 0.5, 1.0, 'highpass');
        break;
      case 'over':
        this.tone(110, 0.3, 2.2, 'sine', 0.5);
        break;
      default:
        break;
    }
  }

  private hitSplash(kind: DropKind): void {
    if (kind === 'drizzle' && this.budget < 1) return;
    if (kind === 'drizzle') this.budget--;
    this.burst(kind === 'snow' ? 700 : 1200, 1.4, kind === 'drizzle' ? 0.06 : 0.24, 0.15);
  }
}
