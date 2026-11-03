import { HEAVY_RADIUS, stepDroplet } from '../hazards/DropletProjectile.ts';
import type { Droplet, DropletKind } from '../hazards/DropletProjectile.ts';
import { DropletSpawner } from '../hazards/DropletSpawner.ts';
import type { WaveParams } from '../hazards/DropletSpawner.ts';
import { DRAIN_RADIUS, FoamBubbles, drainPull, drainStrength } from '../hazards/SudsVortex.ts';
import { TileGrid } from '../player/FloorInteraction.ts';
import type { Surface } from '../player/FloorInteraction.ts';
import { NO_INTENT, PLAYER_RADIUS, PlayerController } from '../player/PlayerController.ts';
import type { PlayerIntent } from '../player/PlayerController.ts';
import { MoistureMeter } from './MoistureMeter.ts';
import { mulberry32 } from './Rng.ts';
import type { Rng } from './Rng.ts';

export const SHOWER_LENGTH = 180;
const ATTRACT_TIME = 75;
const START = { x: 0, z: 4 };

/** Moisture cost of each thing that can touch the player. */
const COST = {
  mist: 0.25,
  spray: 2,
  stream: 4,
  bead: 2,
  heavy: 18,
  ripple: 1.5,
  bubble: 4,
  dash: 4,
  /** Per second inside a soap bubble, so waiting it out is never safe. */
  encased: 4,
};

const SCORE_PER_SECOND = 10;
const SCORE_DRIFT = 4;
const SCORE_CLOSE_SHAVE = 100;
const CLOSE_SHAVE_RANGE = 1.7;
/** A soap bubble always drifts drainward, even beyond the drain's normal reach. */
const BUBBLE_DRIFT = 0.9;
const MAX_EVENTS = 96;

export type GameState = 'attract' | 'playing' | 'paused' | 'won' | 'lost';
export type LossCause = 'dissolved' | 'drained';

export type GameEventType =
  | 'plink' | 'impact' | 'hit' | 'crush' | 'closeShave' | 'hop' | 'land'
  | 'dash' | 'wall' | 'encase' | 'burst' | 'cycle' | 'lost' | 'won';

export interface GameEvent {
  type: GameEventType;
  x: number;
  z: number;
  /** Rough size of the event, 0 to 1. */
  size: number;
}

interface Cycle {
  name: string;
  start: number;
  from: WaveParams;
  to: WaveParams;
}

/** The scripted shower. Each cycle ramps from its `from` values to its `to` values. */
export const CYCLES: Cycle[] = [
  {
    name: 'Lather',
    start: 0,
    from: { coneRate: 14, coneRadius: 3, heavyInterval: 3.6, barrage: 0, streamInterval: 14, bubbleInterval: 8, mistCount: 50, humidity: 0.1, heat: 37 },
    to: { coneRate: 24, coneRadius: 3.2, heavyInterval: 2.8, barrage: 0.1, streamInterval: 10, bubbleInterval: 7, mistCount: 70, humidity: 0.14, heat: 41 },
  },
  {
    name: 'Scrub',
    start: 60,
    from: { coneRate: 26, coneRadius: 3.4, heavyInterval: 2.4, barrage: 0.2, streamInterval: 9, bubbleInterval: 12, mistCount: 80, humidity: 0.18, heat: 42 },
    to: { coneRate: 38, coneRadius: 3.6, heavyInterval: 1.8, barrage: 0.35, streamInterval: 7.5, bubbleInterval: 10, mistCount: 100, humidity: 0.22, heat: 46 },
  },
  {
    name: 'Power Rinse',
    start: 120,
    from: { coneRate: 42, coneRadius: 3.8, heavyInterval: 1.6, barrage: 0.4, streamInterval: 6, bubbleInterval: 9, mistCount: 110, humidity: 0.26, heat: 47 },
    to: { coneRate: 58, coneRadius: 4.4, heavyInterval: 1.05, barrage: 0.55, streamInterval: 4.5, bubbleInterval: 7, mistCount: 140, humidity: 0.32, heat: 52 },
  },
];

export function cycleIndexAt(time: number): number {
  for (let i = CYCLES.length - 1; i > 0; i--) if (time >= CYCLES[i].start) return i;
  return 0;
}

export function waveAt(time: number): WaveParams {
  const index = cycleIndexAt(time);
  const cycle = CYCLES[index];
  const end = index + 1 < CYCLES.length ? CYCLES[index + 1].start : SHOWER_LENGTH;
  const t = Math.max(0, Math.min(1, (time - cycle.start) / (end - cycle.start)));
  const out = { ...cycle.from };
  for (const key of Object.keys(out) as (keyof WaveParams)[]) {
    out[key] = cycle.from[key] + (cycle.to[key] - cycle.from[key]) * t;
  }
  return out;
}

