import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import { mulberry32 } from '../core/Rng.ts';
import { DebrisPool, DebrisSpec } from './fx/DebrisPool.ts';
import { PIECE, debrisGeometry, debrisMaterial, hailHalfGeometry } from './fx/debrisShapes.ts';
import { FOCUS_LIFT, FocusStreak } from './fx/FocusStreak.ts';
import { softLayerOf } from './fx/SoftLayer.ts';
import { SHAPE, SpritePool, SpriteSpec } from './fx/SpritePool.ts';
import type { RenderContext, RenderModule } from './RenderContext.ts';
import { worldX } from './RenderContext.ts';

/** Height of the swing's pivot above the feet, where the blade turns (as the warrior draws it). */
const SWING_PIVOT = 1.5;
/** Cuts remembered per frame; a focus cut can make hundreds, the rest are sampled. */
const MAX_CUTS = 160;
/** Roughly how many cuts per frame get the full spray; beyond that each gets a share. */
const CUT_BUDGET = 36;
/** Kinds of drop, as stored in the cut buffer. */
const KIND = { drizzle: 0, rain: 1, snow: 2, hail: 3 } as const;

/** Linear colours. */
const WATER = new THREE.Color(0.8, 0.95, 1.25).multiplyScalar(1.5);
const SNOW = new THREE.Color(0.86, 0.9, 0.97);
const ICE = new THREE.Color(0.3, 0.42, 0.56);
const SPIRIT = new THREE.Color(0.62, 0.42, 1.0);
const WOOD_OLD = new THREE.Color(0.16, 0.135, 0.11);
const WOOD_FRESH = new THREE.Color(0.36, 0.27, 0.17);

/**
 * One-shot effects driven by the simulation's events, all from fixed pools (nothing is allocated per
 * event), in at most four draw calls:
 *   - sprites (SpritePool, soft layer): spray, steam, mist, dust, powder, sparks, glints, flashes,
 *     spirit fragments; one draw for all of them
 *   - debris (DebrisPool, lit): ice shards and chips, splinters, snow chunks; one draw
 *   - hail halves (DebrisPool, lit): a perfectly cut stone falling apart; one draw
 *   - the focus cut's streak across the sky (FocusStreak); one draw
 * Events carry lane coordinates; the warrior and the deck sway sideways with the bridge, so effects
 * on the deck take its lateral offset, and drops in the air keep their own z.
 */
