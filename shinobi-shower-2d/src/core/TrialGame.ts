import { BladeTime } from '../combat/BladeTime.ts';
import { KatanaSlice } from '../combat/KatanaSlice.ts';
import { BEAT, Stream } from '../hazards/ShowerStreamEmitter.ts';
import { TileHazardGrid } from '../hazards/TileHazardGrid.ts';
import { burstMist, cleave, makeDroplet, stepDroplet, stepHalf } from '../hazards/WaterDroplet.ts';
import type { Droplet, DropletHalf, MistMote } from '../hazards/WaterDroplet.ts';
import { pickAnchor } from '../parkour/GrappleWire.ts';
import { NinjaController, STAND_HEIGHT, IDLE_INTENT } from '../parkour/NinjaController.ts';
import type { NinjaIntent } from '../parkour/NinjaController.ts';
import { raycast } from '../parkour/WallRunDetector.ts';
import { Level, WATER_LEVEL } from './Level.ts';
import type { BouncerSpec } from './Level.ts';
import { dist, mulberry32, sub, norm, v3 } from './Vec.ts';
import type { Rng, Vec3 } from './Vec.ts';

const COST = { droplet: 14, stream: 24, flood: 30 };
const HIT_GRACE = 0.6;
const GRAZE_RANGE = 1.1;
const DROPLET_HEIGHT = 18;
const DROPLET_RADIUS = 0.42;
const PARRY_TIME = 0.4;
/** Half of the 60 degree safe corridor. */
const PARRY_CONE = Math.cos((30 * Math.PI) / 180);
const CHECKPOINT_REFILL = 30;
const BOUNCER_RESPAWN = 2.5;

export type Phase = 'menu' | 'playing' | 'paused' | 'failed' | 'finished';
export type EventType =
  | 'slash' | 'cleave' | 'parry' | 'hit' | 'graze' | 'splash' | 'beat' | 'jump' | 'land' | 'slide' | 'wall'
  | 'slip' | 'rail' | 'dash' | 'wire' | 'bounce' | 'pop' | 'stage' | 'flood' | 'failed' | 'finished';

export interface GameEvent {
  type: EventType;
  x: number;
  y: number;
  z: number;
  value: number;
}

export interface Bouncer {
  spec: BouncerSpec;
  pos: Vec3;
  /** Seconds until a popped bubble returns. 0 means it is here. */
  gone: number;
  squash: number;
}

export interface SliceInput {
  pressed: boolean;
  held: boolean;
}

export class TrialGame {
  phase: Phase = 'menu';
  hardcore = false;
  /** Tests turn this off to check the course on its own. */
  hazardsOn = true;
  time = 0;
  elapsed = 0;
  dryness = 100;
  stains = 0;
  slices = 0;
  retries = 0;
  stage = 0;
  corridor = 0;
  corridorDir = v3(0, 0, -1);
  wireTarget: Vec3 | null = null;

  readonly level = new Level();
  readonly grid = new TileHazardGrid();
  readonly ninja = new NinjaController();
  readonly katana = new KatanaSlice();
  readonly blade = new BladeTime();
  readonly streams: Stream[];
  readonly bouncers: Bouncer[];
  droplets: Droplet[] = [];
  halves: DropletHalf[] = [];
  mist: MistMote[] = [];
  readonly events: GameEvent[] = [];

  private readonly rng: Rng;
  private readonly grazed = new WeakSet<Droplet>();
  private readonly intent: NinjaIntent = { ...IDLE_INTENT };
  private dropletTimer = 2;
  private beat = 0;
  private wasHeld = false;

  constructor(rng: Rng = mulberry32((Math.random() * 2 ** 32) >>> 0)) {
    this.rng = rng;
    this.streams = this.level.streams.map((s) => new Stream(s));
    this.bouncers = this.level.bouncers.map((spec) => ({ spec, pos: v3(spec.pos.x, spec.pos.y, spec.pos.z), gone: 0, squash: 0 }));
    this.placeAtStage(0);
  }

  private emit(type: EventType, p: Vec3, value = 1): void {
    if (this.events.length < 128) this.events.push({ type, x: p.x, y: p.y, z: p.z, value });
  }

