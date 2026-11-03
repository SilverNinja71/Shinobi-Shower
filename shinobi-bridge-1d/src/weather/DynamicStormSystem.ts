import { clamp, mulberry32, range } from '../core/Rng.ts';
import type { Rng } from '../core/Rng.ts';
import { HAIL_MAX_R, HAIL_MIN_R, makeDrop } from './PrecipitationDroplet.ts';
import type { Drop, DropKind } from './PrecipitationDroplet.ts';

/**
 * Spawns the weather and drives the wind.
 *
 * The crosswind is a sum of slow sines, so it builds, eases and swings from one side to the other.
 * Rain never falls straight: it comes in at 35° to 60° from vertical depending on the wind, at
 * 34–42 m/s, as a light steady fall plus dense curtains that sweep along the bridge. Mist drifts
 * in a fine haze, snow rides the wind, and hail is aimed near the warrior.
 */

/** Height drops are spawned at, above the anchors. */
export const SPAWN_Y = 15;
export const RAIN_MIN_ANGLE = (35 * Math.PI) / 180;
export const RAIN_MAX_ANGLE = (60 * Math.PI) / 180;
/** Wind speed at which rain reaches its steepest slant. */
const WIND_FOR_MAX_ANGLE = 7;

export interface Curtain {
  id: number;
  /** Centre of the curtain's footprint on the deck. */
  center: number;
  /** How fast the footprint sweeps along the lane (signed). */
  speed: number;
  width: number;
  /** Drops per second per metre of footprint. */
  flux: number;
  age: number;
  life: number;
}

export type StormEvent = { type: 'curtain'; dir: number; center: number } | { type: 'lightning'; x: number; power: number };

export class DynamicStormSystem {
  readonly drops: Drop[] = [];
  readonly curtains: Curtain[] = [];
  readonly events: StormEvent[] = [];
  /** Crosswind in m/s, positive blows toward +x. */
  wind = 0;
  /** Which way rain is slanting: +1 falls toward +x. Holds its sign through calm moments. */
  rainDir = 1;
  /** Rain angle from vertical, radians. */
  rainAngle = RAIN_MIN_ANGLE;
  rainSpeed = 36;
  /** 0–1: how thick the mist is right now. Drives the fogged lens. */
  mist = 0;
  time = 0;
  private readonly rng: Rng;
  private readonly phase: number[];
  private acc: Record<DropKind, number> = { drizzle: 0, rain: 0, snow: 0, hail: 0 };
  private nextCurtain = 2.5;
  private nextLightning = 6;
  private curtainId = 1;
  readonly length: number;

  constructor(seed: number, length: number) {
    this.rng = mulberry32(seed ^ 0x5eed);
    this.phase = [this.rng() * 6.28, this.rng() * 6.28, this.rng() * 6.28];
    this.length = length;
  }

  /** Wind amplitude for the current mix: rain and snow bring the strongest crosswinds. */
  private windAmplitude(w: Record<DropKind, number>): number {
    return 1.5 + 4.5 * Math.min(1, w.rain) + 3.5 * Math.min(1, w.snow) + 1 * Math.min(1, w.hail);
  }

  /** Rain velocity for the current wind. */
  rainVelocity(): { vx: number; vy: number } {
    return { vx: this.rainDir * this.rainSpeed * Math.sin(this.rainAngle), vy: -this.rainSpeed * Math.cos(this.rainAngle) };
  }

  update(dt: number, weights: Record<DropKind, number>, intensity: number, warriorX: number): void {
    this.time += dt;
    const t = this.time;
    const amp = this.windAmplitude(weights);
    const target =
      amp * (0.72 * Math.sin(t * 0.19 + this.phase[0]) + 0.38 * Math.sin(t * 0.53 + this.phase[1]) + 0.12 * Math.sin(t * 1.7 + this.phase[2]));
    this.wind += (target - this.wind) * Math.min(1, dt * 1.5);
    if (Math.abs(this.wind) > 0.6) this.rainDir = Math.sign(this.wind);
    this.rainAngle = RAIN_MIN_ANGLE + (RAIN_MAX_ANGLE - RAIN_MIN_ANGLE) * clamp(Math.abs(this.wind) / WIND_FOR_MAX_ANGLE, 0, 1);
    this.rainSpeed = 34 + 8 * clamp((intensity - 1) / 3, 0, 1);
    this.mist += (clamp(weights.drizzle * (0.7 + 0.15 * intensity), 0, 1) - this.mist) * Math.min(1, dt * 0.6);

    const k = intensity;
    if (weights.drizzle > 0) this.spawnDrizzle(dt, weights.drizzle * k);
    if (weights.rain > 0) this.spawnRain(dt, weights.rain, k, warriorX);
    else this.curtains.length = 0;
    if (weights.snow > 0) this.spawnSnow(dt, weights.snow * k);
    if (weights.hail > 0) this.spawnHail(dt, weights.hail * k, warriorX, k);

    const storminess = weights.rain + weights.hail + 0.3 * weights.snow;
    if (storminess > 0.05) {
      this.nextLightning -= dt * storminess * (0.8 + 0.25 * k);
      if (this.nextLightning <= 0) {
        this.nextLightning = range(this.rng, 4, 14);
        this.events.push({ type: 'lightning', x: range(this.rng, -50, this.length + 50), power: range(this.rng, 0.35, 1) });
      }
    }
  }

