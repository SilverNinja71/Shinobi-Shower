import { Katana, SWEET_HALF_WIDTH, SWEET_HIGH, SWEET_LOW } from '../entities/Katana.ts';
import { HALF_WIDTH, Ninja } from '../entities/Ninja.ts';
import { LevelManager } from '../progression/LevelManager.ts';
import {
  FOCUS_CUT_COOLDOWN,
  PERKS,
  SHIELD_REFORM_TIME,
  VULNERABLE_TIME,
  incomingDamage,
  stanceFor,
} from '../progression/StanceModifiers.ts';
import type { Perk, Stance } from '../progression/StanceModifiers.ts';
import { PROFILES, damageOf, expOf, extents, makeDrop, overlaps, stepDrops } from './DropletPhysics.ts';
import type { Drop, DropKind } from './DropletPhysics.ts';
import { WeatherSystem } from './WeatherSystem.ts';

export const STEAM_RADIUS = 1.7;
export const HITSTOP = 0.06;

export type Phase = 'menu' | 'playing' | 'paused' | 'over';

export interface FrameInput {
  moveX: number;
  dashPressed: boolean;
  slashPressed: boolean;
  focusPressed: boolean;
}

export const NO_INPUT: FrameInput = { moveX: 0, dashPressed: false, slashPressed: false, focusPressed: false };

export type GameEvent =
  | { type: 'slash'; x: number; side: number }
  | { type: 'slice'; x: number; y: number; kind: DropKind; r: number }
  | { type: 'perfect'; x: number; y: number; r: number }
  | { type: 'clang'; x: number; y: number }
  | { type: 'steam'; x: number; y: number }
  | { type: 'hit'; x: number; y: number; kind: DropKind; damage: number }
  | { type: 'shatter'; x: number; y: number }
  | { type: 'reform'; x: number; y: number }
  | { type: 'splash'; x: number; kind: DropKind; r: number }
  | { type: 'dash'; x: number; dir: number }
  | { type: 'wave'; wave: number; name: string }
  | { type: 'clear'; wave: number; exp: number }
  | { type: 'beat' }
  | { type: 'levelup'; level: number; perk: string | null }
  | { type: 'focus'; x: number; count: number }
  | { type: 'over' };

export interface RunStats {
  time: number;
  sliced: number;
  perfect: number;
  wavesCleared: number;
  hits: number;
  exp: number;
  bestCombo: number;
  startLevel: number;
}

/** The whole simulation, with no DOM, so it can be stepped in tests exactly as in play. */
export class Game {
  phase: Phase = 'menu';
  ninja = new Ninja();
  katana = new Katana();
  weather = new WeatherSystem(1);
  drops: Drop[] = [];
  levels: LevelManager;
  disabled: Set<Perk>;
  stance: Stance;
  dryness = 100;
  shieldUp = true;
  shieldReform = 0;
  vulnerable = 0;
  focusCooldown = 0;
  combo = 0;
  hitstop = 0;
  stats: RunStats = this.freshStats();
  readonly events: GameEvent[] = [];

  constructor(level = 1, exp = 0, disabled: Iterable<Perk> = []) {
    this.levels = new LevelManager(level, exp);
    this.disabled = new Set(disabled);
    this.stance = stanceFor(this.levels.level, this.disabled);
  }

  private freshStats(): RunStats {
    return { time: 0, sliced: 0, perfect: 0, wavesCleared: 0, hits: 0, exp: 0, bestCombo: 0, startLevel: this.levels?.level ?? 1 };
  }

  refreshStance(): void {
    this.stance = stanceFor(this.levels.level, this.disabled);
  }

  start(seed = (Math.random() * 2 ** 31) | 0): void {
    this.refreshStance();
    this.ninja = new Ninja();
    this.katana = new Katana();
    this.weather = new WeatherSystem(seed);
    this.drops = [];
    this.dryness = 100;
    this.shieldUp = true;
    this.shieldReform = 0;
    this.vulnerable = 0;
    this.focusCooldown = 0;
    this.combo = 0;
    this.hitstop = 0;
    this.stats = this.freshStats();
    this.events.length = 0;
    this.phase = 'playing';
  }

  get focusReady(): boolean {
    return this.stance.focus && this.focusCooldown === 0;
  }

  /** Grants mastery, with a bonus for an unbroken run of cuts. */
  private gain(base: number): void {
    const amount = Math.round(base * (1 + Math.min(this.combo, 50) / 100));
    this.stats.exp += amount;
    for (const level of this.levels.add(amount)) {
      const perk = PERKS.find((p) => p.level === level);
      this.refreshStance();
      this.events.push({ type: 'levelup', level, perk: perk ? perk.name : null });
    }
  }

  step(dt: number, input: FrameInput): void {
    if (this.phase !== 'playing') return;
    if (input.slashPressed) this.katana.press();
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }
    this.stats.time += dt;
    const n = this.ninja;
    const s = this.stance;