  start(hardcore: boolean): void {
    this.hardcore = hardcore;
    this.phase = 'playing';
    this.elapsed = 0;
    this.stains = 0;
    this.slices = 0;
    this.retries = 0;
    this.stage = 0;
    this.grid.reset();
    this.respawn(true);
  }

  /** Back to the last checkpoint with a fresh gauge. */
  retry(): void {
    this.retries++;
    this.phase = 'playing';
    this.respawn(true);
  }

  private respawn(refill: boolean): void {
    if (refill) this.dryness = 100;
    this.placeAtStage(this.stage);
    this.droplets = [];
    this.halves = [];
    this.dropletTimer = 1.5;
    this.blade.reset();
    this.corridor = 0;
    this.wasHeld = false;
  }

  private placeAtStage(i: number): void {
    const s = this.level.stages[i];
    this.ninja.reset(s.spawn, s.facing);
  }

  /** Runs one step. Real time goes in, and blade time decides how much game time passes. */
  step(realDt: number, intent: NinjaIntent, slice: SliceInput): void {
    if (this.phase !== 'playing' && this.phase !== 'menu') return;
    const live = this.phase === 'playing';

    this.blade.update(realDt, live && slice.held, live && this.ninja.airborne);
    const dt = realDt * this.blade.scale;
    this.time += dt;
    if (live) this.elapsed += realDt;

    this.level.update(this.time);
    this.grid.update(dt);
    for (const s of this.streams) s.update(this.time, this.level);
    this.tickBeat();
    this.stepEffects(dt);
    this.stepBouncers(dt);

    if (!live) return;

    const look = v3(intent.aimX, intent.aimY, 0);
    this.wireTarget = pickAnchor(this.ninja.center, look, this.level.anchors);
    Object.assign(this.intent, intent);
    this.intent.wireTarget = this.wireTarget;
    const ev = this.ninja.step(dt, this.intent, this.level, this.grid);
    this.relayMoves(ev);

    // A press swings. Letting go after a blade-time hold swings again, so you can line up the cut.
    const released = this.wasHeld && !slice.held && this.blade.active;
    this.wasHeld = slice.held;
    if ((slice.pressed || released) && this.katana.swing()) this.emit('slash', this.ninja.eye, this.katana.side);
    this.katana.update(dt);
    this.corridor = Math.max(0, this.corridor - dt);

    if (this.hazardsOn) {
      this.spawnDroplets(dt);
      this.stepDroplets(dt, look);
      this.stepStreams(look);
    }
    this.touchBouncers(look);
    this.checkProgress();
  }

  private relayMoves(ev: NinjaController['events']): void {
    const p = this.ninja.pos;
    if (ev.jumped) this.emit('jump', p);
    if (ev.landed > 0) this.emit('land', p, Math.min(1, ev.landed / 20));
    if (ev.slideStart) this.emit('slide', p);
    if (ev.wallStart) this.emit('wall', p);
    if (ev.wallSlip) this.emit('slip', p);
    if (ev.railStart) this.emit('rail', p);
    if (ev.dashed) this.emit('dash', p);
    if (ev.wireAttached) this.emit('wire', p);
  }

  /** Each beat sounds a drip, panned to the nearest stream so you can follow it through steam. */
  private tickBeat(): void {
    const beat = Math.floor(this.time / BEAT);
    if (beat === this.beat) return;
    this.beat = beat;
    let nearest: Stream | null = null;
    let best = 26;
    for (const s of this.streams) {
      if (s.spec.sweepRadius > 0) continue;
      const d = dist(s.spec.target, this.ninja.pos);
      if (d < best) {
        best = d;
        nearest = s;
      }
    }
    // The value marks the beat right before a stream comes on, which gets a brighter drip.
    let warn = 0;
    if (nearest) {
      const s = nearest.spec;
      const next = ((beat + 1 + s.beatOffset) % s.periodBeats + s.periodBeats) % s.periodBeats;
      if (next < 1) warn = 1;
    }
    this.emit('beat', nearest ? nearest.spec.target : this.ninja.pos, warn);
  }