  /** Where a drop with this velocity must start so it reaches deck height (about y = 0) at x. */
  private startFor(xLand: number, vx: number, vy: number): number {
    return xLand - vx * (SPAWN_Y / -vy);
  }

  private spawnDrizzle(dt: number, k: number): void {
    const r = this.rng;
    this.acc.drizzle += dt * 1.25 * this.length * k;
    const vy = -4.5;
    const vx = this.wind * 0.8;
    while (this.acc.drizzle >= 1) {
      this.acc.drizzle--;
      const land = range(r, -2, this.length + 2);
      const y = SPAWN_Y - r() * 3;
      this.drops.push(makeDrop('drizzle', this.startFor(land, vx, vy), y, vx, vy, undefined, range(r, -0.7, 0.7)));
    }
  }

  private spawnRain(dt: number, weight: number, k: number, warriorX: number): void {
    const r = this.rng;
    const { vx, vy } = this.rainVelocity();
    // A light, steady slanting fall everywhere.
    this.acc.rain += dt * 0.22 * this.length * weight * Math.sqrt(k);
    while (this.acc.rain >= 1) {
      this.acc.rain--;
      this.pushRain(range(r, -1, this.length + 1), vx, vy);
    }
    // Curtains: dense sheets that sweep along the lane, aimed to cross the warrior.
    this.nextCurtain -= dt * weight * Math.sqrt(k);
    if (this.nextCurtain <= 0) {
      this.nextCurtain = range(r, 3, 5.5);
      const speed = this.rainDir * range(r, 2.5, 5);
      const travel = range(r, 12, 22);
      const curtain: Curtain = {
        id: this.curtainId++,
        center: warriorX - this.rainDir * range(r, 5, 10),
        speed,
        width: range(r, 4, 7),
        flux: 4.5 * Math.min(2.2, Math.sqrt(k)),
        age: 0,
        life: travel / Math.abs(speed),
      };
      this.curtains.push(curtain);
      this.events.push({ type: 'curtain', dir: this.rainDir, center: curtain.center });
    }
    for (let i = this.curtains.length - 1; i >= 0; i--) {
      const c = this.curtains[i];
      c.age += dt;
      c.center += c.speed * dt;
      if (c.age >= c.life) {
        this.curtains.splice(i, 1);
        continue;
      }
      // Sheets thicken as they arrive and thin as they pass.
      const swell = Math.min(1, c.age / 0.6, (c.life - c.age) / 0.6);
      const n = c.flux * c.width * weight * swell * dt;
      let count = Math.floor(n);
      if (r() < n - count) count++;
      for (let j = 0; j < count; j++) this.pushRain(c.center + (r() - 0.5) * c.width, vx, vy);
    }
  }

  private pushRain(xLand: number, vx: number, vy: number): void {
    const r = this.rng;
    const y = SPAWN_Y + r() * 2;
    // Each drop's speed varies a little, which breaks the sheet into streaks.
    const s = 0.92 + r() * 0.16;
    this.drops.push(makeDrop('rain', this.startFor(xLand, vx, vy), y, vx * s, vy * s, undefined, range(r, -0.75, 0.75)));
  }

  private spawnSnow(dt: number, k: number): void {
    const r = this.rng;
    this.acc.snow += dt * 0.38 * this.length * k;
    while (this.acc.snow >= 1) {
      this.acc.snow--;
      // Spawn upwind so drift still carries the flakes over the bridge.
      const land = range(r, -1, this.length + 1);
      const x = land - this.wind * (SPAWN_Y / 2.6) * 0.8;
      const flake = makeDrop('snow', x, SPAWN_Y + r() * 3, this.wind, range(r, -3, -2.2), 0.12 + r() * 0.08, range(r, -0.5, 0.5));
      this.drops.push(flake);
    }
  }

  private spawnHail(dt: number, k: number, warriorX: number, intensity: number): void {
    const r = this.rng;
    const live = this.drops.filter((d) => d.kind === 'hail' && !d.dead).length;
    this.acc.hail += dt * k;
    const every = 1.8;
    if (this.acc.hail >= every && live < 2 + Math.floor(intensity)) {
      this.acc.hail -= every;
      // Hail hunts: it falls near the warrior but not on top of them.
      const x = clamp(warriorX + (r() - 0.5) * 12, 0.5, this.length - 0.5);
      const size = HAIL_MIN_R + r() * (HAIL_MAX_R - HAIL_MIN_R);
      this.drops.push(makeDrop('hail', x, SPAWN_Y + 1, range(r, -0.4, 0.4), -2, size, range(r, -0.2, 0.2)));
    }
  }

  reset(): void {
    this.drops.length = 0;
    this.curtains.length = 0;
    this.events.length = 0;
    this.acc = { drizzle: 0, rain: 0, snow: 0, hail: 0 };
    this.mist = 0;
  }
}
