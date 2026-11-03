import { mulberry32 } from '../core/Rng.ts';
import type { DropKind } from '../weather/PrecipitationDroplet.ts';

/**
 * Paces the gauntlet. Each wave is longer than the last (30 s at wave 1, 90 s at 10, 180 s at 25,
 * 300 s from 50 on) and is built from weather fronts that cross-fade into each other. Early waves
 * teach one hazard each; later ones overlap them; from wave 50 rain and hail never let up.
 */

export const LULL_TIME = 5;
export const FADE_TIME = 3;
const ANCHORS: [number, number][] = [
  [1, 30],
  [10, 90],
  [25, 180],
  [50, 300],
];

/** Seconds of weather in a wave: exact at the anchors, linear between them, flat after 50. */
export function waveDuration(wave: number): number {
  if (wave <= ANCHORS[0][0]) return ANCHORS[0][1];
  for (let i = 1; i < ANCHORS.length; i++) {
    const [w1, d1] = ANCHORS[i];
    if (wave <= w1) {
      const [w0, d0] = ANCHORS[i - 1];
      return d0 + ((d1 - d0) * (wave - w0)) / (w1 - w0);
    }
  }
  return ANCHORS[ANCHORS.length - 1][1];
}

/** How hard a wave hits. */
export function intensityOf(wave: number): number {
  return Math.min(5, 1 + 0.09 * (wave - 1));
}

export interface Front {
  name: string;
  kinds: DropKind[];
  start: number;
  end: number;
  strength: number;
}

const SINGLE: Record<DropKind, string> = { drizzle: 'Mist', rain: 'Deluge', snow: 'Snowfall', hail: 'Hailstorm' };
const COMBOS: { name: string; kinds: DropKind[]; from: number }[] = [
  { name: 'Deluge', kinds: ['rain'], from: 5 },
  { name: 'Snowfall', kinds: ['snow'], from: 5 },
  { name: 'Hailstorm', kinds: ['hail'], from: 5 },
  { name: 'Mist', kinds: ['drizzle'], from: 5 },
  { name: 'Monsoon', kinds: ['drizzle', 'rain'], from: 5 },
  { name: 'Sleet', kinds: ['rain', 'snow'], from: 6 },
  { name: 'Squall', kinds: ['rain', 'hail'], from: 7 },
  { name: 'Whiteout', kinds: ['drizzle', 'snow'], from: 8 },
  { name: 'Blizzard', kinds: ['snow', 'hail'], from: 9 },
  { name: 'Tempest', kinds: ['drizzle', 'rain', 'snow', 'hail'], from: 12 },
];

/** Builds the fronts for a wave, the same way every time for the same seed. */
export function planWave(wave: number, seed: number): Front[] {
  const duration = waveDuration(wave);
  if (wave <= 4) {
    const kind = (['drizzle', 'rain', 'snow', 'hail'] as const)[wave - 1];
    return [{ name: SINGLE[kind], kinds: [kind], start: 0, end: duration, strength: 1 }];
  }
  const rng = mulberry32(seed * 7919 + wave * 104729);
  const count = Math.max(2, Math.min(8, Math.round(duration / 35)));
  const span = duration / count;
  const pool = COMBOS.filter((c) => wave >= c.from);
  const fronts: Front[] = [];
  let last = '';
  for (let i = 0; i < count; i++) {
    let pick = pool[Math.floor(rng() * pool.length)];
    // Never the same front twice in a row.
    for (let tries = 0; pick.name === last && tries < 8; tries++) pick = pool[Math.floor(rng() * pool.length)];
    last = pick.name;
    fronts.push({
      name: pick.name,
      kinds: [...pick.kinds],
      start: Math.max(0, i * span - FADE_TIME / 2),
      end: Math.min(duration, (i + 1) * span + FADE_TIME / 2),
      strength: pick.kinds.length === 1 ? 1 : pick.kinds.length === 2 ? 0.75 : 0.55,
    });
  }
  // From wave 25 a second storm layer runs under the fronts; from 50 it is rain and hail, nonstop.
  if (wave >= 50) {
    fronts.push({ name: 'Endless Squall', kinds: ['rain', 'hail'], start: 0, end: duration, strength: 0.55 });
  } else if (wave >= 25) {
    const kind: DropKind = rng() < 0.5 ? 'rain' : 'hail';
    fronts.push({ name: kind === 'rain' ? 'Undertow' : 'Barrage', kinds: [kind], start: 0, end: duration, strength: 0.35 });
  }
  return fronts;
}

/** 0 outside the front, 1 inside it, with linear fades at each end (except at the wave's own edges). */
export function envelope(f: Front, t: number, duration: number): number {
  if (t < f.start || t > f.end) return 0;
  const fadeIn = f.start <= 0 ? 1 : Math.min(1, (t - f.start) / FADE_TIME);
  const fadeOut = f.end >= duration ? 1 : Math.min(1, (f.end - t) / FADE_TIME);
  return Math.min(fadeIn, fadeOut);
}

export type WaveEvent =
  | { type: 'wave'; wave: number; duration: number; name: string }
  | { type: 'front'; name: string }
  | { type: 'clear'; wave: number };

export class WaveDirector {
  wave = 1;
  /** Seconds into the current wave; negative during the lull before it. */
  t = -LULL_TIME;
  duration = waveDuration(1);
  fronts: Front[];
  readonly seed: number;
  readonly events: WaveEvent[] = [];
  /** Weight of each kind right now (0 during the lull). */
  readonly weights: Record<DropKind, number> = { drizzle: 0, rain: 0, snow: 0, hail: 0 };
  private frontName = '';

  constructor(seed: number) {
    this.seed = seed;
    this.fronts = planWave(1, seed);
  }

  get raging(): boolean {
    return this.t >= 0;
  }

  get intensity(): number {
    return intensityOf(this.wave);
  }

  /** The strongest front right now, for the HUD. */
  get frontNow(): string {
    if (this.t < 0) return '';
    let best = '';
    let bestW = 0;
    for (const f of this.fronts) {
      if (f.name === 'Undertow' || f.name === 'Barrage' || f.name === 'Endless Squall') continue;
      const w = envelope(f, this.t, this.duration);
      if (w > bestW) {
        bestW = w;
        best = f.name;
      }
    }
    return best;
  }

  /** Name for the wave as a whole: its fronts in order. */
  get title(): string {
    const names = this.fronts.filter((f) => !['Undertow', 'Barrage', 'Endless Squall'].includes(f.name)).map((f) => f.name);
    return names.length > 3 ? `${names.slice(0, 3).join(' · ')} …` : names.join(' · ');
  }

  update(dt: number): void {
    const before = this.t;
    this.t += dt;
    if (before < 0 && this.t >= 0) {
      this.events.push({ type: 'wave', wave: this.wave, duration: this.duration, name: this.title });
      this.frontName = '';
    }
    if (this.t >= this.duration) {
      this.events.push({ type: 'clear', wave: this.wave });
      this.wave++;
      this.duration = waveDuration(this.wave);
      this.fronts = planWave(this.wave, this.seed);
      this.t = -LULL_TIME;
    }
    for (const k of ['drizzle', 'rain', 'snow', 'hail'] as const) this.weights[k] = 0;
    if (this.t < 0) return;
    for (const f of this.fronts) {
      const w = envelope(f, this.t, this.duration) * f.strength;
      if (w <= 0) continue;
      for (const k of f.kinds) this.weights[k] += w;
    }
    const now = this.frontNow;
    if (now && now !== this.frontName) {
      if (this.frontName) this.events.push({ type: 'front', name: now });
      this.frontName = now;
    }
  }
}