  private stepEffects(dt: number): void {
    this.halves = this.halves.filter((h) => stepHalf(h, dt));
    for (const m of this.mist) {
      m.age += dt;
      m.pos.x += m.vel.x * dt;
      m.pos.y += m.vel.y * dt;
      m.pos.z += m.vel.z * dt;
    }
    this.mist = this.mist.filter((m) => m.age < m.life);
  }

  private stepBouncers(dt: number): void {
    for (const b of this.bouncers) {
      b.gone = Math.max(0, b.gone - dt);
      b.squash = Math.max(0, b.squash - dt * 3);
      b.pos.y = b.spec.pos.y + Math.sin(this.time * 1.8 + b.spec.pos.x) * 0.22;
    }
  }

  private spawnDroplets(dt: number): void {
    this.dropletTimer -= dt;
    if (this.dropletTimer > 0) return;
    this.dropletTimer = this.level.stages[this.stage].dropletEvery * (0.75 + this.rng() * 0.5);
    const n = this.ninja;
    // Aim ahead of the ninja's run, so the droplets arrive at about where they're going.
    const lead = 0.9;
    const x = n.pos.x + n.vel.x * lead + (this.rng() - 0.5) * 7;
    const from = v3(x, n.pos.y + DROPLET_HEIGHT, 0);
    const hit = raycast(this.level, from, v3(0, -1, 0), 80);
    this.droplets.push(makeDroplet(from, DROPLET_RADIUS, hit ? from.y - hit.t : WATER_LEVEL));
  }

  private stepDroplets(dt: number, look: Vec3): void {
    const n = this.ninja;
    const min = n.boxMin;
    const max = n.boxMax;
    const eye = n.eye;
    const kept: Droplet[] = [];
    for (const d of this.droplets) {
      stepDroplet(d, dt);
      const cut = this.katana.cuts(eye, look, d.pos, d.r);
      if (cut) {
        this.cut(d, cut);
        n.refillAirDash();
        continue;
      }
      if (d.pos.y - d.r <= d.landY) {
        this.grid.wet(d.pos, v3(0, 1, 0));
        burstMist(this.mist, v3(d.pos.x, d.landY + 0.1, d.pos.z), 8, this.rng);
        this.emit('splash', d.pos, 0.6);
        continue;
      }
      const dx = Math.max(min.x - d.pos.x, 0, d.pos.x - max.x);
      const dy = Math.max(min.y - d.pos.y, 0, d.pos.y - max.y);
      const dz = Math.max(min.z - d.pos.z, 0, d.pos.z - max.z);
      const gap = Math.hypot(dx, dy, dz);
      if (gap < d.r) {
        if (n.iframes > 0) {
          // The iai dash pierces whatever it passes through.
          this.cut(d, v3(0, 1, 0));
          continue;
        }
        this.takeHit(COST.droplet, d.pos);
        burstMist(this.mist, d.pos, 10, this.rng);
        continue;
      }
      if (gap < GRAZE_RANGE && !this.grazed.has(d)) {
        this.grazed.add(d);
        this.emit('graze', d.pos);
      }
      kept.push(d);
    }
    this.droplets = kept;
  }

  private cut(d: Droplet, planeNormal: Vec3): void {
    if (this.halves.length < 30) this.halves.push(...cleave(d, planeNormal));
    burstMist(this.mist, d.pos, 14, this.rng);
    this.slices++;
    this.emit('cleave', d.pos);
  }