    if (n.update(dt, input.moveX, input.dashPressed, s)) this.events.push({ type: 'dash', x: n.x, dir: n.dashDir });
    if (this.katana.update(dt, s, n.facing, n.stun <= 0)) {
      for (const arc of this.katana.arcs(n.x, s)) this.events.push({ type: 'slash', x: n.x, side: arc.side });
    }

    this.vulnerable = Math.max(0, this.vulnerable - dt);
    this.focusCooldown = Math.max(0, this.focusCooldown - dt);
    if (!this.shieldUp && s.aura) {
      this.shieldReform = Math.max(0, this.shieldReform - dt);
      if (this.shieldReform === 0) {
        this.shieldUp = true;
        this.events.push({ type: 'reform', x: n.x, y: 1 });
      }
    }

    if (input.focusPressed && this.focusReady) this.focusCut();

    this.weather.update(dt, this.drops, n.x);
    for (const e of this.weather.events) {
      if (e.type === 'wave') this.events.push({ type: 'wave', wave: e.value, name: this.weather.season.name });
      else if (e.type === 'beat') this.events.push({ type: 'beat' });
      else {
        const exp = 25 + 10 * e.value;
        this.stats.wavesCleared++;
        this.gain(exp);
        this.events.push({ type: 'clear', wave: e.value, exp });
      }
    }
    this.weather.events.length = 0;

    for (const l of stepDrops(this.drops, dt, this.weather.wind)) this.events.push({ type: 'splash', x: l.x, kind: l.kind, r: l.r });

    if (this.katana.active) this.cut();
    this.collide();

    this.drops = this.drops.filter((d) => !d.dead);
    if (this.dryness <= 0) {
      this.dryness = 0;
      this.phase = 'over';
      this.events.push({ type: 'over' });
    }
  }

  private cut(): void {
    const n = this.ninja;
    const swing = this.katana.swing;
    for (const arc of this.katana.arcs(n.x, this.stance)) {
      for (const d of this.drops) {
        if (d.dead || d.touchedBy === swing || !overlaps(d, arc.x0, arc.x1, arc.y0, arc.y1)) continue;
        d.touchedBy = swing;
        if (d.kind === 'hail') {
          if (Math.abs(d.x - arc.sweet) <= SWEET_HALF_WIDTH && d.y >= SWEET_LOW && d.y <= SWEET_HIGH) {
            this.slice(d);
            this.stats.perfect++;
            this.hitstop = HITSTOP;
            this.events.push({ type: 'perfect', x: d.x, y: d.y, r: d.r });
          } else {
            // An off-centre cut glances: the stone is knocked aside but not broken.
            d.vx = arc.side * 5;
            d.vy = Math.max(d.vy, -3);
            this.events.push({ type: 'clang', x: d.x, y: d.y });
          }
          continue;
        }
        this.slice(d);
        if (this.stance.flame) this.steam(d.x, d.y);
      }
    }
  }

  private slice(d: Drop): void {
    d.dead = true;
    this.combo++;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    this.stats.sliced++;
    this.gain(expOf(d));
    this.events.push({ type: 'slice', x: d.x, y: d.y, kind: d.kind, r: d.r });
  }

  /** Ignited steel turns a cut drop into a burst of vapour that takes the water around it too. */
  private steam(x: number, y: number): void {
    this.events.push({ type: 'steam', x, y });
    for (const d of this.drops) {
      if (d.dead || d.kind === 'hail') continue;
      if (Math.hypot(d.x - x, d.y - y) <= STEAM_RADIUS) this.slice(d);
    }
  }

  focusCut(): void {
    let count = 0;
    for (const d of this.drops) {
      if (d.dead) continue;
      this.slice(d);
      count++;
    }
    this.focusCooldown = FOCUS_CUT_COOLDOWN;
    this.events.push({ type: 'focus', x: this.ninja.x, count });
  }

  private collide(): void {
    const n = this.ninja;
    if (n.invulnerable) return;
    const x0 = n.x - HALF_WIDTH;
    const x1 = n.x + HALF_WIDTH;
    for (const d of this.drops) {
      if (d.dead || !overlaps(d, x0, x1, 0, n.height)) continue;
      d.dead = true;
      const { damage, shatter } = incomingDamage(d.kind, damageOf(d), this.stance, { shieldUp: this.shieldUp, vulnerable: this.vulnerable });
      this.dryness -= damage;
      this.combo = 0;
      this.stats.hits++;
      n.stun = Math.max(n.stun, PROFILES[d.kind].stun);
      this.events.push({ type: 'hit', x: d.x, y: d.y - extents(d).ry, kind: d.kind, damage });
      if (shatter) {
        this.shieldUp = false;
        this.shieldReform = SHIELD_REFORM_TIME;
        this.vulnerable = VULNERABLE_TIME;
        this.events.push({ type: 'shatter', x: n.x, y: 1 });
      }
    }
  }

  /** For tests and the debug hook. */
  spawn(kind: DropKind, x: number, y: number, r?: number): Drop {
    const d = makeDrop(kind, x, y, r);
    this.drops.push(d);
    return d;
  }
}
