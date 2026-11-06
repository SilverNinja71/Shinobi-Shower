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
import { WaveDirector, planWave, waveDuration } from '../progression/WaveDirector.ts';
import { SnowAccumulator } from '../scene/SnowAccumulator.ts';
import { BRIDGE_LENGTH, PLANK_PITCH, SuspensionBridge } from '../scene/SuspensionBridge.ts';
import { DynamicStormSystem } from '../weather/DynamicStormSystem.ts';
import { PROFILES, clumpSnow, damageOf, expOf, extents, makeDrop, moveDrops, sweptHits } from '../weather/PrecipitationDroplet.ts';
import type { Drop, DropKind } from '../weather/PrecipitationDroplet.ts';
import { KatanaSlash, SWEET_HALF_WIDTH, SWEET_HIGH, SWEET_LOW, WAKE_MAX_R } from '../warrior/KatanaSlash.ts';
import { HALF_WIDTH, KICK_DEPTH, WarriorController, STAMINA_MAX } from '../warrior/WarriorController.ts';
import { AtomicCutsceneSim } from '../cinematic/AtomicCutsceneSim.ts';
import { CelestialBattle } from '../celestial/CelestialBattle.ts';
import type { DemonKind } from '../celestial/CelestialBattle.ts';

export const STEAM_RADIUS = 1.8;
export const HITSTOP = 0.06;
/** Snow a rain drop melts where it lands (m of depth). */
const RAIN_MELT = 0.006;

export type Phase = 'menu' | 'playing' | 'paused' | 'cutscene' | 'celestial' | 'over';

export interface SandboxOptions {
  active: boolean;
  godMode: boolean;
  infiniteStamina: boolean;
  rapidSlash: boolean;
  flameBlade: boolean;
  lightBlade: boolean;
  timeScale: number;
}

export interface FrameInput {
  moveX: number;
  dashPressed: boolean;
  slashPressed: boolean;
  kickPressed: boolean;
  focusPressed: boolean;
  aimX?: number;
  aimY?: number;
}

export const NO_INPUT: FrameInput = { moveX: 0, dashPressed: false, slashPressed: false, kickPressed: false, focusPressed: false };

/** Everything the renderer, HUD and audio react to. Positions are lane coordinates. */
export type GameEvent =
  | { type: 'slash'; x: number; y: number; side: number }
  | { type: 'whiff'; x: number }
  | { type: 'cut'; x: number; y: number; z: number; kind: DropKind; r: number; wake: boolean }
  | { type: 'perfect'; x: number; y: number; r: number }
  | { type: 'clang'; x: number; y: number }
  | { type: 'steam'; x: number; y: number }
  | { type: 'hit'; x: number; y: number; kind: DropKind; damage: number }
  | { type: 'shatter'; x: number; y: number }
  | { type: 'reform'; x: number; y: number }
  | { type: 'land'; x: number; y: number; z: number; kind: DropKind; r: number; onSnow: boolean }
  | { type: 'plank'; index: number; x: number; y: number; damage: 'crack' | 'break'; health: number }
  | { type: 'dash'; x: number; dir: number }
  | { type: 'kick'; x: number; dir: number; area: number }
  | { type: 'melt'; x0: number; x1: number; y: number; area: number }
  | { type: 'stumble'; x: number }
  | { type: 'curtain'; dir: number; center: number }
  | { type: 'lightning'; x: number; power: number }
  | { type: 'wave'; wave: number; name: string; duration: number }
  | { type: 'front'; name: string }
  | { type: 'clear'; wave: number; exp: number; repaired: number }
  | { type: 'levelup'; level: number; perk: string | null }
  | { type: 'focus'; x: number; count: number }
  | { type: 'atomic_trigger'; x: number; y: number }
  | { type: 'atomic_fission'; x: number; y: number }
  | { type: 'atomic_explosion'; x: number; y: number }
  | { type: 'bridge_collapse' }
  | { type: 'celestial_start' }
  | { type: 'demon_spawn'; id: number; x: number; y: number; kind: DemonKind }
  | { type: 'demon_slain'; id: number; x: number; y: number; points: number; kind?: DemonKind }
  | { type: 'angel_spawn'; id: number; x: number; y: number }
  | { type: 'angel_bless'; id?: number; x: number; y: number }
  | { type: 'angel_struck'; id?: number; x: number; y: number }
  | { type: 'light_blade_start' }
  | { type: 'light_blade_end' }
  | { type: 'over' };

