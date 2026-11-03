/**
 * Every piece of weather that can touch the warrior: its collision shape, how it moves, what it costs.
 * Coordinates are lane metres: x runs along the bridge (0 at the west anchor), y is world height.
 */

export type DropKind = 'drizzle' | 'rain' | 'snow' | 'hail';

export interface Profile {
  /** Collision radius in metres for a single drop or flake. */
  r: number;
  /** Robe dryness lost on a hit, in percent, before stance modifiers. */
  damage: number;
  /** Mastery for cutting one. */
  exp: number;
  /** Seconds the warrior is stunned on a hit. */
  stun: number;
  /** Downward acceleration (hail only; rain and mist fall at a steady speed). */
  gravity: number;
  /** Fastest fall speed (negative is down). */
  terminal: number;
}

export const PROFILES: Record<DropKind, Profile> = {
  drizzle: { r: 0.03, damage: 0.45, exp: 1, stun: 0, gravity: 0, terminal: -4.5 },
  rain: { r: 0.05, damage: 1.2, exp: 1, stun: 0, gravity: 0, terminal: -60 },
  snow: { r: 0.15, damage: 1.2, exp: 2, stun: 0, gravity: 0, terminal: -3 },
  hail: { r: 0.6, damage: 25, exp: 15, stun: 0.6, gravity: 8, terminal: -14 },
};

export const HAIL_MIN_R = 0.45;
export const HAIL_MAX_R = 0.75;
export const MAX_CLUMP_R = 1.0;
/** Snow only clumps high in the air, well above the deck. */
export const CLUMP_MIN_Y = 2;
/** Anything that falls past this is lost in the gorge. */
export const GORGE_FLOOR = -60;

export interface Drop {
  id: number;
  kind: DropKind;
  x: number;
  y: number;
  /** Position at the start of the last step, for swept collision. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  /** Depth across the deck, for drawing only: the simulation is one lane. */
  z: number;
  /** Per-drop phase for snow sway and hail spin. */
  phase: number;
  age: number;
  dead: boolean;
  /** Swing number that last met this drop, so one swing meets it once. */
  touchedBy: number;
}

let nextId = 1;

export function makeDrop(kind: DropKind, x: number, y: number, vx: number, vy: number, r = PROFILES[kind].r, z = 0): Drop {
  const id = nextId++;
  return { id, kind, x, y, px: x, py: y, vx, vy, r, z, phase: (id * 2.399) % (Math.PI * 2), age: 0, dead: false, touchedBy: 0 };
}

/** Half extents of the collision box around a drop's centre. Snow clumps are wide and flat. */
export function extents(d: Drop): { rx: number; ry: number } {
  switch (d.kind) {
    case 'drizzle':
      return { rx: d.r * 2, ry: d.r * 2 };
    case 'rain':
      return { rx: d.r, ry: d.r };
    case 'snow':
      return { rx: d.r * 1.5, ry: d.r * 0.8 };
    case 'hail':
      return { rx: d.r, ry: d.r };
  }
}

/** Snow damage grows with clump area (to 25%); hail with size, from 25% to 40%. */
export function damageOf(d: Drop): number {
  const p = PROFILES[d.kind];
  if (d.kind === 'snow') return Math.min(25, p.damage * (d.r / p.r) ** 2);
  if (d.kind === 'hail') return 25 + 15 * Math.min(1, Math.max(0, (d.r - HAIL_MIN_R) / (HAIL_MAX_R - HAIL_MIN_R)));
  return p.damage;
}

export function expOf(d: Drop): number {
  const p = PROFILES[d.kind];
  if (d.kind === 'snow') return Math.round(p.exp * Math.max(1, (d.r / p.r) ** 1.2));
  return p.exp;
}

/** Integrates motion. Snow eases toward the wind and sways; hail accelerates; rain and mist hold their velocity. */
export function moveDrops(drops: Drop[], dt: number, wind: number): void {
  for (const d of drops) {
    if (d.dead) continue;
    d.px = d.x;
    d.py = d.y;
    d.age += dt;
    const p = PROFILES[d.kind];
    if (d.kind === 'snow') {
      const sway = Math.sin(d.age * 1.6 + d.phase) * (1.1 / (1 + d.r * 2));
      d.vx += (wind + sway - d.vx) * Math.min(1, dt * 1.4);
    } else if (d.kind === 'drizzle') {
      d.vx += (wind * 0.8 - d.vx) * Math.min(1, dt * 2);
    } else if (d.kind === 'hail') {
      d.phase += dt * (1.4 + Math.abs(d.vx) * 0.25);
      d.vx *= Math.exp(-1.1 * dt);
    }
    if (p.gravity > 0) d.vy = Math.max(p.terminal, d.vy - p.gravity * dt);
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.y < GORGE_FLOOR) d.dead = true;
  }
}

/** Snowflakes that touch high in the air merge into one wider clump with the same total area. */
export function clumpSnow(drops: Drop[]): number {
  let merges = 0;
  const snow = drops.filter((d) => d.kind === 'snow' && !d.dead && d.y > CLUMP_MIN_Y);
  for (let i = 0; i < snow.length; i++) {
    const a = snow[i];
    if (a.dead) continue;
    for (let j = i + 1; j < snow.length; j++) {
      const b = snow[j];
      if (b.dead || a.r >= MAX_CLUMP_R) continue;
      const dx = (a.x - b.x) / 1.5;
      const dy = a.y - b.y;
      const reach = (a.r + b.r) * 0.85;
      if (dx * dx + dy * dy > reach * reach) continue;
      const wa = a.r * a.r;
      const wb = b.r * b.r;
      const w = wa + wb;
      a.x = (a.x * wa + b.x * wb) / w;
      a.y = (a.y * wa + b.y * wb) / w;
      a.px = a.x;
      a.py = a.y;
      a.vx = (a.vx * wa + b.vx * wb) / w;
      a.z = (a.z * wa + b.z * wb) / w;
      a.r = Math.min(MAX_CLUMP_R, Math.sqrt(w));
      b.dead = true;
      merges++;
    }
  }
  return merges;
}

/**
 * Did the drop's path over the last step touch the box? Fast rain crosses a third of a metre per step,
 * so testing only the end point would let it pass through a slash or a body.
 */
export function sweptHits(d: Drop, x0: number, x1: number, y0: number, y1: number): boolean {
  const { rx, ry } = extents(d);
  const bx0 = x0 - rx;
  const bx1 = x1 + rx;
  const by0 = y0 - ry;
  const by1 = y1 + ry;
  const dx = d.x - d.px;
  const dy = d.y - d.py;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, d.px - bx0],
    [dx, bx1 - d.px],
    [-dy, d.py - by0],
    [dy, by1 - d.py],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}
