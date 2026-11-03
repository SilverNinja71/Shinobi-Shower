/** The lane is 30 metres wide; drops are born 16 metres up. Ground is y = 0. */
export const WORLD_WIDTH = 30;
export const SKY_HEIGHT = 16;

export type DropKind = 'drizzle' | 'rain' | 'snow' | 'hail';

export interface Profile {
  /** Collision radius in metres for a single drop or flake. */
  r: number;
  /** Starting fall speed (negative is down). */
  vy: number;
  gravity: number;
  terminal: number;
  /** Dryness lost on a hit, in percent. */
  damage: number;
  exp: number;
  /** Seconds the ninja is stunned on a hit. */
  stun: number;
}

export const PROFILES: Record<DropKind, Profile> = {
  drizzle: { r: 0.06, vy: -8.5, gravity: 0, terminal: -8.5, damage: 1, exp: 1, stun: 0 },
  rain: { r: 0.12, vy: -15, gravity: 0, terminal: -15, damage: 5, exp: 2, stun: 0 },
  snow: { r: 0.2, vy: -3.2, gravity: 0, terminal: -3.2, damage: 2.5, exp: 2, stun: 0 },
  hail: { r: 0.5, vy: -1.5, gravity: 7, terminal: -12, damage: 25, exp: 12, stun: 0.6 },
};

export const MAX_CLUMP_RADIUS = 1.1;
export const HAIL_MIN_R = 0.45;
export const HAIL_MAX_R = 0.7;

export interface Drop {
  id: number;
  kind: DropKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Phase for snow sway and hail spin. */
  phase: number;
  age: number;
  dead: boolean;
  /** Slash id that last touched this drop, so one slash only meets it once. */
  touchedBy: number;
}

let nextId = 1;

export function makeDrop(kind: DropKind, x: number, y: number, r = PROFILES[kind].r, vx = 0): Drop {
  return { id: nextId++, kind, x, y, vx, vy: PROFILES[kind].vy, r, phase: (nextId * 2.399) % (Math.PI * 2), age: 0, dead: false, touchedBy: 0 };
}

/** Half-extents of a drop's hitbox. Streaks are tall, snow clumps are wide and flat. */
export function extents(d: Drop): { rx: number; ry: number } {
  switch (d.kind) {
    case 'drizzle':
      return { rx: d.r, ry: d.r * 2 };
    case 'rain':
      return { rx: d.r, ry: d.r * 3 };
    case 'snow':
      return { rx: d.r * 1.6, ry: d.r * 0.8 };
    case 'hail':
      return { rx: d.r, ry: d.r };
  }
}

/** Hit damage. Snow scales with clump area; hail with size, from 25% to 40%. */
export function damageOf(d: Drop): number {
  const p = PROFILES[d.kind];
  if (d.kind === 'snow') return Math.min(25, p.damage * (d.r / p.r) ** 2);
  if (d.kind === 'hail') return 25 + (15 * (d.r - HAIL_MIN_R)) / (HAIL_MAX_R - HAIL_MIN_R);
  return p.damage;
}

export function expOf(d: Drop): number {
  const p = PROFILES[d.kind];
  if (d.kind === 'snow') return Math.round(p.exp * Math.max(1, (d.r / p.r) ** 1.2));
  return p.exp;
}

export interface Landing {
  x: number;
  kind: DropKind;
  r: number;
}

/** Moves every drop. Snow drifts with the wind and clumps; hail accelerates. Returns where drops hit the ground. */
export function stepDrops(drops: Drop[], dt: number, wind: number): Landing[] {
  const landed: Landing[] = [];
  for (const d of drops) {
    if (d.dead) continue;
    const p = PROFILES[d.kind];
    d.age += dt;
    if (d.kind === 'snow') {
      // Snow eases toward the wind and sways; big clumps are heavier and sway less.
      const sway = Math.sin(d.age * 1.7 + d.phase) * (1.2 / (1 + d.r * 2));
      d.vx += (wind + sway - d.vx) * Math.min(1, dt * 1.5);
    } else if (d.kind === 'drizzle') {
      d.vx = wind * 0.35;
    } else if (d.kind === 'rain') {
      d.vx = wind * 0.15;
    } else {
      d.phase += dt * (1.5 + d.vx * 0.2);
    }
    d.vy = Math.max(p.terminal, d.vy - p.gravity * dt);
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.kind === 'hail') d.vx *= Math.exp(-1.2 * dt);
    if (d.y - extents(d).ry <= 0) {
      d.dead = true;
      landed.push({ x: d.x, kind: d.kind, r: d.r });
    } else if (d.x < -3 || d.x > WORLD_WIDTH + 3) {
      d.dead = true;
    }
  }
  clumpSnow(drops);
  return landed;
}

/** Snowflakes that touch in the air merge into one wider clump with the same total area. */
export function clumpSnow(drops: Drop[]): void {
  const snow = drops.filter((d) => d.kind === 'snow' && !d.dead && d.y > 1.2);
  for (let i = 0; i < snow.length; i++) {
    const a = snow[i];
    if (a.dead) continue;
    for (let j = i + 1; j < snow.length; j++) {
      const b = snow[j];
      if (b.dead || a.r + b.r > MAX_CLUMP_RADIUS * 1.42) continue;
      const dx = (a.x - b.x) / 1.6;
      const dy = a.y - b.y;
      const reach = (a.r + b.r) * 0.85;
      if (dx * dx + dy * dy > reach * reach) continue;
      const wa = a.r * a.r;
      const wb = b.r * b.r;
      const w = wa + wb;
      a.x = (a.x * wa + b.x * wb) / w;
      a.y = (a.y * wa + b.y * wb) / w;
      a.vx = (a.vx * wa + b.vx * wb) / w;
      a.r = Math.min(MAX_CLUMP_RADIUS, Math.sqrt(w));
      b.dead = true;
    }
  }
}

export function overlaps(d: Drop, x0: number, x1: number, y0: number, y1: number): boolean {
  const { rx, ry } = extents(d);
  return d.x + rx > x0 && d.x - rx < x1 && d.y + ry > y0 && d.y - ry < y1;
}