export interface RunStats {
  time: number;
  cut: number;
  perfect: number;
  wavesCleared: number;
  hits: number;
  exp: number;
  bestCombo: number;
  planksLost: number;
  snowCleared: number;
  startLevel: number;
}

/** The whole simulation, with no DOM and no Three.js, so tests can step it exactly as play does. */
export class Game {
  phase: Phase = 'menu';
  time = 0;
  seed = 1;
  bridge = new SuspensionBridge();
  snow = new SnowAccumulator(BRIDGE_LENGTH);
  storm = new DynamicStormSystem(1, BRIDGE_LENGTH);
  waves = new WaveDirector(1);
  warrior = new WarriorController();
  katana = new KatanaSlash();
  readonly cutscene = new AtomicCutsceneSim();
  readonly celestial = new CelestialBattle();
  sandbox: SandboxOptions = {
    active: false,
    godMode: false,
    infiniteStamina: false,
    rapidSlash: false,
    flameBlade: false,
    lightBlade: false,
    timeScale: 1.0,
  };
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
  stats: RunStats;
  readonly events: GameEvent[] = [];

  constructor(level = 1, exp = 0, disabled: Iterable<Perk> = []) {
    this.levels = new LevelManager(level, exp);
    this.disabled = new Set(disabled);
    this.stance = stanceFor(this.levels.level, this.disabled);
    this.stats = this.freshStats();
  }

  private freshStats(): RunStats {
    return { time: 0, cut: 0, perfect: 0, wavesCleared: 0, hits: 0, exp: 0, bestCombo: 0, planksLost: 0, snowCleared: 0, startLevel: this.levels.level };
  }

  refreshStance(): void {
    this.stance = stanceFor(this.levels.level, this.disabled);
  }

  get drops(): Drop[] {
    return this.storm.drops;
  }

  /** Where the warrior's feet are. */
  get feetY(): number {
    return this.phase === 'celestial' ? 0 : this.bridge.deckY(this.warrior.x);
  }

  get exposed(): boolean {
    return this.katana.exposed;
  }

  get focusReady(): boolean {
    return this.stance.focus && this.focusCooldown === 0;
  }

  triggerAtomicCleave(): void {
    this.phase = 'cutscene';
    this.cutscene.start(this.warrior.x, this.feetY);
    this.events.push({ type: 'atomic_trigger', x: this.warrior.x, y: this.feetY });
  }

  repairBridge(): void {
    for (const p of this.bridge.planks) {
      p.health = 4;
      p.broken = false;
      p.brokenAge = 0;
    }
  }