  private stepStreams(look: Vec3): void {
    const n = this.ninja;
    const min = n.boxMin;
    const max = n.boxMax;
    const eye = n.eye;
    for (const s of this.streams) {
      if (s.on) this.grid.wet(s.end, s.endNormal);
      // A parried stream parts around you. The water stops short of you inside the 60 degree corridor.
      if (this.corridor > 0 && s.on) {
        const along = (eye.x - s.spec.origin.x) * s.dir.x + (eye.y - s.spec.origin.y) * s.dir.y + (eye.z - s.spec.origin.z) * s.dir.z;
        const point = v3(s.spec.origin.x + s.dir.x * along, s.spec.origin.y + s.dir.y * along, s.spec.origin.z + s.dir.z * along);
        const to = norm(sub(point, eye));
        if (to.x * this.corridorDir.x + to.y * this.corridorDir.y + to.z * this.corridorDir.z > PARRY_CONE && dist(point, eye) < 8) {
          s.blockedAt = Math.max(0, along - 2.2);
        }
      }
      const contact = s.touches(min, max);
      if (!contact) {
        if (this.katana.swinging && s.on) this.tryParry(s, look, eye);
        continue;
      }
      if (n.iframes > 0) continue;
      if (this.katana.faces(look, norm(sub(contact, eye)))) {
        this.startCorridor(look, contact);
        continue;
      }
      this.takeHit(COST.stream, contact);
    }
  }

  private tryParry(s: Stream, look: Vec3, eye: Vec3): void {
    const along = (eye.x - s.spec.origin.x) * s.dir.x + (eye.y - s.spec.origin.y) * s.dir.y + (eye.z - s.spec.origin.z) * s.dir.z;
    if (along < 0 || along > s.length) return;
    const point = v3(s.spec.origin.x + s.dir.x * along, s.spec.origin.y + s.dir.y * along, s.spec.origin.z + s.dir.z * along);
    if (dist(point, eye) < 3.2 && this.katana.faces(look, norm(sub(point, eye))) && this.corridor <= 0) this.startCorridor(look, point);
  }

  private startCorridor(look: Vec3, at: Vec3): void {
    this.corridor = PARRY_TIME;
    this.corridorDir = v3(look.x, look.y, look.z);
    this.emit('parry', at);
  }

  private touchBouncers(look: Vec3): void {
    const n = this.ninja;
    const center = v3(n.pos.x, n.pos.y + STAND_HEIGHT * 0.3, 0);
    for (const b of this.bouncers) {
      if (b.gone > 0) continue;
      const cut = this.katana.cuts(n.eye, look, b.pos, b.spec.r * 0.7);
      if (cut) {
        b.gone = BOUNCER_RESPAWN;
        burstMist(this.mist, b.pos, 22, this.rng);
        n.refillAirDash();
        this.emit('pop', b.pos);
        continue;
      }
      if (dist(center, b.pos) < b.spec.r + 0.55 && n.vel.y < 6) {
        n.bounce(b.spec.power);
        b.squash = 1;
        this.emit('bounce', b.pos);
      }
    }
  }

  private takeHit(cost: number, at: Vec3): void {
    const n = this.ninja;
    if (n.iframes > 0) return;
    this.stains++;
    this.dryness = this.hardcore ? 0 : Math.max(0, this.dryness - cost);
    n.iframes = HIT_GRACE;
    this.emit('hit', at, cost);
    if (this.dryness <= 0) this.fail();
  }

  private fail(): void {
    this.phase = 'failed';
    this.emit('failed', this.ninja.pos);
  }

  private checkProgress(): void {
    const n = this.ninja;
    if (n.pos.y <= WATER_LEVEL + 0.1) {
      this.stains++;
      this.dryness = this.hardcore ? 0 : Math.max(0, this.dryness - COST.flood);
      this.emit('flood', n.pos);
      if (this.dryness <= 0) {
        this.fail();
        return;
      }
      this.respawn(false);
      return;
    }
    const reached = this.level.stageAt(n.pos);
    if (reached > this.stage) {
      this.stage = reached;
      this.dryness = Math.min(100, this.dryness + CHECKPOINT_REFILL);
      this.emit('stage', n.pos, reached);
    }
    if (dist(n.center, this.level.goal) < this.level.goalRadius) {
      this.phase = 'finished';
      this.emit('finished', n.pos);
    }
  }
}

/** The master's verdict on a finished run. */
export function rankOf(stains: number, retries: number): { rank: string; title: string } {
  if (stains === 0 && retries === 0) return { rank: 'S', title: 'The Dry Blade' };
  if (stains <= 2 && retries === 0) return { rank: 'A', title: 'Barely damp' };
  if (stains <= 6) return { rank: 'B', title: 'Visibly moist' };
  return { rank: 'C', title: 'Soaked, but standing' };
}