/** The simulation. Runs without a DOM or a GPU, so the tests can play it headlessly. */
export class GameLoop {
  state: GameState = 'attract';
  time = 0;
  score = 0;
  lossCause: LossCause | null = null;
  surface: Surface = 'wet';
  /** Consumed each frame by whatever renders and sonifies the game. */
  readonly events: GameEvent[] = [];

  readonly grid = new TileGrid();
  readonly player = new PlayerController();
  readonly moisture = new MoistureMeter();
  readonly spawner: DropletSpawner;
  readonly bubbles: FoamBubbles;

  private readonly pull = { x: 0, z: 0 };
  private wave: WaveParams = waveAt(ATTRACT_TIME);
  private cycleIndex = 0;

  constructor(rng: Rng = mulberry32((Math.random() * 2 ** 32) >>> 0)) {
    this.spawner = new DropletSpawner(rng);
    this.bubbles = new FoamBubbles(rng);
    this.player.reset(START.x, START.z);
  }

  /** Temperature for the HUD and the steam effect. */
  get heat(): number {
    return this.wave.heat;
  }

  get drainStrength(): number {
    return drainStrength(this.state === 'attract' ? ATTRACT_TIME : this.time);
  }

  start(): void {
    this.state = 'playing';
    this.time = 0;
    this.score = 0;
    this.lossCause = null;
    this.cycleIndex = 0;
    this.grid.reset();
    this.spawner.reset();
    this.bubbles.reset();
    this.moisture.reset();
    this.player.reset(START.x, START.z);
    this.wave = waveAt(0);
    this.events.length = 0;
    this.emit('cycle', 0, 0, 0);
  }

  step(dt: number, intent: PlayerIntent = NO_INTENT): void {
    if (this.state === 'paused') return;
    const live = this.state === 'playing';
    if (live) this.time += dt;
    this.wave = waveAt(live ? this.time : ATTRACT_TIME);

    if (live) {
      const index = cycleIndexAt(this.time);
      if (index !== this.cycleIndex) {
        this.cycleIndex = index;
        this.emit('cycle', 0, 0, index);
      }
      this.stepPlayer(dt, intent);
    }

    this.grid.update(dt);
    this.spawner.update(dt, this.wave, live ? this.player : null);
    this.bubbles.update(dt, this.wave.bubbleInterval, this.grid);
    this.stepDroplets(dt, live);

    if (live) {
      this.stepRipples();
      this.touchBubbles();
      this.finishStep(dt);
    }
  }

  private emit(type: GameEventType, x: number, z: number, size: number): void {
    if (this.events.length < MAX_EVENTS) this.events.push({ type, x, z, size });
  }

  private stepPlayer(dt: number, intent: PlayerIntent): void {
    const p = this.player;
    drainPull(p.x, p.z, drainStrength(this.time), this.pull);
    if (p.encased) {
      const dist = Math.hypot(p.x, p.z) || 1;
      this.pull.x -= (p.x / dist) * BUBBLE_DRIFT;
      this.pull.z -= (p.z / dist) * BUBBLE_DRIFT;
    }
    this.surface = this.grid.surfaceAt(p.x, p.z);
    const ev = p.step(dt, intent, this.grid.propsAt(p.x, p.z), this.pull.x, this.pull.z);

    if (ev.dashed) {
      this.moisture.add(COST.dash, true);
      this.emit('dash', p.x, p.z, 1);
    }
    if (ev.hopped) this.emit('hop', p.x, p.z, 0.5);
    if (ev.burst) this.emit('burst', p.x, p.z, 1);
    if (ev.wall > 2) this.emit('wall', p.x, p.z, Math.min(1, ev.wall / 12));
    if (ev.landed > 0) {
      this.spawner.pushRadial(p.x, p.z, 2.2, 5);
      this.grid.addWater(p.x, p.z, 0.05);
      this.emit('land', p.x, p.z, Math.min(1, ev.landed / 7));
    }
  }

  private stepDroplets(dt: number, live: boolean): void {
    const alive = this.spawner.pool.alive;
    for (let i = alive.length - 1; i >= 0; i--) {
      const d = alive[i];
      if (stepDroplet(d, dt)) {
        this.consumeOnFloor(d, live);
        this.spawner.pool.removeAt(i);
      } else if (d.age >= d.life) {
        this.spawner.pool.removeAt(i);
      } else if (live && d.kind !== 'heavy' && this.touchDroplet(d)) {
        this.spawner.pool.removeAt(i);
      }
    }
  }

