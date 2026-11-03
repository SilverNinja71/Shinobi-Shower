import { HAIL_MAX_R, HAIL_MIN_R, SKY_HEIGHT, WORLD_WIDTH, makeDrop } from './DropletPhysics.ts';
import type { Drop, DropKind } from './DropletPhysics.ts';

export const WAVE_TIME = 18;
export const LULL_TIME = 3;

export interface Season {
  name: string;
  kinds: DropKind[];
  /** Typical wind in m/s, swung back and forth over the wave. */
  wind: number;
}

/** The first four waves teach one precipitation each, then they combine. */
export const SEASONS: Season[] = [
  { name: 'Drizzle', kinds: ['drizzle'], wind: 0.8 },
  { name: 'Rain', kinds: ['rain'], wind: 0.6 },
  { name: 'Snow', kinds: ['snow'], wind: 2.6 },
  { name: 'Hail', kinds: ['hail'], wind: 0.4 },
  { name: 'Monsoon', kinds: ['drizzle', 'rain'], wind: 1.2 },
  { name: 'Sleet', kinds: ['rain', 'snow'], wind: 2.2 },
  { name: 'Squall', kinds: ['rain', 'hail'], wind: 1.4 },
  { name: 'Blizzard', kinds: ['snow', 'hail'], wind: 3.4 },
  { name: 'Tempest', kinds: ['drizzle', 'rain', 'snow', 'hail'], wind: 2.4 },
];

export function seasonOf(wave: number): Season {
  if (wave <= SEASONS.length) return SEASONS[wave - 1];
  return SEASONS[4 + ((wave - SEASONS.length - 1) % (SEASONS.length - 4))];
}

/** How hard a wave hits: 1 for the first, then a little more every wave. */
export function intensityOf(wave: number): number {
  return 1 + 0.16 * (wave - 1);
}

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WeatherEvent {
  type: 'wave' | 'clear' | 'beat';
  value: number;
}

/** Runs the waves and drops new precipitation into the lane. */
export class WeatherSystem {
  wave = 1;
  /** Seconds into the current wave; negative during the lull before it. */
  t = -LULL_TIME;
  wind = 0;
  private time = 0;
  private acc: Record<DropKind, number> = { drizzle: 0, rain: 0, snow: 0, hail: 0 };
  private readonly rng: Rng;
  readonly events: WeatherEvent[] = [];

  constructor(seed = 1) {
    this.rng = mulberry32(seed);
  }

  get season(): Season {
    return seasonOf(this.wave);
  }

  get raining(): boolean {
    return this.t >= 0;
  }

  update(dt: number, drops: Drop[], ninjaX: number): void {
    this.time += dt;
    const before = this.t;
    this.t += dt;
    const season = this.season;
    this.wind = season.wind * Math.sin(this.time * 0.23) + season.wind * 0.35 * Math.sin(this.time * 0.71 + 1.3);
    if (before < 0 && this.t >= 0) this.events.push({ type: 'wave', value: this.wave });
    if (this.t >= WAVE_TIME) {
      this.events.push({ type: 'clear', value: this.wave });
      this.wave++;
      this.t = -LULL_TIME;
      this.acc = { drizzle: 0, rain: 0, snow: 0, hail: 0 };
      return;
    }
    if (this.t < 0) return;
    // Mixed waves split the load so a wave stays readable.
    const share = season.kinds.length === 1 ? 1 : season.kinds.length === 2 ? 0.65 : 0.45;
    const k = intensityOf(this.wave) * share;
    // The last two seconds of a wave thin out so its end is felt.
    const fade = this.t > WAVE_TIME - 2 ? 0.3 : 1;
    for (const kind of season.kinds) this.spawn(kind, dt, k * fade, drops, ninjaX);
  }

  private spawn(kind: DropKind, dt: number, k: number, drops: Drop[], ninjaX: number): void {
    const r = this.rng;
    // Spawn upwind so drifting drops still cover the lane.
    const upwind = (fall: number) => -this.wind * fall;
    switch (kind) {
      case 'drizzle': {
        this.acc.drizzle += dt * 32 * k;
        while (this.acc.drizzle >= 1) {
          this.acc.drizzle--;
          drops.push(makeDrop('drizzle', r() * (WORLD_WIDTH + 4) - 2 + upwind(0.6), SKY_HEIGHT + r() * 2));
        }
        break;
      }
      case 'rain': {
        // Rain comes in volleys on a steady beat, with gaps to slip through.
        const beat = 0.62 / Math.sqrt(k);
        this.acc.rain += dt;
        if (this.acc.rain >= beat) {
          this.acc.rain -= beat;
          this.events.push({ type: 'beat', value: 0 });
          const count = 3 + Math.floor(r() * 3 * Math.min(2, k));
          for (let i = 0; i < count; i++) {
            const lane = ((i + r() * 0.8) / count) * WORLD_WIDTH;
            drops.push(makeDrop('rain', lane, SKY_HEIGHT + r() * 0.6));
          }
        }
        break;
      }
      case 'snow': {
        this.acc.snow += dt * 6.5 * k;
        while (this.acc.snow >= 1) {
          this.acc.snow--;
          const flake = makeDrop('snow', r() * (WORLD_WIDTH + 6) - 3 + upwind(3), SKY_HEIGHT + r() * 3, 0.16 + r() * 0.08);
          flake.vx = this.wind;
          drops.push(flake);
        }
        break;
      }
      case 'hail': {
        const live = drops.filter((d) => d.kind === 'hail' && !d.dead).length;
        this.acc.hail += dt;
        const every = 1.7 / k;
        if (this.acc.hail >= every && live < 2 + Math.floor(this.wave / 4)) {
          this.acc.hail -= every;
          // Hail hunts: it falls near the ninja, never exactly on them.
          const x = Math.max(1, Math.min(WORLD_WIDTH - 1, ninjaX + (r() - 0.5) * 10));
          drops.push(makeDrop('hail', x, SKY_HEIGHT + 1, HAIL_MIN_R + r() * (HAIL_MAX_R - HAIL_MIN_R)));
        }
        break;
      }
    }
  }
}