  breakRandomPlanks(count = 6): void {
    const indices = Array.from({ length: this.bridge.planks.length }, (_, i) => i);
    indices.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(count, indices.length); i++) {
      const p = this.bridge.planks[indices[i]];
      p.broken = true;
      p.health = 0;
      this.events.push({ type: 'plank', index: p.index, x: p.x, y: this.bridge.deckY(p.x), damage: 'break', health: 0 });
    }
  }

  clearSnow(): void {
    const area = this.snow.clear(0, BRIDGE_LENGTH);
    this.stats.snowCleared += area;
  }

  fillSnow(depth = 0.35): void {
    this.snow.depth.fill(depth);
  }

  clearStorm(): void {
    this.drops.length = 0;
    this.storm.drops.length = 0;
  }

  jumpWave(wave: number, t = 5): void {
    this.waves.wave = wave;
    this.waves.duration = waveDuration(wave);
    this.waves.fronts = planWave(wave, this.seed);
    this.waves.t = t;
    this.events.push({ type: 'wave', wave, name: this.waves.title, duration: this.waves.duration });
  }

  warpToCelestial(): void {
    if (this.phase === 'menu') this.start();
    this.phase = 'celestial';
    this.celestial.start(this.warrior.x);
    this.events.push({ type: 'celestial_start' });
  }

  warpToPeak(): void {
    if (this.phase === 'menu') this.start();
    this.phase = 'playing';
    this.celestial.active = false;
  }

  spawnDemon(kind: DemonKind = 'imp'): ReturnType<CelestialBattle['spawnDemon']> {
    if (!this.celestial.active) this.warpToCelestial();
    const d = this.celestial.spawnDemon(kind, this.warrior.x + (Math.random() * 8 - 4), 3.8);
    this.events.push({ type: 'demon_spawn', id: d.id, x: d.x, y: d.y, kind: d.kind });
    return d;
  }

  spawnAngel(): ReturnType<CelestialBattle['spawnAngel']> {
    if (!this.celestial.active) this.warpToCelestial();
    const a = this.celestial.spawnAngel(this.warrior.x + (Math.random() * 4 - 2));
    this.events.push({ type: 'angel_spawn', id: a.id, x: a.x, y: a.y });
    return a;
  }

  start(seed = (Math.random() * 2 ** 31) | 0): void {
    this.seed = seed;
    this.refreshStance();
    this.time = 0;
    this.bridge = new SuspensionBridge();
    this.snow = new SnowAccumulator(BRIDGE_LENGTH);
    this.storm = new DynamicStormSystem(seed, BRIDGE_LENGTH);
    this.waves = new WaveDirector(seed);
    this.warrior = new WarriorController();
    this.katana = new KatanaSlash();
    this.cutscene.active = false;
    this.celestial.active = false;
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

  /** Grants mastery, with up to +50% for an unbroken run of cuts. */
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
    if (this.sandbox.active) {
      if (this.sandbox.godMode) {
        this.dryness = 100;
        this.shieldUp = true;
      }
      if (this.sandbox.infiniteStamina) {
        this.warrior.stamina = STAMINA_MAX;
      }
      if (this.sandbox.flameBlade) {
        this.stance.flame = true;
      }
      if (this.sandbox.rapidSlash) {
        this.katana.cooldown = Math.min(this.katana.cooldown, 0.05);
      }
      if (this.sandbox.lightBlade) {
        this.celestial.lightBladeTimer = Math.max(this.celestial.lightBladeTimer, 10);
      }
    }
    if (this.phase === 'cutscene') {
      this.stepCutscene(dt);
      return;
    }
    if (this.phase === 'celestial') {
      this.stepCelestial(dt, input);
      return;
    }
    if (this.phase !== 'playing') return;
    if (input.slashPressed) this.katana.press(input.aimX, input.aimY);
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }
    this.time += dt;
    this.stats.time += dt;
    const w = this.warrior;
    const s = this.stance;

    this.stepWaves(dt);
    this.storm.update(dt, this.waves.weights, this.waves.intensity, w.x);
    for (const e of this.storm.events) this.events.push(e);
    this.storm.events.length = 0;
    this.bridge.update(dt, this.storm.wind, w.x);

    const moved = w.update(dt, { moveX: input.moveX, dash: input.dashPressed, kick: input.kickPressed }, { stance: s, bridge: this.bridge, snow: this.snow, exposed: this.exposed });
    if (this.sandbox.active && this.sandbox.infiniteStamina) {
      w.stamina = STAMINA_MAX;
    }
    if (moved.dashed) {
      this.bridge.impulse(w.x, 0.12);
      this.events.push({ type: 'dash', x: w.x, dir: w.dashDir });
    }
    if (moved.kicked) {
      const [x0, x1] = w.kickSpan();
      const area = this.snow.clear(x0, x1, KICK_DEPTH);
      this.stats.snowCleared += area;
      this.bridge.impulse(w.x, 0.04);
      this.events.push({ type: 'kick', x: w.x, dir: w.facing, area });
    }
    if (moved.stumbled) this.events.push({ type: 'stumble', x: w.x });

    const slash = this.katana.update(dt, s, w.facing, w.stun <= 0 && !w.kicking && !w.rolling, w.x, this.feetY + 1.5);
    if (slash === 'start') {
      w.facing = this.katana.facing;
      for (const arc of this.katana.arcs(w.x, this.feetY, s)) {
        this.events.push({ type: 'slash', x: w.x, y: this.feetY, side: arc.side });
        // A burning edge sweeping low vaporizes the drift it passes over.
        if (s.flame) {
          const area = this.snow.clear(arc.x0, arc.x1);
          if (area > 0) {
            this.stats.snowCleared += area;
            this.events.push({ type: 'melt', x0: arc.x0, x1: arc.x1, y: this.feetY, area });
          }
        }
      }
    } else if (slash === 'whiff') {
      this.events.push({ type: 'whiff', x: w.x });
    }

    this.vulnerable = Math.max(0, this.vulnerable - dt);
    this.focusCooldown = Math.max(0, this.focusCooldown - dt);
    if (!this.shieldUp && s.aura) {
      this.shieldReform = Math.max(0, this.shieldReform - dt);
      if (this.shieldReform === 0) {
        this.shieldUp = true;
        this.events.push({ type: 'reform', x: w.x, y: this.feetY + 1 });
      }
    }
    if (input.focusPressed && this.focusReady) this.focusCut();

    moveDrops(this.drops, dt, this.storm.wind);
    clumpSnow(this.drops);
    if (this.katana.cutting) this.cut();
    this.collide();
    this.land();
    this.snow.update(dt, this.waves.weights.rain * 0.004);

    this.storm.drops.splice(0, this.storm.drops.length, ...this.drops.filter((d) => !d.dead));
    if (this.dryness <= 0) {
      if (this.sandbox.active && this.sandbox.godMode) {
        this.dryness = 100;
      } else {
        this.dryness = 0;
        this.phase = 'over';
        this.events.push({ type: 'over' });
      }
    }
  }

  private stepCutscene(dt: number): void {
    const done = this.cutscene.update(dt);
    for (const e of this.cutscene.events) {
      if (e.type === 'atomic_freeze') this.events.push({ type: 'atomic_trigger', x: e.x, y: e.y });
      else if (e.type === 'atomic_fission') this.events.push({ type: 'atomic_fission', x: e.x, y: e.y });
      else if (e.type === 'atomic_explosion') this.events.push({ type: 'atomic_explosion', x: e.x, y: e.y });
      else if (e.type === 'bridge_shatter') this.events.push({ type: 'bridge_collapse' });
      else if (e.type === 'celestial_ascend') {
        this.warrior.x = 18;
        this.celestial.start(18);
        // Spawn initial demons advancing from both sides of the white-and-gold staircase to push the soldier down
        const dLeft = this.celestial.spawnDemon('imp', 12.5, 0);
        dLeft.staircaseCharger = true;
        const dRight = this.celestial.spawnDemon('drake', 23.5, 0);
        dRight.staircaseCharger = true;
      }
    }
    this.cutscene.events.length = 0;

    if (done) {
      this.phase = 'celestial';
      if (!this.celestial.active) this.celestial.start(this.warrior.x);
      this.events.push({ type: 'celestial_start' });
    }
  }

  private stepCelestial(dt: number, input: FrameInput): void {
    if (input.slashPressed) this.katana.press(input.aimX, input.aimY);
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }
    this.time += dt;
    this.stats.time += dt;
    const w = this.warrior;
    const s = this.stance;

    const moved = w.update(dt, { moveX: input.moveX, dash: input.dashPressed, kick: input.kickPressed }, { stance: s, bridge: this.bridge, snow: this.snow, exposed: this.exposed });
    if (this.sandbox.active && this.sandbox.infiniteStamina) {
      w.stamina = STAMINA_MAX;
    }
    if (moved.dashed) {
      this.events.push({ type: 'dash', x: w.x, dir: w.dashDir });
    }
    if (moved.kicked) {
      this.events.push({ type: 'kick', x: w.x, dir: w.facing, area: 0 });
    }
    if (moved.stumbled) this.events.push({ type: 'stumble', x: w.x });

    const slash = this.katana.update(dt, s, w.facing, w.stun <= 0 && !w.kicking && !w.rolling, w.x, 1.5);
    if (slash === 'start') {
      w.facing = this.katana.facing;
      for (const arc of this.katana.arcs(w.x, 0, s)) {
        this.events.push({ type: 'slash', x: w.x, y: 0, side: arc.side });
      }
    } else if (slash === 'whiff') {
      this.events.push({ type: 'whiff', x: w.x });
    }

    this.celestial.update(dt, w, this.katana, s, (delta) => {
      this.dryness = Math.max(0, Math.min(100, this.dryness + delta));
      if (delta < 0) {
        this.combo = 0;
        this.stats.hits++;
        w.stun = 0.15;
      }
    });

    for (const e of this.celestial.events) {
      if (e.type === 'demon_spawn') this.events.push({ type: 'demon_spawn', id: e.id!, x: e.x!, y: e.y!, kind: e.kind! });
      else if (e.type === 'demon_slain') {
        this.combo++;
        this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
        this.stats.cut++;
        this.gain(e.points! / 2);
        this.events.push({ type: 'demon_slain', id: e.id!, x: e.x!, y: e.y!, points: e.points!, kind: e.kind });
      } else if (e.type === 'angel_spawn') {
        this.events.push({ type: 'angel_spawn', id: e.id!, x: e.x!, y: e.y! });
      } else if (e.type === 'angel_bless') {
        this.events.push({ type: 'angel_bless', id: e.id, x: e.x!, y: e.y! });
      } else if (e.type === 'angel_struck') {
        this.combo = 0;
        this.events.push({ type: 'angel_struck', id: e.id, x: e.x!, y: e.y! });
      } else if (e.type === 'light_blade_start') {
        this.events.push({ type: 'light_blade_start' });
      } else if (e.type === 'light_blade_end') {
        this.events.push({ type: 'light_blade_end' });
      }
    }
    this.celestial.events.length = 0;

    if (this.dryness <= 0) {
      if (this.sandbox.active && this.sandbox.godMode) {
        this.dryness = 100;
      } else {
        this.dryness = 0;
        this.phase = 'over';
        this.events.push({ type: 'over' });
      }
    }
  }

  private stepWaves(dt: number): void {
    this.waves.update(dt);
    for (const e of this.waves.events) {
      if (e.type === 'wave') this.events.push({ type: 'wave', wave: e.wave, name: e.name, duration: e.duration });
      else if (e.type === 'front') this.events.push(e);
      else {
        const exp = 40 + 15 * e.wave;
        this.stats.wavesCleared++;
        // Between waves the planks are lashed back and the holes close.
        const repaired = this.bridge.repairAll();
        this.snow.setOpen(0, BRIDGE_LENGTH, false);
        this.gain(exp);
        this.events.push({ type: 'clear', wave: e.wave, exp, repaired });
        if (e.wave === 50) {
          this.triggerAtomicCleave();
        }
      }
    }
    this.waves.events.length = 0;
  }

  private cut(): void {
    const w = this.warrior;
    const k = this.katana;
    const swing = k.swing;
    const active = k.active;
    for (const arc of k.arcs(w.x, this.feetY, this.stance)) {
      for (const d of this.drops) {
        if (d.dead || d.touchedBy === swing) continue;
        // The wake only catches light water.
        if (!active && (d.kind === 'hail' || d.r > WAKE_MAX_R)) continue;
        if (!sweptHits(d, arc.x0, arc.x1, arc.y0, arc.y1)) continue;
        d.touchedBy = swing;
        if (d.kind === 'hail') {
          k.hits++;
          const rel = d.y - this.feetY;
          if (Math.abs(d.x - arc.sweet) <= SWEET_HALF_WIDTH && rel >= SWEET_LOW && rel <= SWEET_HIGH) {
            this.slice(d, false);
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
        if (active) k.hits++;
        this.slice(d, !active);
        if (this.stance.flame) this.steam(d.x, d.y);
      }
    }
  }

  private slice(d: Drop, wake: boolean): void {
    d.dead = true;
    this.combo++;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    this.stats.cut++;
    this.gain(expOf(d));
    this.events.push({ type: 'cut', x: d.x, y: d.y, z: d.z, kind: d.kind, r: d.r, wake });
  }

  /** A burning edge flashes a cut drop into steam that takes the light water around it too. */
  private steam(x: number, y: number): void {
    this.events.push({ type: 'steam', x, y });
    for (const d of this.drops) {
      if (d.dead || d.kind === 'hail') continue;
      if (Math.hypot(d.x - x, d.y - y) <= STEAM_RADIUS) this.slice(d, true);
    }
  }

  focusCut(): void {
    let count = 0;
    for (const d of this.drops) {
      if (d.dead) continue;
      this.slice(d, false);
      count++;
    }
    this.focusCooldown = FOCUS_CUT_COOLDOWN;
    this.events.push({ type: 'focus', x: this.warrior.x, count });
  }

  private collide(): void {
    const w = this.warrior;
    if (w.invulnerable) return;
    const feet = this.feetY;
    const x0 = w.x - HALF_WIDTH;
    const x1 = w.x + HALF_WIDTH;
    for (const d of this.drops) {
      if (d.dead || !sweptHits(d, x0, x1, feet, feet + w.height)) continue;
      d.dead = true;
      const { damage, shatter } = incomingDamage(d.kind, damageOf(d), this.stance, {
        shieldUp: this.shieldUp,
        vulnerable: this.vulnerable,
        exposed: this.exposed,
      });
      this.dryness -= damage;
      this.combo = 0;
      this.stats.hits++;
      w.stun = Math.max(w.stun, PROFILES[d.kind].stun);
      this.events.push({ type: 'hit', x: d.x, y: d.y, kind: d.kind, damage });
      if (d.kind === 'hail') this.bridge.impulse(w.x, 0.1);
      if (shatter) {
        this.shieldUp = false;
        this.shieldReform = SHIELD_REFORM_TIME;
        this.vulnerable = VULNERABLE_TIME;
        this.events.push({ type: 'shatter', x: w.x, y: feet + 1 });
      }
    }
  }

  /** Drops reaching the deck (or the snow on it) land; over a hole or past the anchors they keep falling. */
  private land(): void {
    for (const d of this.drops) {
      if (d.dead || d.x < 0 || d.x >= BRIDGE_LENGTH || this.bridge.isOpen(d.x)) continue;
      const { ry } = extents(d);
      const deck = this.bridge.deckY(d.x);
      const snow = this.snow.depthAt(d.x);
      const surface = deck + snow;
      // Only drops coming down from above land; something already below the deck stays below.
      if (d.y - ry > surface || d.py - ry < deck - 0.4) continue;
      d.dead = true;
      this.events.push({ type: 'land', x: d.x, y: surface, z: d.z, kind: d.kind, r: d.r, onSnow: snow > 0.02 });
      if (d.kind === 'snow') {
        this.snow.deposit(d.x, Math.PI * d.r * d.r);
      } else if (d.kind === 'rain') {
        if (snow > 0) this.snow.meltAt(d.x, RAIN_MELT);
      } else if (d.kind === 'hail') {
        this.bridge.impulse(d.x, 0.22 * (d.r / 0.6) ** 2);
        const index = this.bridge.plankIndex(d.x);
        const result = this.bridge.damagePlank(index, d.r > 0.62 ? 2 : 1);
        if (result) {
          const plank = this.bridge.planks[index];
          this.events.push({ type: 'plank', index, x: plank.x, y: deck, damage: result, health: plank.health });
          if (result === 'break') {
            this.stats.planksLost++;
            this.snow.setOpen(plank.x - PLANK_PITCH / 2, plank.x + PLANK_PITCH / 2, true);
          }
        }
      }
    }
  }

  /** For tests and the debug hook. */
  spawn(kind: DropKind, x: number, y: number, r?: number, vx = 0, vy = PROFILES[kind].terminal): Drop {
    const d = makeDrop(kind, x, y, vx, vy, r);
    this.storm.drops.push(d);
    return d;
  }
}