export class VFX implements RenderModule {
  private readonly ctx: RenderContext;
  private readonly sprites: SpritePool;
  private readonly debris: DebrisPool;
  private readonly halves: DebrisPool;
  private readonly streak: FocusStreak;
  /** Particle count scale: 'low' quality draws about half. */
  private readonly k: number;
  private readonly rand = mulberry32(0x7f4a7c15);
  private readonly s = new SpriteSpec();
  private readonly d = new DebrisSpec();
  /** This frame's cuts, sprayed in `update` once their number is known (struct of arrays). */
  private readonly cutX = new Float32Array(MAX_CUTS);
  private readonly cutY = new Float32Array(MAX_CUTS);
  private readonly cutZ = new Float32Array(MAX_CUTS);
  private readonly cutR = new Float32Array(MAX_CUTS);
  private readonly cutKind = new Uint8Array(MAX_CUTS);
  private readonly cutWake = new Uint8Array(MAX_CUTS);
  private cuts = 0;
  private cutsSeen = 0;
  private moon: THREE.DirectionalLight | null = null;
  private moonSearch = 0;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly n = new THREE.Vector3();

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    const low = ctx.quality === 'low';
    this.k = low ? 0.5 : 1;
    const u = ctx.uniforms;
    this.sprites = new SpritePool(softLayerOf(ctx.scene), low ? 900 : 2000, { uWind: u.uWind, uLightning: u.uLightning });
    this.debris = new DebrisPool(debrisGeometry(), debrisMaterial(u, false), low ? 96 : 200, this.rand);
    this.debris.mesh.name = 'vfx-debris';
    this.halves = new DebrisPool(hailHalfGeometry(low ? 2 : 3), debrisMaterial(u, true), low ? 6 : 10, this.rand);
    this.halves.mesh.name = 'vfx-hail-halves';
    this.streak = new FocusStreak();
    ctx.scene.add(this.debris.mesh, this.halves.mesh, this.streak.mesh);
  }

  /* ---------------- Helpers ---------------- */

  private r(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rand();
  }

  /** A count scaled for quality, rounded at random so fractions still show up on average. */
  private count(base: number): number {
    const n = base * this.k;
    return Math.floor(n + this.rand());
  }

  /** A sprite spec reset to a plain, still, short-lived particle at (x, y, z). */
  private sprite(shape: number, x: number, y: number, z: number): SpriteSpec {
    const s = this.s;
    s.shape = shape;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = s.vy = s.vz = 0;
    s.life = 1;
    s.delay = 0;
    s.size0 = s.size1 = 0.1;
    s.drag = 0;
    s.gravity = 0;
    s.spin = 0;
    s.seed = this.rand();
    s.color(1, 1, 1, 0).glow(0, 0, 0, 4);
    return s;
  }

  /** A debris spec reset to a plain piece at (x, y, z). */
  private piece(variant: number, x: number, y: number, z: number): DebrisSpec {
    const d = this.d;
    d.variant = variant;
    d.x = x;
    d.y = y;
    d.z = z;
    d.vx = d.vy = d.vz = 0;
    d.size(0.05);
    d.spin = this.r(6, 16);
    d.life = 1.2;
    d.bounce = 0.3;
    d.drag = 0.3;
    d.gravity = 9.8;
    d.color(1, 1, 1);
    d.roughness = 0.8;
    d.ice = 0;
    d.glow = 0;
    d.glowRate = 6;
    d.orientation.identity();
    d.angle = this.rand() * Math.PI * 2;
    return d;
  }

  /** Sets a random velocity: `speed` in a random direction, plus (bx, by, bz). */
  private scatter(o: SpriteSpec | DebrisSpec, speed: number, bx = 0, by = 0, bz = 0): void {
    const z = this.rand() * 2 - 1;
    const a = this.rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    o.vx = Math.cos(a) * r * speed + bx;
    o.vy = Math.sin(a) * r * speed + by;
    o.vz = z * speed + bz;
  }

  /* ---------------- Events ---------------- */

  handleEvent(e: GameEvent, game: Game): void {
    switch (e.type) {
      case 'cut':
        this.queueCut(e.x, e.y, e.z, KIND[e.kind], e.r, e.wake);
        break;
      case 'perfect':
        this.perfect(e.x, e.y, e.r, game);
        break;
      case 'clang':
        this.clang(e.x, e.y, game);
        break;
      case 'steam':
        this.steam(e.x, e.y);
        break;
      case 'melt':
        this.melt(e.x0, e.x1, e.y, e.area, game);
        break;
      case 'hit':
        this.hit(e.x, e.y, e.kind === 'hail' ? 2 : e.kind === 'snow' ? 1 : 0, e.damage, game);
        break;
      case 'shatter':
        this.shatter(e.x, e.y, game);
        break;
      case 'plank':
        this.plank(e.x, e.y, e.damage === 'break', game);
        break;
      case 'kick':
        this.kick(e.x, e.dir, e.area, game);
        break;
      case 'land':
        if (e.kind === 'hail') this.hailLands(e.x, e.y, e.z, e.r, e.onSnow, game);
        break;
      case 'focus':
        this.focus(e.x, game);
        break;
      default:
        break;
    }
  }

  /** Cuts wait for `update`, where the frame's total decides how much spray each gets. */
  private queueCut(x: number, y: number, z: number, kind: number, r: number, wake: boolean): void {
    this.cutsSeen++;
    let i = this.cuts;
    if (i >= MAX_CUTS) {
      // Keep a fair sample of a flood of cuts (reservoir sampling); hail is never dropped.
      const j = Math.floor(this.rand() * this.cutsSeen);
      if (j >= MAX_CUTS && kind !== KIND.hail) return;
      i = j < MAX_CUTS ? j : Math.floor(this.rand() * MAX_CUTS);
    } else {
      this.cuts++;
    }
    this.cutX[i] = x;
    this.cutY[i] = y;
    this.cutZ[i] = z;
    this.cutR[i] = r;
    this.cutKind[i] = kind;
    this.cutWake[i] = wake ? 1 : 0;
  }

  /** The direction the blade was moving through (x, y): along the swing's arc round the pivot. */
  private bladeDir(x: number, y: number, game: Game): [number, number] {
    const w = game.warrior;
    const k = game.katana;
    const dx = x - w.x;
    const dy = y - (game.feetY + SWING_PIVOT);
    const len = Math.hypot(dx, dy) || 1;
    const side = dx === 0 ? k.facing : Math.sign(dx);
    // Odd swings cut down from overhead, even ones rise from the feet (as the warrior draws them).
    const down = k.swing % 2 === 1 ? 1 : -1;
    return [(side * down * dy) / len, (-side * down * dx) / len];
  }

  /** Fine spray flung along the blade (rain, mist), or a puff of powder (snow). */
  private sprayCut(x: number, y: number, z: number, kind: number, r: number, wake: boolean, share: number, game: Game): void {
    const wx = worldX(x);
    const swinging = game.katana.t >= 0;
    const [tx, ty] = swinging ? this.bladeDir(x, y, game) : [0, 0];
    if (kind === KIND.rain || kind === KIND.drizzle) {
      const n = Math.floor(((kind === KIND.rain ? 7 : 3) * (wake ? 0.5 : 1) * this.k) * share + this.rand());
      for (let i = 0; i < n; i++) {
        const s = this.sprite(SHAPE.STREAK, wx, y, z);
        const v = this.r(2.5, 6.5);
        if (swinging) this.scatter(s, this.r(0.4, 1.6), tx * v, ty * v - 1.5, 0);
        else this.scatter(s, this.r(2, 5), 0, -1, 0);
        s.life = this.r(0.22, 0.42);
        s.size0 = s.size1 = this.r(0.006, 0.012);
        s.drag = 2.2;
        s.gravity = 9.8;
        s.color(WATER.r, WATER.g, WATER.b, 0);
        this.sprites.emit(s);
      }
      // A breath of fine mist where the drop burst.
      if (kind === KIND.rain && this.rand() < 0.6 * share) {
        const s = this.sprite(SHAPE.PUFF, wx, y, z);
        s.vx = tx * 1.2;
        s.vy = ty * 1.2;
        s.life = this.r(0.4, 0.6);
        s.size0 = 0.06;
        s.size1 = this.r(0.22, 0.32);
        s.drag = 3;
        s.spin = this.r(-1, 1);
        s.color(0.55, 0.62, 0.75, 0.16);
        this.sprites.emit(s);
      }
    } else if (kind === KIND.snow) {
      const puffs = Math.max(1, Math.floor((1 + r * 3) * this.k * share + this.rand()));
      for (let i = 0; i < puffs; i++) {
        const s = this.sprite(SHAPE.PUFF, wx + this.r(-0.3, 0.3) * r, y + this.r(-0.2, 0.2) * r, z);
        this.scatter(s, this.r(0.3, 1.0), tx * 1.5, ty * 1.5, 0);
        s.life = this.r(0.6, 1.0);
        s.size0 = r * 0.5;
        s.size1 = r * this.r(1.3, 1.9) + 0.15;
        s.drag = 2.5;
        s.gravity = 0.6;
        s.spin = this.r(-1.2, 1.2);
        s.color(SNOW.r, SNOW.g, SNOW.b, 0.55);
        this.sprites.emit(s);
      }
      const grains = Math.floor((3 + r * 10) * this.k * share + this.rand());
      for (let i = 0; i < grains; i++) {
        const s = this.sprite(SHAPE.STREAK, wx, y, z);
        this.scatter(s, this.r(1, 3.5) * (0.6 + r), tx * 2, ty * 2, 0);
        s.life = this.r(0.3, 0.6);
        s.size0 = s.size1 = this.r(0.008, 0.016);
        s.drag = 3;
        s.gravity = 3;
        s.color(1.1, 1.15, 1.25, 0.3);
        this.sprites.emit(s);
      }
      // A big clump breaks into lumps that fall to the deck.
      if (r > 0.3 && share > 0.5) {
        const lumps = this.count(2 + r * 5);
        for (let i = 0; i < lumps; i++) {
          const d = this.piece(PIECE.CHUNK, wx + this.r(-0.4, 0.4) * r, y, z + this.r(-0.2, 0.2));
          this.scatter(d, this.r(0.5, 2), tx * 2.5, ty * 2.5 + 0.5, 0);
          d.size(r * this.r(0.12, 0.22));
          d.color(SNOW.r, SNOW.g, SNOW.b);
          d.roughness = 0.95;
          d.bounce = 0.1;
          d.life = this.r(1.2, 1.8);
          this.debris.emit(d);
        }
      }
    }
  }

  /** A stone the blade broke: two halves fly apart along the cut, with shards. */
  private splitStone(x: number, y: number, z: number, r: number, perfect: boolean, game: Game): void {
    const wx = worldX(x);
    const swinging = game.katana.t >= 0;
    let [tx, ty] = swinging ? this.bladeDir(x, y, game) : [0, -1];
    if (tx === 0 && ty === 0) ty = -1;
    // The cut plane holds the blade (radial from the pivot) and the depth axis; its normal is the
    // blade's motion. The half ahead of the blade is driven on, the other kicks back the other way.
    let nx = -tx;
    let ny = -ty;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const lead = tx * nx + ty * ny < 0 ? -1 : 1; // which half (+n or −n) the blade drives
    for (let h = -1; h <= 1; h += 2) {
      this.n.set(nx * h, ny * h, 0);
      const d = this.piece(0, wx + nx * h * r * 0.08, y + ny * h * r * 0.08, z);
      d.orientation.setFromUnitVectors(this.up, this.n);
      d.angle = 0;
      const driven = h === lead;
      const push = driven ? this.r(3.0, 4.2) : this.r(1.2, 2.0);
      d.vx = nx * h * push + tx * (driven ? 2.0 : -0.6) + this.r(-0.4, 0.4);
      d.vy = ny * h * push + ty * (driven ? 2.0 : -0.6) + (driven ? 0 : 1.2);
      d.vz = this.r(-0.8, 0.8);
      d.size(r);
      d.spin = this.r(5, 9);
      d.life = this.r(1.6, 2.1);
      d.bounce = 0.22;
      d.drag = 0.15;
      d.color(ICE.r, ICE.g, ICE.b);
      d.roughness = 0.1;
      d.ice = 1;
      d.glow = perfect ? 1 : 0.4;
      d.glowRate = 7;
      this.halves.emit(d);
    }
    const shards = this.count(perfect ? 10 : 6);
    for (let i = 0; i < shards; i++) {
      const d = this.piece(i % 3 === 2 ? PIECE.CHIP : PIECE.SHARD, wx + this.r(-0.3, 0.3) * r, y + this.r(-0.3, 0.3) * r, z + this.r(-0.2, 0.2));
      this.scatter(d, this.r(2.5, 6), tx * 2, ty * 2 + 1, 0);
      d.size(r * this.r(0.07, 0.13));
      d.color(ICE.r * 1.2, ICE.g * 1.2, ICE.b * 1.2);
      d.roughness = 0.12;
      d.ice = 1;
      d.bounce = 0.35;
      d.drag = 0.6;
      d.life = this.r(0.8, 1.4);
      d.glow = perfect ? 0.3 : 0;
      d.glowRate = 8;
      this.debris.emit(d);
    }
    // Glittering ice dust.
    const glints = this.count(perfect ? 12 : 6);
    for (let i = 0; i < glints; i++) {
      const s = this.sprite(SHAPE.STREAK, wx, y, z);
      this.scatter(s, this.r(3, 8), tx * 2, ty * 2, 0);
      s.life = this.r(0.25, 0.55);
      s.size0 = s.size1 = this.r(0.008, 0.014);
      s.drag = 2.5;
      s.gravity = 6;
      s.color(1.6, 1.85, 2.3, 0);
      this.sprites.emit(s);
    }
  }

  private perfect(x: number, y: number, r: number, game: Game): void {
    // The simulation reports a perfect cut as a 'cut' of the stone and then this event: if that cut is
    // waiting in this frame's buffer, take it over so the stone splits only once.
    for (let i = 0; i < this.cuts; i++) {
      if (this.cutKind[i] === KIND.hail && this.cutX[i] === Math.fround(x) && this.cutY[i] === Math.fround(y)) this.cutKind[i] = 255;
    }
    const wx = worldX(x);
    this.splitStone(x, y, 0, r, true, game);
    // Frost mist where the stone was.
    const mist = this.count(5);
    for (let i = 0; i < mist; i++) {
      const s = this.sprite(SHAPE.PUFF, wx + this.r(-0.3, 0.3) * r, y + this.r(-0.3, 0.3) * r, this.r(-0.2, 0.2));
      this.scatter(s, this.r(0.4, 1.4));
      s.life = this.r(0.8, 1.3);
      s.size0 = r * 0.3;
      s.size1 = r * this.r(1.0, 1.6);
      s.drag = 2.4;
      s.gravity = 0.4;
      s.spin = this.r(-1, 1);
      s.color(0.62, 0.74, 0.92, 0.32);
      s.glow(0.25, 0.35, 0.55, 3);
      this.sprites.emit(s);
    }
    // The flash of the clean cut: a star with long rays, and a round bloom behind it.
    const f = this.sprite(SHAPE.FLARE, wx, y, 0.2);
    f.life = 0.24;
    f.size0 = 1.4 + r;
    f.size1 = 1.9 + r;
    f.color(2.4, 2.7, 3.2, 0);
    this.sprites.emit(f);
    const g = this.sprite(SHAPE.GLOW, wx, y, 0.1);
    g.life = 0.32;
    g.size0 = r * 1.2;
    g.size1 = r * 2.2;
    g.color(0.9, 1.1, 1.5, 0);
    this.sprites.emit(g);
  }

  /** A glancing blow: sparks off the steel and chips of ice. */
  private clang(x: number, y: number, game: Game): void {
    const wx = worldX(x);
    const side = Math.sign(x - game.warrior.x) || game.katana.facing;
    const sparks = this.count(14);
    for (let i = 0; i < sparks; i++) {
      const s = this.sprite(SHAPE.STREAK, wx, y, 0.15);
      const a = this.r(-1.1, 1.1) + (side > 0 ? 0.6 : Math.PI - 0.6);
      const v = this.r(5, 11);
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v + 1.5;
      s.vz = this.r(-2, 2);
      s.life = this.r(0.25, 0.55);
      s.size0 = s.size1 = this.r(0.009, 0.014);
      s.drag = 1.8;
      s.gravity = 9.8;
      s.color(2.4, 0.9, 0.22, 0).glow(3.6, 3.3, 2.6, 7);
      this.sprites.emit(s);
    }
    const g = this.sprite(SHAPE.GLOW, wx, y, 0.2);
    g.life = 0.14;
    g.size0 = 0.3;
    g.size1 = 0.5;
    g.color(2.2, 1.9, 1.5, 0);
    this.sprites.emit(g);
    const chips = this.count(5);
    for (let i = 0; i < chips; i++) {
      const d = this.piece(i % 2 ? PIECE.CHIP : PIECE.SHARD, wx, y, this.r(-0.1, 0.2));
      this.scatter(d, this.r(2, 4.5), side * 2, 1.5, 0);
      d.size(this.r(0.025, 0.045));
      d.color(ICE.r * 1.2, ICE.g * 1.2, ICE.b * 1.2);
      d.roughness = 0.12;
      d.ice = 1;
      d.life = this.r(0.7, 1.1);
      this.debris.emit(d);
    }
  }

  /** A burning edge flashes a drop into steam: puffs lit from within, rising as they cool. */
  private steam(x: number, y: number): void {
    const wx = worldX(x);
    const puffs = this.count(6);
    for (let i = 0; i < puffs; i++) {
      const s = this.sprite(SHAPE.PUFF, wx + this.r(-0.15, 0.15), y + this.r(-0.15, 0.15), this.r(-0.15, 0.25));
      this.scatter(s, this.r(0.3, 0.9), 0, 0.5, 0);
      s.life = this.r(1.0, 1.6);
      s.size0 = this.r(0.08, 0.14);
      s.size1 = this.r(0.45, 0.7);
      s.drag = 1.8;
      s.gravity = -1.1;
      s.spin = this.r(-0.8, 0.8);
      s.color(0.78, 0.8, 0.84, 0.42);
      s.glow(1.1, 0.45, 0.14, 2.6);
      this.sprites.emit(s);
    }
    const embers = this.count(3);
    for (let i = 0; i < embers; i++) {
      const s = this.sprite(SHAPE.STREAK, wx, y, 0.1);
      this.scatter(s, this.r(1, 2.5), 0, 1.2, 0);
      s.life = this.r(0.4, 0.8);
      s.size0 = s.size1 = 0.008;
      s.drag = 1.5;
      s.gravity = -0.5;
      s.color(1.4, 0.5, 0.12, 0).glow(1.5, 1.1, 0.6, 5);
      this.sprites.emit(s);
    }
  }

  /** A burning edge sweeps a drift away: steam blooms along the cleared stretch of deck. */
  private melt(x0: number, x1: number, y: number, area: number, game: Game): void {
    const span = Math.max(0.2, x1 - x0);
    const puffs = Math.min(16, this.count(4 + span * 3 + area * 20));
    for (let i = 0; i < puffs; i++) {
      const x = x0 + this.rand() * span;
      const s = this.sprite(SHAPE.PUFF, worldX(x), y + this.r(0.03, 0.18), game.bridge.lateral(x) + this.r(-0.55, 0.55));
      this.scatter(s, this.r(0.2, 0.6), 0, 0.9, 0);
      s.delay = this.rand() * 0.12;
      s.life = this.r(1.1, 1.8);
      s.size0 = this.r(0.1, 0.18);
      s.size1 = this.r(0.5, 0.8) + Math.min(0.4, area * 1.5);
      s.drag = 1.6;
      s.gravity = -1.3;
      s.spin = this.r(-0.7, 0.7);
      s.color(0.8, 0.82, 0.86, 0.45);
      s.glow(1.2, 0.5, 0.15, 2.2);
      this.sprites.emit(s);
    }
  }

  /** A drop strikes the warrior: a burst of water, or of snow; hail hits hard and shatters. */
  private hit(x: number, y: number, kind: number, damage: number, game: Game): void {
    const wx = worldX(x);
    const z = game.bridge.lateral(game.warrior.x) + 0.15;
    if (kind === 0) {
      const n = this.count(6 + Math.min(8, damage * 3));
      for (let i = 0; i < n; i++) {
        const s = this.sprite(SHAPE.STREAK, wx, y, z);
        this.scatter(s, this.r(1.5, 3.5), 0, 1.8, 0.5);
        s.life = this.r(0.25, 0.45);
        s.size0 = s.size1 = this.r(0.007, 0.012);
        s.drag = 1.2;
        s.gravity = 9.8;
        s.color(WATER.r, WATER.g, WATER.b, 0);
        this.sprites.emit(s);
      }
      const p = this.sprite(SHAPE.PUFF, wx, y, z);
      p.life = 0.5;
      p.size0 = 0.08;
      p.size1 = 0.32;
      p.drag = 3;
      p.color(0.55, 0.62, 0.75, 0.2);
      this.sprites.emit(p);
      return;
    }
    if (kind === 1) {
      const puffs = this.count(4);
      for (let i = 0; i < puffs; i++) {
        const s = this.sprite(SHAPE.PUFF, wx + this.r(-0.2, 0.2), y + this.r(-0.2, 0.2), z);
        this.scatter(s, this.r(0.5, 1.5), 0, 0.6, 0.3);
        s.life = this.r(0.7, 1.1);
        s.size0 = 0.15;
        s.size1 = this.r(0.45, 0.7);
        s.drag = 2.5;
        s.gravity = 0.8;
        s.spin = this.r(-1, 1);
        s.color(SNOW.r, SNOW.g, SNOW.b, 0.6);
        this.sprites.emit(s);
      }
      const lumps = this.count(2 + Math.min(5, damage * 0.3));
      for (let i = 0; i < lumps; i++) {
        const d = this.piece(PIECE.CHUNK, wx, y, z);
        this.scatter(d, this.r(1, 3), 0, 1.5, 0.4);
        d.size(this.r(0.04, 0.09));
        d.color(SNOW.r, SNOW.g, SNOW.b);
        d.roughness = 0.95;
        d.bounce = 0.1;
        this.debris.emit(d);
      }
      return;
    }
    // Hail: an impact that shatters the stone against the warrior.
    const ring = this.sprite(SHAPE.RING, wx, y, z + 0.1);
    ring.life = 0.28;
    ring.size0 = 0.25;
    ring.size1 = 1.5;
    ring.color(0.7, 0.85, 1.1, 0.15);
    this.sprites.emit(ring);
    const g = this.sprite(SHAPE.GLOW, wx, y, z + 0.1);
    g.life = 0.18;
    g.size0 = 0.5;
    g.size1 = 0.8;
    g.color(1.3, 1.5, 1.9, 0);
    this.sprites.emit(g);
    const shards = this.count(12);
    for (let i = 0; i < shards; i++) {
      const d = this.piece(i % 3 === 0 ? PIECE.CHIP : PIECE.SHARD, wx, y, z);
      this.scatter(d, this.r(2.5, 6), 0, 2, 0.8);
      d.size(this.r(0.035, 0.07));
      d.color(ICE.r * 1.2, ICE.g * 1.2, ICE.b * 1.2);
      d.roughness = 0.12;
      d.ice = 1;
      d.bounce = 0.35;
      d.drag = 0.5;
      d.life = this.r(0.9, 1.5);
      this.debris.emit(d);
    }
    const spray = this.count(16);
    for (let i = 0; i < spray; i++) {
      const s = this.sprite(SHAPE.STREAK, wx, y, z);
      this.scatter(s, this.r(3, 7), 0, 1.5, 0.5);
      s.life = this.r(0.25, 0.5);
      s.size0 = s.size1 = this.r(0.008, 0.014);
      s.drag = 1.5;
      s.gravity = 9.8;
      s.color(WATER.r, WATER.g, WATER.b, 0);
      this.sprites.emit(s);
    }
    const mist = this.count(3);
    for (let i = 0; i < mist; i++) {
      const s = this.sprite(SHAPE.PUFF, wx, y, z);
      this.scatter(s, this.r(0.8, 2), 0, 0.3, 0.3);
      s.life = this.r(0.7, 1.0);
      s.size0 = 0.15;
      s.size1 = this.r(0.5, 0.8);
      s.drag = 2.6;
      s.spin = this.r(-1, 1);
      s.color(0.6, 0.7, 0.86, 0.35);
      this.sprites.emit(s);
    }
  }

  /** Hail breaks the spirit shield: violet shards of it fly off and fade. */
  private shatter(x: number, y: number, game: Game): void {
    const cx = worldX(x);
    const cz = game.bridge.lateral(x);
    const n = this.count(36);
    for (let i = 0; i < n; i++) {
      // A point on the bubble (an upright ellipsoid round the warrior), flung outward.
      const zz = this.rand() * 2 - 1;
      const a = this.rand() * Math.PI * 2;
      const rr = Math.sqrt(1 - zz * zz);
      const ox = Math.cos(a) * rr;
      const oy = Math.sin(a) * rr;
      const s = this.sprite(SHAPE.SHARD, cx + ox * 0.95, y - 0.05 + oy * 1.12, cz + zz * 0.95);
      const v = this.r(2.5, 5.5);
      s.vx = ox * v;
      s.vy = oy * v + 0.8;
      s.vz = zz * v;
      s.life = this.r(0.7, 1.2);
      s.size0 = this.r(0.1, 0.2);
      s.size1 = s.size0 * 0.6;
      s.drag = 1.4;
      s.gravity = 2;
      s.spin = this.r(-9, 9);
      const b = this.r(1.8, 3.0);
      s.color(SPIRIT.r * b, SPIRIT.g * b, SPIRIT.b * b, 0).glow(1.3, 1.1, 1.8, 5);
      this.sprites.emit(s);
    }
    const sparkles = this.count(14);
    for (let i = 0; i < sparkles; i++) {
      const s = this.sprite(SHAPE.STREAK, cx, y, cz);
      this.scatter(s, this.r(3, 7), 0, 0.5, 0);
      s.life = this.r(0.3, 0.6);
      s.size0 = s.size1 = 0.01;
      s.drag = 2;
      s.gravity = 1;
      s.color(1.2, 0.9, 2.2, 0);
      this.sprites.emit(s);
    }
    const g = this.sprite(SHAPE.GLOW, cx, y, cz + 0.3);
    g.life = 0.35;
    g.size0 = 1.2;
    g.size1 = 1.8;
    g.color(0.7, 0.45, 1.3, 0);
    this.sprites.emit(g);
    const ring = this.sprite(SHAPE.RING, cx, y, cz + 0.3);
    ring.life = 0.4;
    ring.size0 = 0.9;
    ring.size1 = 2.4;
    ring.color(0.9, 0.6, 1.6, 0);
    this.sprites.emit(ring);
  }

  /** Hail splits a plank: splinters and chips fly, dust hangs; a break throws far more. */
  private plank(x: number, y: number, broke: boolean, game: Game): void {
    const wx = worldX(x);
    const cz = game.bridge.lateral(x);
    const splinters = this.count(broke ? 18 : 5);
    for (let i = 0; i < splinters; i++) {
      const d = this.piece(PIECE.SPLINTER, wx + this.r(-0.1, 0.1), y + 0.02, cz + this.r(-0.65, 0.65));
      this.scatter(d, this.r(1, 3), 0, this.r(1.5, broke ? 5.5 : 3.5), 0);
      const big = broke && this.rand() < 0.3;
      d.size(big ? this.r(0.2, 0.3) : this.r(0.09, 0.18));
      const fresh = this.rand();
      d.color(
        WOOD_OLD.r + (WOOD_FRESH.r - WOOD_OLD.r) * fresh,
        WOOD_OLD.g + (WOOD_FRESH.g - WOOD_OLD.g) * fresh,
        WOOD_OLD.b + (WOOD_FRESH.b - WOOD_OLD.b) * fresh,
      );
      d.roughness = 0.85;
      d.spin = this.r(8, 20);
      d.bounce = 0.3;
      d.drag = 0.4;
      d.life = this.r(1.4, 2.4);
      this.debris.emit(d);
    }
    const chips = this.count(broke ? 8 : 3);
    for (let i = 0; i < chips; i++) {
      const d = this.piece(PIECE.CHIP, wx, y + 0.02, cz + this.r(-0.6, 0.6));
      this.scatter(d, this.r(1.5, 3.5), 0, 2.5, 0);
      d.size(this.r(0.02, 0.04));
      d.color(WOOD_FRESH.r, WOOD_FRESH.g, WOOD_FRESH.b);
      d.roughness = 0.9;
      d.life = this.r(1, 1.8);
      this.debris.emit(d);
    }
    const dust = this.count(broke ? 6 : 2);
    for (let i = 0; i < dust; i++) {
      const below = broke && i % 3 === 2;
      const s = this.sprite(SHAPE.PUFF, wx + this.r(-0.2, 0.2), y + (below ? -0.1 : 0.08), cz + this.r(-0.5, 0.5));
      this.scatter(s, this.r(0.3, 0.9), 0, below ? -1.5 : 0.5, 0);
      s.life = this.r(1.0, 1.6);
      s.size0 = 0.12;
      s.size1 = this.r(0.45, 0.75);
      s.drag = 2;
      s.gravity = below ? 0.5 : -0.15;
      s.spin = this.r(-0.6, 0.6);
      s.color(0.3, 0.27, 0.23, 0.32);
      this.sprites.emit(s);
    }
  }

  /** A kick throws snow off the deck: lumps arc out over the edge and fall into the gorge. */
  private kick(x: number, dir: number, area: number, game: Game): void {
    const b = game.bridge;
    const lumps = Math.min(14, this.count(3 + area * 25));
    for (let i = 0; i < lumps; i++) {
      const lx = x + dir * this.r(0.2, 1.2);
      const d = this.piece(PIECE.CHUNK, worldX(lx), b.deckY(lx) + this.r(0.08, 0.25), b.lateral(lx) + this.r(-0.3, 0.3));
      // Mostly out toward the camera, so the arc reads; some over the far edge.
      const out = this.rand() < 0.7 ? 1 : -1;
      d.vx = dir * this.r(2.5, 5.5);
      d.vy = this.r(2, 4.5);
      d.vz = out * this.r(1.2, 3.2);
      d.size(this.r(0.05, 0.13));
      d.color(SNOW.r, SNOW.g, SNOW.b);
      d.roughness = 0.95;
      d.bounce = 0.12;
      d.drag = 0.25;
      d.life = 2.6;
      this.debris.emit(d);
    }
    const puffs = this.count(3 + area * 10);
    for (let i = 0; i < puffs; i++) {
      const lx = x + dir * this.r(0.2, 1.1);
      const s = this.sprite(SHAPE.PUFF, worldX(lx), b.deckY(lx) + 0.15, b.lateral(lx) + this.r(-0.3, 0.4));
      s.vx = dir * this.r(1.5, 3);
      s.vy = this.r(0.8, 1.8);
      s.vz = this.r(-0.3, 1.2);
      s.life = this.r(0.7, 1.1);
      s.size0 = 0.1;
      s.size1 = this.r(0.35, 0.6);
      s.drag = 2.4;
      s.gravity = 1.2;
      s.spin = this.r(-1, 1);
      s.color(SNOW.r, SNOW.g, SNOW.b, 0.5);
      this.sprites.emit(s);
    }
    const grains = this.count(10);
    for (let i = 0; i < grains; i++) {
      const lx = x + dir * this.r(0.2, 1.1);
      const s = this.sprite(SHAPE.STREAK, worldX(lx), b.deckY(lx) + 0.15, b.lateral(lx));
      this.scatter(s, this.r(0.5, 1.5), dir * this.r(2, 4.5), this.r(1.5, 3.5), this.r(0, 1.5));
      s.life = this.r(0.4, 0.8);
      s.size0 = s.size1 = 0.012;
      s.drag = 1.2;
      s.gravity = 6;
      s.color(1.0, 1.05, 1.15, 0.3);
      this.sprites.emit(s);
    }
  }

  /** Hail strikes the deck: the stone bursts into shards and ice dust (the storm draws the splash). */
  private hailLands(x: number, y: number, z: number, r: number, onSnow: boolean, game: Game): void {
    const wx = worldX(x);
    const cz = game.bridge.lateral(x) + z;
    const shards = this.count(8);
    for (let i = 0; i < shards; i++) {
      const d = this.piece(i % 3 === 0 ? PIECE.CHIP : PIECE.SHARD, wx, y + 0.08, cz);
      const a = this.rand() * Math.PI * 2;
      const v = this.r(1, 3.2);
      d.vx = Math.cos(a) * v;
      d.vz = Math.sin(a) * v * 0.6;
      d.vy = this.r(1.5, 4);
      d.size(r * this.r(0.06, 0.12));
      d.color(ICE.r * 1.2, ICE.g * 1.2, ICE.b * 1.2);
      d.roughness = 0.12;
      d.ice = 1;
      d.bounce = 0.35;
      d.life = this.r(0.9, 1.5);
      this.debris.emit(d);
    }
    const puffs = this.count(onSnow ? 4 : 2);
    for (let i = 0; i < puffs; i++) {
      const s = this.sprite(SHAPE.PUFF, wx + this.r(-0.2, 0.2), y + 0.1, cz + this.r(-0.2, 0.2));
      this.scatter(s, this.r(0.4, 1.2), 0, 0.6, 0);
      s.life = this.r(0.6, 1.0);
      s.size0 = 0.12;
      s.size1 = this.r(0.4, 0.6) * (onSnow ? 1.4 : 1);
      s.drag = 2.5;
      s.gravity = 0.4;
      s.spin = this.r(-1, 1);
      if (onSnow) s.color(SNOW.r, SNOW.g, SNOW.b, 0.55);
      else s.color(0.62, 0.72, 0.88, 0.28);
      this.sprites.emit(s);
    }
    const glints = this.count(6);
    for (let i = 0; i < glints; i++) {
      const s = this.sprite(SHAPE.STREAK, wx, y + 0.1, cz);
      this.scatter(s, this.r(1.5, 4), 0, 2.5, 0);
      s.life = this.r(0.25, 0.5);
      s.size0 = s.size1 = 0.01;
      s.drag = 2;
      s.gravity = 9.8;
      s.color(1.5, 1.75, 2.2, 0);
      this.sprites.emit(s);
    }
  }

  /** The focus cut: one stroke across the whole sky from the warrior's blade. */
  private focus(x: number, game: Game): void {
    const wx = worldX(x);
    const y = game.feetY + FOCUS_LIFT;
    this.streak.fire(wx, y, game.warrior.facing);
    const g = this.sprite(SHAPE.GLOW, wx, y, game.bridge.lateral(x) + 0.5);
    g.life = 0.3;
    g.size0 = 0.8;
    g.size1 = 1.6;
    g.color(1.6, 0.5, 0.6, 0);
    this.sprites.emit(g);
  }

  /* ---------------- Frame ---------------- */

  /**
   * The scene's moon (MountainPeakScene's shadow-casting light), for lighting the puffs. Looked up
   * once, and again only if it leaves the scene; without one the search is retried every 2 s.
   */
  private findMoon(dt: number): void {
    if (this.moon?.parent) return;
    this.moonSearch -= dt;
    if (this.moonSearch > 0) return;
    this.moonSearch = 2;
    this.moon = null;
    this.ctx.scene.traverse((o) => {
      if (!this.moon && o instanceof THREE.DirectionalLight && o.castShadow) this.moon = o;
    });
  }

  /** Sprays this frame's cuts, sharing a fixed budget between them, and skips those far off screen. */
  private flushCuts(game: Game): void {
    const n = this.cuts;
    if (n === 0) return;
    const cam = this.ctx.camera;
    const halfW = cam.position.z * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect + 3;
    const share = Math.min(1, CUT_BUDGET / Math.max(n, this.cutsSeen * 0.5));
    for (let i = 0; i < n; i++) {
      const kind = this.cutKind[i];
      if (kind === 255) continue;
      const x = this.cutX[i];
      if (kind === KIND.hail) {
        // A stone cut without a perfect (a focus cut): it still falls apart.
        this.splitStone(x, this.cutY[i], this.cutZ[i], this.cutR[i], false, game);
        continue;
      }
      if (Math.abs(worldX(x) - cam.position.x) > halfW) continue;
      this.sprayCut(x, this.cutY[i], this.cutZ[i], kind, this.cutR[i], this.cutWake[i] === 1, share, game);
    }
    this.cuts = 0;
    this.cutsSeen = 0;
  }

  update(dt: number, game: Game): void {
    this.findMoon(dt);
    this.flushCuts(game);
    const cam = this.ctx.camera;
    this.sprites.update(dt, cam, this.moon);
    this.debris.update(dt, game);
    this.halves.update(dt, game);
    this.streak.update(dt, cam);
  }
}