  private consumeOnFloor(d: Droplet, live: boolean): void {
    if (d.kind === 'spray') {
      this.grid.addWater(d.x, d.z, 0.1);
      this.emit('plink', d.x, d.z, d.r);
    } else if (d.kind === 'heavy') {
      this.grid.addWater(d.x, d.z, 0.5);
      this.spawner.burst(d.x, d.z);
      this.emit('impact', d.x, d.z, 1);
      if (live) this.heavyImpact(d);
    }
  }

  private heavyImpact(d: Droplet): void {
    const p = this.player;
    const dx = p.x - d.x;
    const dz = p.z - d.z;
    const dist = Math.hypot(dx, dz);
    if (dist < HEAVY_RADIUS + PLAYER_RADIUS * 0.5 && p.iframes <= 0 && !p.encased) {
      this.moisture.add(COST.heavy);
      const away = dist > 0.001 ? 7 / dist : 0;
      p.applyImpulse(dx * away, 3, dz * away);
      p.iframes = 0.7;
      this.emit('crush', p.x, p.z, 1);
    } else if (dist < CLOSE_SHAVE_RANGE && dist >= HEAVY_RADIUS && !p.encased) {
      this.score += SCORE_CLOSE_SHAVE;
      this.emit('closeShave', p.x, p.z, 1);
    }
  }

  /** Applies a small droplet's hit. Returns true if the droplet was absorbed. */
  private touchDroplet(d: Droplet): boolean {
    const p = this.player;
    if (p.encased || !p.overlapsSphere(d.x, d.y, d.z, d.r)) return false;
    // The dash's invincibility covers light spray, not heavy drops.
    if (p.dashing) return false;
    const kind: DropletKind = d.kind;
    if (kind === 'mist' || kind === 'spray') {
      this.moisture.add(COST[kind]);
      return true;
    }
    if (p.iframes > 0) return false;
    this.moisture.add(COST[kind === 'bead' ? 'bead' : 'stream']);
    const speed = Math.hypot(d.vx, d.vz) || 1;
    const shove = kind === 'bead' ? 2.5 : 4;
    p.applyImpulse((d.vx / speed) * shove, 0, (d.vz / speed) * shove);
    p.iframes = kind === 'bead' ? 0.5 : 0.35;
    this.emit('hit', p.x, p.z, 0.5);
    return true;
  }

  private stepRipples(): void {
    const p = this.player;
    if (!p.grounded || p.encased) return;
    for (const ripple of this.spawner.ripples) {
      if (ripple.spent) continue;
      const dx = p.x - ripple.x;
      const dz = p.z - ripple.z;
      const dist = Math.hypot(dx, dz);
      if (Math.abs(dist - ripple.r) < 0.3) {
        ripple.spent = true;
        if (dist > 0.001) p.applyImpulse((dx / dist) * ripple.strength, 0, (dz / dist) * ripple.strength);
        this.moisture.add(COST.ripple, true);
      }
    }
  }

  private touchBubbles(): void {
    const p = this.player;
    if (p.encased || p.iframes > 0 || p.dashing) return;
    const items = this.bubbles.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const b = items[i];
      if (Math.hypot(p.x - b.x, p.z - b.z) < b.r + PLAYER_RADIUS * 0.6) {
        items.splice(i, 1);
        p.encase();
        p.vx += b.vx;
        p.vz += b.vz;
        this.moisture.add(COST.bubble);
        this.emit('encase', p.x, p.z, 1);
        return;
      }
    }
  }

  private finishStep(dt: number): void {
    const p = this.player;
    this.moisture.update(dt, this.surface, this.wave.humidity);
    if (p.encased) this.moisture.add(COST.encased * dt, true);
    this.score += SCORE_PER_SECOND * dt;
    if (p.sliding && this.surface !== 'dry') this.score += p.drift * SCORE_DRIFT * dt;

    if (this.moisture.dissolved) {
      this.finish('lost', 'dissolved');
    } else if (p.grounded && !p.dashing && Math.hypot(p.x, p.z) < DRAIN_RADIUS) {
      this.finish('lost', 'drained');
    } else if (this.time >= SHOWER_LENGTH) {
      this.finish('won', null);
    }
  }

  private finish(state: 'won' | 'lost', cause: LossCause | null): void {
    this.state = state;
    this.lossCause = cause;
    this.emit(state, this.player.x, this.player.z, 1);
  }
}
