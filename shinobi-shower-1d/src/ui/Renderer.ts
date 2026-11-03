import { SKY_HEIGHT, WORLD_WIDTH, extents } from '../engine/DropletPhysics.ts';
import type { Drop } from '../engine/DropletPhysics.ts';
import type { Game, GameEvent } from '../engine/Game.ts';
import { ACTIVE, ARC_HIGH, ARC_LOW, BASE_REACH, SWEET_HALF_WIDTH, SWEET_HIGH, SWEET_LOW } from '../entities/Katana.ts';
import { MAX_SPEED } from '../entities/Ninja.ts';
import { COLORS, PostProcessVFX, X, Y } from './PostProcessVFX.ts';
import type { View } from './PostProcessVFX.ts';

const GROUND_BAND = 2.6;
const HUD_ROOM = 2.4;
const TEXT_FONT = '"Azeret Mono", ui-monospace, monospace';

interface Sky {
  top: string;
  mid: string;
  low: string;
  glow: string;
}

const SKIES: Record<string, Sky> = {
  Drizzle: { top: '#0d1422', mid: '#1c2a3a', low: '#2c3d4b', glow: 'rgba(160,200,230,0.18)' },
  Rain: { top: '#070a18', mid: '#111a33', low: '#1d2a4a', glow: 'rgba(88,230,255,0.14)' },
  Snow: { top: '#141a26', mid: '#2a3446', low: '#47536a', glow: 'rgba(230,240,255,0.2)' },
  Hail: { top: '#0e0716', mid: '#22142e', low: '#38223f', glow: 'rgba(184,140,255,0.16)' },
};

function skyFor(kinds: readonly string[]): Sky {
  if (kinds.includes('hail')) return SKIES.Hail;
  if (kinds.includes('snow')) return SKIES.Snow;
  if (kinds.includes('rain')) return SKIES.Rain;
  return SKIES.Drizzle;
}

interface Building {
  x: number;
  w: number;
  h: number;
  roof: 'flat' | 'pagoda' | 'tower';
  windows: { x: number; y: number; c: string }[];
}

interface Look {
  robe: string;
  trim: string;
  skin: string;
  hat: boolean;
  glow: string | null;
}

const LOOKS: Look[] = [
  { robe: '#2b2520', trim: '#5a4a3a', skin: '#1a1512', hat: true, glow: null },
  { robe: '#10131f', trim: '#3d44a8', skin: '#0b0d16', hat: false, glow: null },
  { robe: '#191230', trim: '#b88cff', skin: '#0e0a1c', hat: false, glow: '#b88cff' },
  { robe: '#3b3634', trim: '#ff7a3d', skin: '#191514', hat: false, glow: '#ff7a3d' },
  { robe: '#e9e3d4', trim: '#d9b65c', skin: '#2a2622', hat: false, glow: '#f4dc8a' },
];

