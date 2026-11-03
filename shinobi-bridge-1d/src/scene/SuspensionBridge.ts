/**
 * The rope bridge as a physical object: its sagging rest shape, three vertical sway modes, a lateral
 * swing and a twisting roll, each a damped spring. Hail, dashes and the warrior's own weight push
 * on the modes; the wind swings it. Each plank keeps its own health, and hail splits them.
 *
 * Lane coordinates: x from 0 (west anchor) to BRIDGE_LENGTH (east anchor); the deck sits at y = 0
 * at both anchors and sags toward the middle.
 */

export const BRIDGE_LENGTH = 36;
export const SAG = 1.6;
export const PLANK_PITCH = 0.3;
export const PLANK_WIDTH = 0.24;
export const PLANK_COUNT = Math.round(BRIDGE_LENGTH / PLANK_PITCH);
export const PLANK_HEALTH = 4;
export const DECK_HALF_WIDTH = 0.8;
/** The warrior keeps this far from either anchor post. */
export const LANE_MARGIN = 1.0;

/** Natural frequencies (Hz) and damping ratios. A rotting bridge rings for a long time. */
const VERTICAL_HZ = [0.55, 0.95, 1.4];
const VERTICAL_ZETA = 0.07;
const LATERAL_HZ = 0.34;
const LATERAL_ZETA = 0.05;
const ROLL_HZ = [0.6, 1.05];
const ROLL_ZETA = 0.06;
/** Modal force of the warrior's weight: about 0.18 m of extra sag under them at midspan. */
const WEIGHT = 0.18 * (2 * Math.PI * VERTICAL_HZ[0]) ** 2;

export interface Plank {
  index: number;
  /** Centre along the lane. */
  x: number;
  health: number;
  broken: boolean;
  /** Seconds since it broke, for the falling animation. */
  brokenAge: number;
}

export type PlankDamage = 'crack' | 'break' | null;

const shape = (k: number, x: number) => Math.sin(((k + 1) * Math.PI * x) / BRIDGE_LENGTH);
const shapeSlope = (k: number, x: number) =>
  (((k + 1) * Math.PI) / BRIDGE_LENGTH) * Math.cos(((k + 1) * Math.PI * x) / BRIDGE_LENGTH);

export class SuspensionBridge {
  /** Vertical modal displacement (m) and velocity. */
  readonly a = [0, 0, 0];
  readonly av = [0, 0, 0];
  /** Lateral (towards/away from the camera) swing. */
  lateralA = 0;
  lateralV = 0;
  /** Roll modes, in radians. */
  readonly roll = [0, 0];
  readonly rollV = [0, 0];
  time = 0;
  readonly planks: Plank[] = [];

  constructor() {
    for (let i = 0; i < PLANK_COUNT; i++) {
      this.planks.push({ index: i, x: (i + 0.5) * PLANK_PITCH, health: PLANK_HEALTH, broken: false, brokenAge: 0 });
    }
  }

  restY(x: number): number {
    const u = (2 * x) / BRIDGE_LENGTH - 1;
    return -SAG * (1 - u * u);
  }

  /** Height of the deck surface at x, including sway. */
  deckY(x: number): number {
    let y = this.restY(x);
    for (let k = 0; k < 3; k++) y += this.a[k] * shape(k, x);
    return y;
  }

  /** dy/dx of the deck: positive means the deck rises toward +x. */
  slope(x: number): number {
    const u = (2 * x) / BRIDGE_LENGTH - 1;
    let s = (4 * SAG * u) / BRIDGE_LENGTH;
    for (let k = 0; k < 3; k++) s += this.a[k] * shapeSlope(k, x);
    return s;
  }

  /** Pitch angle of the deck at x, in radians. */
  pitch(x: number): number {
    return Math.atan(this.slope(x));
  }

  /** Twist of the deck about the lane, in radians. */
  rollAt(x: number): number {
    return this.roll[0] * shape(0, x) + this.roll[1] * shape(1, x);
  }

  /** Lateral offset of the deck at x (positive is toward the camera). */
  lateral(x: number): number {
    return this.lateralA * shape(0, x);
  }

  /** A sudden vertical blow at x: hail landing, a dash pushing off. Positive pushes the deck down. */
  impulse(x: number, strength: number): void {
    if (x < 0 || x > BRIDGE_LENGTH) return;
    for (let k = 0; k < 3; k++) this.av[k] -= (strength * shape(k, x)) / (k + 1);
    // Anything off the centreline also twists the deck a little.
    for (let k = 0; k < 2; k++) this.rollV[k] += strength * 0.06 * shape(k, x) * (k === 0 ? 1 : -0.6);
  }

  /** A sideways shove (gusts). */
  shove(strength: number): void {
    this.lateralV += strength;
    this.rollV[0] += strength * 0.05;
  }

  /**
   * Advances the springs. `wind` is the crosswind in m/s; `loadX` is where the warrior stands, or null.
   * The ambient sway follows a slow sine so even a calm bridge never quite rests.
   */
  update(dt: number, wind: number, loadX: number | null): void {
    this.time += dt;
    const ambient = Math.sin(this.time * 2 * Math.PI * 0.21) * 0.012;
    for (let k = 0; k < 3; k++) {
      const w = 2 * Math.PI * VERTICAL_HZ[k];
      let force = -w * w * this.a[k] - 2 * VERTICAL_ZETA * w * this.av[k];
      if (loadX !== null) force -= WEIGHT * shape(k, loadX);
      this.av[k] += force * dt;
      this.a[k] += this.av[k] * dt;
    }
    {
      const w = 2 * Math.PI * LATERAL_HZ;
      const push = wind * 0.035 + Math.sin(this.time * 2 * Math.PI * LATERAL_HZ * 0.97) * Math.min(0.06, Math.abs(wind) * 0.01);
      this.lateralV += (-w * w * this.lateralA - 2 * LATERAL_ZETA * w * this.lateralV + push) * dt;
      this.lateralA += this.lateralV * dt;
    }
    for (let k = 0; k < 2; k++) {
      const w = 2 * Math.PI * ROLL_HZ[k];
      const push = k === 0 ? (wind * 0.004 + ambient) * w * w * 0.2 : 0;
      this.rollV[k] += (-w * w * this.roll[k] - 2 * ROLL_ZETA * w * this.rollV[k] + push) * dt;
      this.roll[k] += this.rollV[k] * dt;
    }
    for (const p of this.planks) if (p.broken) p.brokenAge += dt;
  }

  /** Total sway energy, for tests and for the creak sound. */
  get energy(): number {
    let e = 0;
    for (let k = 0; k < 3; k++) {
      const w = 2 * Math.PI * VERTICAL_HZ[k];
      e += 0.5 * (this.av[k] ** 2 + (w * this.a[k]) ** 2);
    }
    return e;
  }

  plankIndex(x: number): number {
    return Math.floor(x / PLANK_PITCH);
  }

  plankAt(x: number): Plank | null {
    if (x < 0 || x >= BRIDGE_LENGTH) return null;
    return this.planks[this.plankIndex(x)] ?? null;
  }

  /** True where nothing can rest: past the anchors, or over a missing plank. */
  isOpen(x: number): boolean {
    const p = this.plankAt(x);
    return !p || p.broken;
  }

  damagePlank(index: number, amount: number): PlankDamage {
    const p = this.planks[index];
    if (!p || p.broken) return null;
    p.health -= amount;
    if (p.health <= 0) {
      p.health = 0;
      p.broken = true;
      p.brokenAge = 0;
      return 'break';
    }
    return 'crack';
  }

  /** Between waves the planks are lashed back in place. */
  repairAll(): number {
    let fixed = 0;
    for (const p of this.planks) {
      if (p.broken || p.health < PLANK_HEALTH) fixed++;
      p.health = PLANK_HEALTH;
      p.broken = false;
      p.brokenAge = 0;
    }
    return fixed;
  }

  get brokenCount(): number {
    return this.planks.filter((p) => p.broken).length;
  }
}