/** Draws the lane: a rooftop at night, the weather falling on it, and the ninja in their current colours. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  readonly vfx: PostProcessVFX;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private view: View = { s: 30, ox: 0, groundY: 0 };
  private city: Building[][] = [];
  private time = 0;
  private trails: { side: number; age: number; x: number }[] = [];
  private lastStride = 0;
  private stepSide = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.vfx = new PostProcessVFX(matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.buildCity();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, Math.floor(innerWidth * this.dpr));
    this.h = Math.max(1, Math.floor(innerHeight * this.dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const s = Math.min(this.w / (WORLD_WIDTH + 0.6), this.h / (SKY_HEIGHT * 0.78 + GROUND_BAND + HUD_ROOM));
    // On a tall phone screen the lane sits higher, leaving the roof below for the thumb pads.
    const floor = this.h > this.w * 1.1 ? Math.max(GROUND_BAND * s, this.h * 0.24) : GROUND_BAND * s;
    this.view = { s, ox: (this.w - WORLD_WIDTH * s) / 2, groundY: this.h - floor };
  }

  private buildCity(): void {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const neon = ['#58e6ff', '#ff4fa3', '#ffd36b', '#b88cff'];
    this.city = [0, 1].map((layer) => {
      const out: Building[] = [];
      let x = -12;
      while (x < WORLD_WIDTH + 12) {
        const w = 1.6 + r() * (layer ? 3.2 : 2.4);
        const h = layer ? 3 + r() * 6 : 5 + r() * 8;
        const roll = r();
        const roof = roll > 0.86 ? 'pagoda' : roll > 0.72 ? 'tower' : 'flat';
        const windows: Building['windows'] = [];
        for (let wy = 0.8; wy < h - 0.6; wy += 0.7)
          for (let wx = 0.35; wx < w - 0.3; wx += 0.55)
            if (r() > 0.78) windows.push({ x: wx, y: wy, c: r() > 0.9 ? neon[Math.floor(r() * 4)] : '#ffd99a' });
        out.push({ x, w, h, roof, windows });
        x += w + r() * 0.6;
      }
      return out;
    });
  }

  handleEvent(e: GameEvent, game: Game): void {
    const v = this.vfx;
    const flame = game.stance.flame;
    switch (e.type) {
      case 'slash':
        this.trails.push({ side: e.side, age: 0, x: e.x });
        break;
      case 'slice': {
        const color = e.kind === 'snow' ? COLORS.snow : flame ? COLORS.ember : COLORS.water;
        v.spray(e.x, e.y, e.kind === 'drizzle' ? 3 : e.kind === 'snow' ? 6 + Math.round(e.r * 12) : 7, color, e.kind === 'snow' ? 2 : 4);
        if (e.kind === 'snow' && e.r > 0.3) v.puff(e.x, e.y, 3, 'rgba(240,245,255,0.5)', e.r * 2);
        break;
      }
      case 'perfect':
        v.shards(e.x, e.y, 14, COLORS.hail, 6);
        v.addShake(0.35);
        v.doFlash(0.5, '#e8f6ff');
        v.float(e.x, e.y + 0.8, 'CLEAN CUT', '#e8f6ff');
        break;
      case 'clang':
        v.spray(e.x, e.y, 10, '#fff2c4', 6, 0.04);
        v.float(e.x, e.y + 0.7, 'off centre', '#c9cfe0');
        break;
      case 'steam':
        v.puff(e.x, e.y, 4, 'rgba(255,228,214,0.28)', 2, 0.2);
        break;
      case 'hit':
        if (e.kind === 'hail') {
          v.addShake(0.55);
          v.shards(e.x, e.y, 10, COLORS.hail, 4);
          v.hurt = 1;
        } else {
          v.spray(e.x, e.y, 6, COLORS.water, 2.5);
          v.hurt = Math.min(1, v.hurt + (e.kind === 'drizzle' ? 0.08 : 0.4));
          if (e.kind === 'snow') v.addShake(0.12);
        }
        if (e.damage >= 1) v.float(e.x, e.y + 1.4, `−${Math.round(e.damage)}%`, COLORS.danger);
        break;
      case 'shatter':
        v.shards(game.ninja.x, 1, 18, COLORS.spirit, 5);
        v.doFlash(0.4, COLORS.spirit);
        v.float(game.ninja.x, 2.6, 'ARMOR BROKEN', COLORS.spirit);
        break;
      case 'reform':
        v.spray(game.ninja.x, 1, 14, COLORS.spirit, 2);
        break;
      case 'splash':
        if (e.kind === 'hail') {
          v.shards(e.x, 0.1, 6, COLORS.hail, 3);
          v.ripple(e.x, 1.6, COLORS.hail);
          v.addShake(0.12);
        } else if (e.kind === 'snow') {
          v.puff(e.x, 0.05, e.r > 0.3 ? 3 : 1, 'rgba(240,245,255,0.4)', e.r * 1.5, Math.min(0.25, e.r * 0.45));
        } else if (Math.random() < (e.kind === 'drizzle' ? 0.25 : 1)) {
          v.ripple(e.x, e.kind === 'rain' ? 0.7 : 0.35);
          if (e.kind === 'rain') v.spray(e.x, 0.05, 2, COLORS.water, 2, 0.03);
        }
        break;
      case 'dash':
        v.puff(e.x, 0.3, 4, 'rgba(200,220,255,0.3)', 0.8);
        break;
      case 'levelup':
        v.doFlash(0.35, '#ffe9a8');
        v.spray(game.ninja.x, 1.2, 24, '#ffe9a8', 4);
        break;
      case 'focus':
        v.doFlash(1, '#ffffff');
        v.addShake(0.5);
        break;
      default:
        break;
    }
  }

  render(dt: number, game: Game, live: boolean): void {
    this.time += dt;
    this.vfx.update(dt);
    for (const t of this.trails) t.age += dt;
    this.trails = this.trails.filter((t) => t.age < ACTIVE + 0.16);

    const ctx = this.ctx;
    const v = this.view;
    const [sx, sy] = this.vfx.shakeOffset(this.time);
    ctx.save();
    ctx.translate(sx * this.dpr, sy * this.dpr);
    this.drawSky(game);
    this.drawCity(game);
    this.drawRoof();
    this.vfx.drawRipples(ctx, v);
    this.drawHailWarnings(game);
    this.drawSnowAndHail(game.drops, false);
    if (live || game.phase === 'over' || game.phase === 'paused') this.drawNinja(dt, game);
    this.drawTrails(game);
    this.drawStreaks(game.drops);
    this.drawSnowAndHail(game.drops, true);
    this.vfx.drawParticles(ctx, v);
    this.drawSweetSpot(game);
    this.vfx.drawTexts(ctx, v, TEXT_FONT);
    ctx.restore();
    this.vfx.drawOverlay(ctx, this.w, this.h);
  }

  private drawSky(game: Game): void {
    const ctx = this.ctx;
    const sky = skyFor(game.weather.season.kinds);
    const g = ctx.createLinearGradient(0, 0, 0, this.view.groundY);
    g.addColorStop(0, sky.top);
    g.addColorStop(0.6, sky.mid);
    g.addColorStop(1, sky.low);
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, this.w + 80, this.h + 80);
    // A moon behind the clouds.
    const v = this.view;
    const mx = X(v, WORLD_WIDTH * 0.78);
    const my = Y(v, SKY_HEIGHT * 0.62);
    const halo = ctx.createRadialGradient(mx, my, v.s * 0.6, mx, my, v.s * 6);
    halo.addColorStop(0, sky.glow);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - v.s * 6, my - v.s * 6, v.s * 12, v.s * 12);
    ctx.fillStyle = 'rgba(236,240,250,0.85)';
    ctx.beginPath();
    ctx.arc(mx, my, v.s * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sky.mid;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(mx - v.s * 0.3, my + v.s * 0.15, v.s * 2.6, v.s * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawCity(game: Game): void {
    const ctx = this.ctx;
    const v = this.view;
    const shift = (game.ninja.x - WORLD_WIDTH / 2) / WORLD_WIDTH;
    const layers = [
      { fill: 'rgba(14,18,34,0.75)', par: 0.6, scale: 0.75, base: 0.9 },
      { fill: '#070912', par: 1.4, scale: 1, base: 0 },
    ];
    layers.forEach((L, i) => {
      const off = -shift * L.par;
      for (const b of this.city[i]) {
        const x0 = X(v, b.x + off);
        const bw = b.w * v.s;
        const top = Y(v, b.h * L.scale + L.base);
        if (x0 > this.w + 40 || x0 + bw < -40) continue;
        ctx.fillStyle = L.fill;
        ctx.fillRect(x0, top, bw, v.groundY - top + 2);
        if (b.roof === 'pagoda') {
          ctx.beginPath();
          ctx.moveTo(x0 - bw * 0.25, top);
          ctx.quadraticCurveTo(x0 + bw / 2, top - v.s * 0.2, x0 + bw * 0.5, top - v.s * 0.9);
          ctx.quadraticCurveTo(x0 + bw / 2, top - v.s * 0.2, x0 + bw * 1.25, top);
          ctx.fill();
        } else if (b.roof === 'tower') {
          ctx.fillRect(x0 + bw * 0.45, top - v.s * 1.4, Math.max(1, v.s * 0.06), v.s * 1.4);
          ctx.fillStyle = Math.sin(this.time * 2 + b.x) > 0.6 ? '#ff4fa3' : 'rgba(255,79,163,0.3)';
          ctx.fillRect(x0 + bw * 0.45 - 1, top - v.s * 1.45, 3, 3);
        }
        if (i === 1) continue;
        for (const wdw of b.windows) {
          ctx.fillStyle = wdw.c;
          ctx.globalAlpha = 0.3 + 0.12 * Math.sin(this.time * 0.7 + wdw.x * 9 + wdw.y);
          ctx.fillRect(x0 + wdw.x * v.s, Y(v, wdw.y * L.scale + L.base), v.s * 0.22, v.s * 0.3);
        }
        ctx.globalAlpha = 1;
      }
    });
  }

  private drawRoof(): void {
    const ctx = this.ctx;
    const v = this.view;
    const g = ctx.createLinearGradient(0, v.groundY, 0, this.h);
    g.addColorStop(0, '#1b2233');
    g.addColorStop(0.08, '#0d111c');
    g.addColorStop(1, '#05060b');
    ctx.fillStyle = g;
    ctx.fillRect(-40, v.groundY, this.w + 80, this.h - v.groundY + 40);
    // Kawara tiles: a row of rounded ridges along the lane.
    ctx.strokeStyle = 'rgba(120,150,190,0.16)';
    ctx.lineWidth = Math.max(1, v.s * 0.04);
    for (let row = 0; row < 3; row++) {
      const y = v.groundY + v.s * (0.45 + row * 0.6);
      ctx.beginPath();
      for (let x = -1; x <= WORLD_WIDTH + 1; x += 0.5) {
        const px = X(v, x + (row % 2) * 0.25);
        ctx.moveTo(px, y);
        ctx.quadraticCurveTo(px + v.s * 0.25, y - v.s * 0.22, px + v.s * 0.5, y);
      }
      ctx.stroke();
    }
    // The wet ridge line catches the light.
    ctx.fillStyle = 'rgba(88,230,255,0.35)';
    ctx.fillRect(X(v, 0), v.groundY - 1, WORLD_WIDTH * v.s, Math.max(1.5, v.s * 0.05));
    // Lane ends: a lantern post at each.
    for (const x of [0, WORLD_WIDTH]) {
      const px = X(v, x);
      ctx.fillStyle = '#05060b';
      ctx.fillRect(px - v.s * 0.07, Y(v, 2.2), v.s * 0.14, v.s * 2.2);
      const lg = ctx.createRadialGradient(px, Y(v, 2.35), 1, px, Y(v, 2.35), v.s * 1.4);
      lg.addColorStop(0, 'rgba(255,90,70,0.55)');
      lg.addColorStop(1, 'rgba(255,90,70,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(px - v.s * 1.4, Y(v, 3.75), v.s * 2.8, v.s * 2.8);
      ctx.fillStyle = '#ff6a50';
      ctx.beginPath();
      ctx.ellipse(px, Y(v, 2.35), v.s * 0.2, v.s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Hail throws a shadow on the roof that darkens as the stone comes down. */
  private drawHailWarnings(game: Game): void {
    const ctx = this.ctx;
    const v = this.view;
    for (const d of game.drops) {
      if (d.kind !== 'hail') continue;
      const k = 1 - Math.min(1, d.y / SKY_HEIGHT);
      ctx.fillStyle = `rgba(0,0,0,${0.15 + k * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(X(v, d.x), v.groundY + v.s * 0.08, d.r * v.s * (0.6 + k * 0.6), d.r * v.s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,84,104,${0.2 + k * 0.6})`;
      ctx.lineWidth = Math.max(1, v.s * 0.035);
      ctx.stroke();
    }
  }

  /** Where the blade must meet a hailstone to break it, shown when one is close. */
  private drawSweetSpot(game: Game): void {
    if (game.phase !== 'playing') return;
    const n = game.ninja;
    const near = game.drops.some((d) => d.kind === 'hail' && d.y < 7 && Math.abs(d.x - n.x) < 5);
    if (!near) return;
    const ctx = this.ctx;
    const v = this.view;
    const reach = BASE_REACH * game.stance.arcMul;
    for (const side of game.stance.triple ? [n.facing, -n.facing] : [n.facing]) {
      // Preview the side the ninja faces now, which is where the next slash will go.
      const sweet = n.x + side * reach * 0.62;
      const x = X(v, sweet);
      const y0 = Y(v, SWEET_HIGH);
      const y1 = Y(v, SWEET_LOW);
      ctx.strokeStyle = 'rgba(232,246,255,0.55)';
      ctx.lineWidth = Math.max(1, v.s * 0.03);
      ctx.setLineDash([v.s * 0.12, v.s * 0.12]);
      ctx.strokeRect(x - SWEET_HALF_WIDTH * v.s, y0, SWEET_HALF_WIDTH * 2 * v.s, y1 - y0);
      ctx.setLineDash([]);
    }
  }

  private drawStreaks(drops: Drop[]): void {
    const ctx = this.ctx;
    const v = this.view;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (const pass of ['drizzle', 'rain'] as const) {
      ctx.strokeStyle = pass === 'rain' ? 'rgba(88,230,255,0.9)' : 'rgba(170,220,255,0.55)';
      ctx.lineWidth = Math.max(1, v.s * (pass === 'rain' ? 0.07 : 0.035));
      ctx.beginPath();
      for (const d of drops) {
        if (d.kind !== pass) continue;
        const { ry } = extents(d);
        const len = ry * (pass === 'rain' ? 2.4 : 2);
        const x = X(v, d.x);
        const y = Y(v, d.y);
        const slant = (d.vx / Math.abs(d.vy)) * len * v.s;
        ctx.moveTo(x - slant, y - len * v.s);
        ctx.lineTo(x, y + ry * v.s * 0.4);
      }
      ctx.stroke();
      if (pass === 'rain') {
        ctx.fillStyle = 'rgba(220,250,255,0.9)';
        for (const d of drops) {
          if (d.kind !== 'rain') continue;
          ctx.fillRect(X(v, d.x) - 1, Y(v, d.y), 2, 2);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Snow clumps draw as soft clusters, hail as cut ice. Big clumps go in front of the ninja. */
  private drawSnowAndHail(drops: Drop[], front: boolean): void {
    const ctx = this.ctx;
    const v = this.view;
    for (const d of drops) {
      if (d.kind === 'snow') {
        if (d.r > 0.3 !== front) continue;
        const { rx, ry } = extents(d);
        const puffs = d.r < 0.27 ? 1 : Math.min(7, Math.round((d.r / 0.2) ** 2));
        ctx.fillStyle = 'rgba(238,244,255,0.88)';
        for (let i = 0; i < puffs; i++) {
          const a = d.id * 1.7 + i * 2.39;
          const ox = puffs === 1 ? 0 : Math.cos(a) * rx * 0.62;
          const oy = puffs === 1 ? 0 : Math.sin(a) * ry * 0.5;
          const pr = (puffs === 1 ? d.r : d.r * (0.42 + ((i * 37) % 10) / 40)) * v.s;
          ctx.beginPath();
          ctx.arc(X(v, d.x + ox), Y(v, d.y + oy), Math.max(1.2, pr), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (d.kind === 'hail' && front) {
        const x = X(v, d.x);
        const y = Y(v, d.y);
        const r = d.r * v.s;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(d.phase);
        const g = ctx.createLinearGradient(-r, -r, r, r);
        g.addColorStop(0, '#f4fbff');
        g.addColorStop(0.5, '#b9d4e8');
        g.addColorStop(1, '#6f8aa6');
        ctx.fillStyle = g;
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const rr = r * (0.82 + ((d.id * (i + 3)) % 7) / 30);
          if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = Math.max(1, r * 0.08);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.3, -r * 0.32, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private drawTrails(game: Game): void {
    const ctx = this.ctx;
    const v = this.view;
    const s = game.stance;
    const reach = BASE_REACH * s.arcMul;
    const core = s.flame ? COLORS.flame : COLORS.water;
    ctx.globalCompositeOperation = 'lighter';
    for (const t of this.trails) {
      const k = Math.min(1, t.age / ACTIVE);
      const fade = t.age > ACTIVE ? 1 - (t.age - ACTIVE) / 0.16 : 1;
      const cx = X(v, game.ninja.x);
      const cy = Y(v, (ARC_LOW + ARC_HIGH) / 2 - 0.2);
      const rx = reach * v.s;
      const ry = ((ARC_HIGH - ARC_LOW) / 2 + 0.2) * v.s;
      // Sweeps from high behind the shoulder to low in front.
      const a0 = -Math.PI * 0.62;
      const a1 = a0 + (Math.PI * 0.95) * k;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(t.side, 1);
      for (const [width, color, alpha] of [
        [0.34, s.aura ? COLORS.spirit : core, 0.28],
        [0.16, core, 0.7],
        [0.05, '#ffffff', 0.95],
      ] as const) {
        ctx.globalAlpha = alpha * fade;
        ctx.strokeStyle = color;
        ctx.lineWidth = width * v.s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, a0, a1);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** The ninja, drawn as a silhouette in metres, feet at the origin. */
  private drawNinja(dt: number, game: Game): void {
    const ctx = this.ctx;
    const v = this.view;
    const n = game.ninja;
    const s = game.stance;
    const look = LOOKS[s.tier - 1];
    const speed = Math.min(1, Math.abs(n.vx) / MAX_SPEED);

    // Ashen coats leave embers in their footsteps.
    if (s.tier === 4 && Math.floor(n.stride / 0.9) !== Math.floor(this.lastStride / 0.9)) {
      this.stepSide = -this.stepSide || 1;
      for (let i = 0; i < 3; i++) this.vfx.ember(n.x + this.stepSide * 0.1, 0.05);
    }
    if (s.tier === 4 && Math.random() < dt * 6) this.vfx.puff(n.x - n.facing * 0.2, 1.2, 1, 'rgba(120,112,108,0.22)', 0.3, 0.1);
    this.lastStride = n.stride;

    ctx.save();
    ctx.translate(X(v, n.x), v.groundY);
    ctx.scale(v.s, v.s);
    // Shadow on the roof.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 0.04, 0.55, 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    if (game.shieldUp && s.aura) this.drawAura(ctx, 1);
    if (game.vulnerable > 0) {
      ctx.strokeStyle = `rgba(255,84,104,${0.4 + 0.4 * Math.sin(this.time * 18)})`;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.ellipse(0, -0.95, 0.75, 1.15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.scale(n.facing, 1);
    if (n.stun > 0) ctx.rotate(Math.sin(this.time * 40) * 0.06);

    if (n.rolling) {
      this.drawRoll(ctx, look, n.dashT);
    } else {
      this.drawBody(ctx, game, look, speed);
    }
    ctx.restore();

    if (s.tier === 5) this.drawSpectralSwords(game);
  }

  private drawAura(ctx: CanvasRenderingContext2D, alpha: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
    const g = ctx.createRadialGradient(0, -0.95, 0.3, 0, -0.95, 1.25);
    g.addColorStop(0, 'rgba(184,140,255,0)');
    g.addColorStop(0.75, `rgba(184,140,255,${0.08 * alpha})`);
    g.addColorStop(1, `rgba(184,140,255,${(0.28 + pulse * 0.12) * alpha})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -0.95, 0.85, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRoll(ctx: CanvasRenderingContext2D, look: Look, dashT: number): void {
    ctx.save();
    ctx.translate(0, -0.45);
    ctx.rotate((1 - dashT / 0.22) * Math.PI * 2);
    ctx.fillStyle = look.robe;
    ctx.beginPath();
    ctx.arc(0, 0, 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = look.trim;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.arc(0, 0, 0.3, 0.4, 2.2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.water;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.arc(0, 0, 0.44, -0.6, 0.6);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawBody(ctx: CanvasRenderingContext2D, game: Game, look: Look, speed: number): void {
    const n = game.ninja;
    const s = game.stance;
    const phase = n.stride * 2.4;
    const lean = speed * 0.22 * Math.sign(n.vx) * n.facing;
    const bob = Math.abs(Math.sin(phase)) * 0.05 * speed;
    const hip = { x: 0, y: -(0.86 + bob) };

    // Legs: a running scissor that settles into a wide stance at rest.
    ctx.strokeStyle = look.skin;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.15;
    for (const side of [1, -1]) {
      const swing = speed > 0.05 ? Math.sin(phase + (side > 0 ? 0 : Math.PI)) * 0.75 * speed : side * 0.28;
      const knee = { x: hip.x + Math.sin(swing) * 0.45, y: hip.y + Math.cos(swing) * 0.45 };
      const footLift = speed > 0.05 ? Math.max(0, -Math.cos(phase + (side > 0 ? 0 : Math.PI))) * 0.25 * speed : 0;
      const foot = { x: knee.x + Math.sin(swing * 0.4 - 0.2) * 0.45, y: Math.min(-0.02, knee.y + 0.43 - footLift) };
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(hip.x, hip.y);
    ctx.rotate(lean);

    // Scabbards across the back from tier 2.
    if (s.tier >= 2) {
      ctx.strokeStyle = '#2a1d16';
      ctx.lineWidth = 0.07;
      for (const tilt of s.dual ? [0.5, 0.75] : [0.6]) {
        ctx.beginPath();
        ctx.moveTo(-0.15 - Math.sin(tilt) * 0.55, -0.15 + Math.cos(tilt) * 0.1);
        ctx.lineTo(0.05 + Math.sin(tilt) * 0.2, -0.75 - Math.cos(tilt) * 0.2);
        ctx.stroke();
      }
    }

    // A cold rim light keeps dark robes readable against the night.
    ctx.shadowColor = look.glow ?? 'rgba(140,210,255,0.55)';
    ctx.shadowBlur = 9;
    // Robe: torso and a hem that flaps with the run.
    const flap = Math.sin(this.time * 9 + n.stride) * 0.05 + speed * 0.18;
    ctx.fillStyle = look.robe;
    ctx.beginPath();
    ctx.moveTo(-0.2, -0.6);
    ctx.lineTo(-0.22, -0.02);
    ctx.lineTo(-0.38 - flap, 0.4);
    if (s.tier === 1) {
      // Tattered hem.
      for (let i = 0; i < 5; i++) ctx.lineTo(-0.3 - flap + i * 0.15, 0.4 + (i % 2 ? -0.1 : 0.04));
    } else {
      ctx.lineTo(0.3, 0.42);
    }
    ctx.lineTo(0.24, -0.02);
    ctx.lineTo(0.22, -0.6);
    ctx.closePath();
    ctx.fill();
    // Chest and shoulders.
    ctx.beginPath();
    ctx.moveTo(-0.22, 0);
    ctx.lineTo(-0.24, -0.58);
    ctx.quadraticCurveTo(0, -0.66, 0.24, -0.58);
    ctx.lineTo(0.22, 0);
    ctx.closePath();
    ctx.fill();
    // Obi and trim.
    ctx.fillStyle = look.trim;
    ctx.fillRect(-0.23, -0.06, 0.46, 0.09);
    ctx.strokeStyle = look.trim;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(-0.08, -0.6);
    ctx.lineTo(0.1, -0.08);
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (look.glow) {
      ctx.shadowColor = look.glow;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = look.glow;
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.moveTo(-0.38 - flap, 0.4);
      ctx.lineTo(-0.24, -0.58);
      ctx.quadraticCurveTo(0, -0.66, 0.24, -0.58);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Head.
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(0.04, -0.77, 0.15, 0, Math.PI * 2);
    ctx.fill();
    if (look.hat) {
      ctx.fillStyle = '#c9a66b';
      ctx.beginPath();
      ctx.moveTo(-0.46, -0.76);
      ctx.lineTo(0.5, -0.76);
      ctx.lineTo(0.03, -1.02);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#7d6440';
      ctx.lineWidth = 0.025;
      ctx.stroke();
    } else {
      // Headband with tails that stream behind.
      ctx.fillStyle = look.trim;
      ctx.fillRect(-0.11, -0.84, 0.3, 0.05);
      ctx.strokeStyle = look.trim;
      ctx.lineWidth = 0.04;
      const tail = 0.25 + speed * 0.35;
      ctx.beginPath();
      ctx.moveTo(-0.11, -0.82);
      ctx.quadraticCurveTo(-0.11 - tail * 0.6, -0.86 + Math.sin(this.time * 10) * 0.05, -0.11 - tail, -0.78 + Math.sin(this.time * 12 + 1) * 0.07);
      ctx.stroke();
    }
    if (s.tier === 3) this.drawRibbons(ctx, speed);
    // Third blade, held in the teeth.
    if (s.triple) {
      ctx.strokeStyle = '#dfe9f5';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(-0.3, -0.72);
      ctx.lineTo(0.62, -0.74);
      ctx.stroke();
    }

    this.drawArms(ctx, game, look);
    ctx.restore();
  }

  private drawRibbons(ctx: CanvasRenderingContext2D, speed: number): void {
    ctx.strokeStyle = 'rgba(184,140,255,0.85)';
    ctx.lineWidth = 0.04;
    for (const off of [0, 0.12]) {
      ctx.beginPath();
      ctx.moveTo(-0.2, -0.56 + off);
      const len = 0.5 + speed * 0.5;
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        ctx.lineTo(-0.2 - t * len, -0.56 + off + t * 0.25 + Math.sin(this.time * 8 - t * 5 + off * 20) * 0.07 * t);
      }
      ctx.stroke();
    }
  }

  private drawArms(ctx: CanvasRenderingContext2D, game: Game, look: Look): void {
    const k = game.katana;
    const s = game.stance;
    const slashing = k.t >= 0;
    // Blade angle from straight up: rests low and back, sweeps from high-back to low-forward on a slash.
    let angle: number;
    if (slashing) {
      const sw = k.sweep;
      angle = -2.1 + sw * 3.2 - (k.t < 0.04 ? 0.25 : 0);
    } else {
      const recover = k.cooldown > 0 ? Math.min(1, k.cooldown / k.cooldownLength) : 0;
      angle = 2.3 - recover * 0.9;
    }
    const shoulder = { x: 0.05, y: -0.55 };
    const hands = s.dual ? [angle, angle + (slashing ? -0.35 : 0.5)] : [angle];
    hands.forEach((a, i) => {
      const reach = slashing ? 0.55 : 0.4;
      const hx = shoulder.x + Math.sin(a) * reach * (i ? 0.85 : 1);
      const hy = shoulder.y - Math.cos(a) * reach * (i ? 0.85 : 1);
      ctx.strokeStyle = look.skin;
      ctx.lineWidth = 0.11;
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      const len = 1.0;
      const bx = hx + Math.sin(a) * len;
      const by = hy - Math.cos(a) * len;
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(hx - Math.sin(a) * 0.18, hy + Math.cos(a) * 0.18);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.strokeStyle = s.flame ? '#ffd2b0' : '#e8f1fb';
      ctx.lineWidth = 0.045;
      if (s.flame) {
        ctx.shadowColor = COLORS.flame;
        ctx.shadowBlur = 14;
      } else if (k.ready) {
        ctx.shadowColor = COLORS.water;
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo((hx + bx) / 2 + Math.cos(a) * 0.05, (hy + by) / 2 + Math.sin(a) * 0.05, bx, by);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Rough world position of the blade tip, ignoring the lean: plenty for a spark.
      if (s.flame && Math.random() < 0.3) this.vfx.ember(game.ninja.x + game.ninja.facing * bx, 0.86 - by);
    });
  }

  /** The grandmaster's three floating spectral blades circle and lean toward the weather. */
  private drawSpectralSwords(game: Game): void {
    const ctx = this.ctx;
    const v = this.view;
    const n = game.ninja;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = this.time * 1.4 + (i * Math.PI * 2) / 3;
      const x = X(v, n.x + Math.cos(a) * 0.9);
      const y = Y(v, 2.25 + Math.sin(a) * 0.25);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI + Math.cos(a) * 0.25);
      ctx.strokeStyle = `rgba(244,220,138,${0.45 + 0.25 * Math.sin(a * 2)})`;
      ctx.lineWidth = Math.max(1, v.s * 0.05);
      ctx.beginPath();
      ctx.moveTo(0, -v.s * 0.45);
      ctx.lineTo(0, v.s * 0.4);
      ctx.moveTo(-v.s * 0.1, -v.s * 0.28);
      ctx.lineTo(v.s * 0.1, -v.s * 0.28);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
}
