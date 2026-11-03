import { ARC, RANGE } from '../combat/KatanaSlice.ts';
import type { Box } from '../core/Level.ts';
import { CEILING, ROOM, WATER_LEVEL } from '../core/Level.ts';
import type { GameEvent, TrialGame } from '../core/TrialGame.ts';
import { halfFade } from '../hazards/WaterDroplet.ts';

interface Atlas {
  cell: number;
  columns: number;
  metresPerCell: number;
  feetFromBottom: number;
  strips: Record<string, { start: number; count: number }>;
}

declare const __ART__: Record<'ninja' | 'props' | 'tile' | 'wall', string>;
declare const __ATLAS__: Atlas;

const VIEW_HEIGHT = 21;
const TEXTURE_METRES = 12;
const PROP_CELL = 256;
/** Which baked prop goes where: indices into props.png, and the width in metres to draw it. */
const PROP_SIZES = [1.5, 1.2, 1.3, 1.3, 1.9, 2.2];

function image(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

function offscreen(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Recolours a texture: its light and dark detail stay, its hue becomes the glaze colour. */
function glaze(src: HTMLImageElement, tint: string, gain: string, lift: number): HTMLCanvasElement {
  const [c, x] = offscreen(512, 512);
  x.drawImage(src, 0, 0, 512, 512);
  x.globalCompositeOperation = 'color';
  x.fillStyle = tint;
  x.fillRect(0, 0, 512, 512);
  x.globalCompositeOperation = 'soft-light';
  x.fillStyle = gain;
  x.fillRect(0, 0, 512, 512);
  x.globalCompositeOperation = 'lighter';
  x.fillStyle = `rgba(255,255,255,${lift})`;
  x.fillRect(0, 0, 512, 512);
  return c;
}

interface Ring { x: number; y: number; age: number; size: number; color: string }
interface Lens { x: number; y: number; r: number; age: number; life: number; speed: number }
interface Ghost { x: number; y: number; frame: number; facing: number; age: number }
interface Prop { x: number; y: number; kind: number; scale: number; flip: boolean }

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ninja = image(__ART__.ninja);
  private readonly propSheet = image(__ART__.props);
  private readonly tileImage = image(__ART__.tile);
  private readonly wallImage = image(__ART__.wall);
  private patterns: Record<'ledge' | 'room' | 'back' | 'far', CanvasPattern> | null = null;
  private readonly rings: Ring[] = [];
  private readonly lens: Lens[] = [];
  private readonly ghosts: Ghost[] = [];
  private readonly props: Prop[] = [];
  private w = 1;
  private h = 1;
  private s = 40;
  private dpr = 1;
  private camX = 0;
  private camY = 8;
  private time = 0;
  private hit = 0;
  private shake = 0;
  private steam = 0;
  private frameT = 0;
  private menuY = 6;
  private currentStrip = 'idle';
  private bladeGray = 0;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly canvas: HTMLCanvasElement, game: TrialGame) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.scatterProps(game);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Ferns, flowers and rocks grow from damp ledge corners, in a pattern fixed by each ledge's position. */
  private scatterProps(game: TrialGame): void {
    for (const b of game.level.boxes) {
      if (b.look !== 'tile') continue;
      const width = b.max.x - b.min.x;
      if (width < 5) continue;
      const count = Math.round(width / 4.5);
      for (let i = 0; i < count; i++) {
        const seed = Math.abs(Math.sin(b.id * 17.3 + i * 9.1) * 1000) % 1;
        const seed2 = Math.abs(Math.sin(b.id * 5.7 + i * 31.7) * 1000) % 1;
        this.props.push({
          x: b.min.x + ((i + 0.2 + seed * 0.6) / count) * width,
          y: b.max.y,
          kind: Math.floor(seed2 * 6),
          scale: 0.75 + seed * 0.45,
          flip: seed2 > 0.5,
        });
      }
    }
  }

  private resize(): void {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.floor(innerWidth * this.dpr));
    this.h = Math.max(1, Math.floor(innerHeight * this.dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.s = Math.max(this.h / VIEW_HEIGHT, this.w / 34);
    this.patterns = null;
  }

  private buildPatterns(): boolean {
    if (this.patterns) return true;
    if (!this.tileImage.complete || !this.wallImage.complete) return false;
    const make = (src: HTMLImageElement, tint: string, gain: string, lift: number, metres: number) => {
      const p = this.ctx.createPattern(glaze(src, tint, gain, lift), 'repeat')!;
      p.setTransform(new DOMMatrix().scale((metres * this.s) / 512));
      return p;
    };
    this.patterns = {
      ledge: make(this.tileImage, '#7fd0b4', '#ffffff', 0.12, TEXTURE_METRES),
      room: make(this.tileImage, '#3d8f83', '#c9c9c9', 0.02, TEXTURE_METRES),
      back: make(this.tileImage, '#1f6a66', '#505050', 0, TEXTURE_METRES * 1.4),
      far: make(this.wallImage, '#123f46', '#202020', 0, 9),
    };
    return true;
  }

  /** The direction from the ninja's chest to the mouse, in world space. */
  aimFrom(mouseX: number, mouseY: number, game: TrialGame): { x: number; y: number } {
    const c = game.ninja.eye;
    const wx = this.camX + (mouseX * this.dpr - this.w / 2) / this.s;
    const wy = this.camY - (mouseY * this.dpr - this.h / 2) / this.s;
    const dx = wx - c.x;
    const dy = wy - c.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }

  handleEvent(e: GameEvent, game: TrialGame): void {
    const ring = (size: number, color = 'rgba(225,246,255,') => {
      if (this.rings.length < 24) this.rings.push({ x: e.x, y: e.y, age: 0, size, color });
    };
    switch (e.type) {
      case 'hit':
        this.hit = 1;
        this.addShake(0.4);
        ring(1.6);
        this.addLens(0.2 + Math.random() * 0.6);
        break;
      case 'graze': {
        const side = e.x > game.ninja.pos.x ? 1 : -1;
        this.addLens(0.5 + side * (0.12 + Math.random() * 0.25));
        break;
      }
      case 'splash':
        ring(0.9);
        break;
      case 'cleave':
      case 'pop':
        ring(1.5, 'rgba(255,255,255,');
        this.addShake(0.08);
        break;
      case 'parry':
        ring(2.4, 'rgba(255,255,255,');
        this.addShake(0.15);
        break;
      case 'bounce':
        ring(2, 'rgba(240,210,255,');
        break;
      case 'land':
        if (e.value > 0.35) ring(0.8 + e.value, 'rgba(255,255,255,');
        break;
      case 'flood':
        this.hit = 1;
        this.addShake(0.5);
        break;
      default:
        break;
    }
  }

  private addShake(a: number): void {
    if (!this.reducedMotion) this.shake = Math.min(0.7, this.shake + a);
  }

  private addLens(xHint: number): void {
    if (this.lens.length >= 6) this.lens.shift();
    this.lens.push({
      x: Math.max(0.08, Math.min(0.92, xHint)),
      y: 0.05 + Math.random() * 0.25,
      r: 0.022 + Math.random() * 0.024,
      age: 0,
      life: 2.6 + Math.random(),
      speed: 0.05 + Math.random() * 0.09,
    });
  }

  private X(x: number): number {
    return x * this.s;
  }

  private Y(y: number): number {
    return -y * this.s;
  }

  render(dt: number, game: TrialGame, mouseX: number, mouseY: number, showReticle: boolean): void {
    const ctx = this.ctx;
    if (!this.buildPatterns()) {
      ctx.fillStyle = '#123f46';
      ctx.fillRect(0, 0, this.w, this.h);
      return;
    }
    this.time += dt;
    this.updateCamera(dt, game);
    this.steam += ((game.phase !== 'menu' && game.level.steamAt(game.ninja.eye) ? 1 : 0) - this.steam) * (1 - Math.exp(-2.6 * dt));
    this.hit = Math.max(0, this.hit - dt * 2.2);
    this.shake = Math.max(0, this.shake - dt * 2.2);

    const shakeX = Math.sin(this.time * 61) * this.shake * this.s * 0.2;
    const shakeY = Math.sin(this.time * 47) * this.shake * this.s * 0.2;
    const originX = this.w / 2 - this.camX * this.s + shakeX;
    const originY = this.h / 2 + this.camY * this.s + shakeY;

    this.drawFarBackground();
    ctx.setTransform(1, 0, 0, 1, originX, originY);
    this.drawBackWall();
    this.drawLightShafts();
    this.drawFixtures(game);
    this.drawWaterBack();
    this.drawStreams(game, true);
    this.drawBoxes(game);
    this.drawProps();
    this.drawRails(game);
    this.drawAnchors(game);
    this.drawGoal(game);
    this.drawBouncers(game);
    this.drawWetCells(game);
    if (game.phase !== 'menu') {
      this.drawShadows(game);
      this.drawGhosts(dt);
      this.drawWire(game);
      this.drawNinja(dt, game);
      this.drawSlash(game);
    }
    this.drawStreams(game, false);
    this.drawMist(game);
    ctx.setTransform(1, 0, 0, 1, originX, originY);
    this.drawDroplets(game, originX, originY);
    this.drawRings(dt);
    if (game.phase === 'playing' && game.blade.active) this.drawTrails(game);
    this.drawWaterFront();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSteam(game, originX, originY);
    this.drawVignette();
    this.drawLens(dt);
    if (this.hit > 0) {
      ctx.fillStyle = `rgba(20,70,120,${this.hit * 0.3})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (showReticle) this.drawReticle(game, mouseX, mouseY);
    this.bladeGray += ((game.phase === 'playing' && game.blade.active ? 1 : 0) - this.bladeGray) * (1 - Math.exp(-14 * dt));
    this.canvas.style.filter = this.bladeGray > 0.02 ? `saturate(${1 - this.bladeGray * 0.8}) contrast(${1 + this.bladeGray * 0.15})` : '';
  }

  private updateCamera(dt: number, game: TrialGame): void {
    let tx: number;
    let ty: number;
    if (game.phase === 'menu') {
      // On the menu the camera drifts up the whole climb and back.
      this.menuY = 34 + Math.sin(this.time * 0.05) * 28;
      tx = 6;
      ty = this.menuY;
    } else {
      const n = game.ninja;
      tx = n.pos.x + n.vel.x * 0.28 + n.facing * 1.2;
      ty = n.pos.y + 2.2 + Math.max(-4, Math.min(4, n.vel.y * 0.16));
    }
    const halfW = this.w / this.s / 2;
    const minX = -ROOM - 1.5 + halfW;
    const maxX = ROOM + 1.5 - halfW;
    tx = minX > maxX ? 0 : Math.max(minX, Math.min(maxX, tx));
    const halfH = this.h / this.s / 2;
    ty = Math.max(halfH - 1.6, Math.min(CEILING - halfH, ty));
    const k = 1 - Math.exp(-(game.phase === 'menu' ? 1 : 6.5) * dt);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
  }

  private drawFarBackground(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, -this.camX * this.s * 0.25, this.camY * this.s * 0.25);
    ctx.fillStyle = this.patterns!.far;
    ctx.fillRect(this.camX * this.s * 0.25, -this.camY * this.s * 0.25, this.w, this.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, 'rgba(120,190,180,0.25)');
    g.addColorStop(1, 'rgba(3,18,24,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /** The stall's back wall, tiled and lit from a skylight high above, so it brightens as you climb. */
  private drawBackWall(): void {
    const ctx = this.ctx;
    const x0 = this.X(-ROOM);
    const x1 = this.X(ROOM);
    const top = this.Y(CEILING);
    const bottom = this.Y(-1);
    ctx.fillStyle = this.patterns!.back;
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
    const g = ctx.createLinearGradient(0, this.Y(CEILING), 0, this.Y(0));
    g.addColorStop(0, 'rgba(235,250,240,0.42)');
    g.addColorStop(0.45, 'rgba(120,190,175,0.12)');
    g.addColorStop(0.85, 'rgba(3,22,30,0.42)');
    g.addColorStop(1, 'rgba(0,10,18,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
  }

  private drawLightShafts(): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const base = -14 + i * 9 + Math.sin(this.time * 0.13 + i * 2) * 1.2;
      const topY = this.camY + this.h / this.s;
      const botY = this.camY - this.h / this.s;
      const slant = 0.32;
      const width = 2 + (i % 2) * 1.5;
      const g = ctx.createLinearGradient(0, this.Y(topY), 0, this.Y(botY));
      const a = 0.05 + 0.025 * Math.sin(this.time * 0.4 + i);
      g.addColorStop(0, `rgba(255,248,220,${a * 1.6})`);
      g.addColorStop(1, 'rgba(255,248,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      const dx = (topY - this.camY) * slant;
      ctx.moveTo(this.X(base + dx), this.Y(topY));
      ctx.lineTo(this.X(base + dx + width), this.Y(topY));
      ctx.lineTo(this.X(base - dx + width * 1.8), this.Y(botY));
      ctx.lineTo(this.X(base - dx - width * 0.4), this.Y(botY));
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private chromeGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#59626c');
    g.addColorStop(0.18, '#f6fbff');
    g.addColorStop(0.36, '#aab6c0');
    g.addColorStop(0.62, '#3c444e');
    g.addColorStop(0.85, '#cfd8e0');
    g.addColorStop(1, '#6d7680');
    return g;
  }

  /** Background plumbing and the Master Showerhead, painted in chrome. */
  private drawFixtures(game: TrialGame): void {
    const ctx = this.ctx;
    // A towel rail and a run of pipe behind the action give the wall scale.
    ctx.globalAlpha = 0.55;
    for (const [x0, y, x1] of [[-18, 13, -4], [3, 47, 18], [-17, 88, -2]] as const) {
      ctx.fillStyle = this.chromeGradient(0, this.Y(y + 0.2), 0, this.Y(y - 0.2));
      ctx.beginPath();
      ctx.roundRect(this.X(x0), this.Y(y + 0.2), this.X(x1 - x0), this.s * 0.4, this.s * 0.2);
      ctx.fill();
      for (const px of [x0 + 0.6, x1 - 0.6]) {
        ctx.fillRect(this.X(px - 0.1), this.Y(y + 0.9), this.s * 0.2, this.s * 0.8);
      }
    }
    ctx.globalAlpha = 1;
    // Showerhead over the top stage.
    const hx = 4;
    const hy = 103;
    ctx.fillStyle = this.chromeGradient(this.X(hx - 7), 0, this.X(hx + 7), 0);
    ctx.beginPath();
    ctx.moveTo(this.X(hx - 2), this.Y(hy + 1.6));
    ctx.lineTo(this.X(hx + 2), this.Y(hy + 1.6));
    ctx.lineTo(this.X(hx + 7), this.Y(hy - 0.6));
    ctx.lineTo(this.X(hx - 7), this.Y(hy - 0.6));
    ctx.fill();
    ctx.fillStyle = '#20262c';
    for (let i = -6; i <= 6; i++) ctx.fillRect(this.X(hx + i - 0.08), this.Y(hy - 0.62), this.s * 0.16, this.s * 0.12);
    void game;
  }

  private surfaceY(x: number, layer: number): number {
    return WATER_LEVEL + Math.sin(x * 0.7 + this.time * 1.6 + layer) * 0.12 + Math.sin(x * 1.9 - this.time * 2.3 + layer * 2) * 0.05;
  }

  private waterPath(layer: number): void {
    const ctx = this.ctx;
    const x0 = -ROOM;
    ctx.beginPath();
    ctx.moveTo(this.X(x0), this.Y(-3));
    for (let x = x0; x <= ROOM; x += 0.8) ctx.lineTo(this.X(x), this.Y(this.surfaceY(x, layer)));
    ctx.lineTo(this.X(ROOM), this.Y(-3));
    ctx.closePath();
  }

  private drawWaterBack(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, this.Y(0.4), 0, this.Y(-2));
    g.addColorStop(0, '#2c8fa0');
    g.addColorStop(1, '#04202c');
    ctx.fillStyle = g;
    this.waterPath(0);
    ctx.fill();
    // The whirlpool at the basin drain.
    ctx.save();
    ctx.translate(this.X(1), this.Y(-0.25));
    ctx.scale(1, 0.14);
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `rgba(190,240,245,${0.3 - i * 0.04})`;
      ctx.lineWidth = this.s * 0.1;
      ctx.beginPath();
      const a = this.time * (2.4 - i * 0.2) + i;
      ctx.arc(0, 0, this.s * (0.9 + i * 0.95), a, a + 4.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawWaterFront(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, this.Y(0.3), 0, this.Y(-1.6));
    g.addColorStop(0, 'rgba(90,205,210,0.5)');
    g.addColorStop(1, 'rgba(4,40,55,0.92)');
    ctx.fillStyle = g;
    this.waterPath(2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,252,255,0.75)';
    ctx.lineWidth = this.s * 0.05;
    ctx.beginPath();
    for (let x = -ROOM; x <= ROOM; x += 0.8) {
      const px = this.X(x);
      const py = this.Y(this.surfaceY(x, 2));
      if (x === -ROOM) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  private visible(b: Box): boolean {
    const halfW = this.w / this.s / 2 + 2;
    const halfH = this.h / this.s / 2 + 2;
    return b.max.x > this.camX - halfW && b.min.x < this.camX + halfW && b.max.y > this.camY - halfH && b.min.y < this.camY + halfH;
  }

  private drawBoxes(game: TrialGame): void {
    for (const b of game.level.boxes) {
      if (!this.visible(b)) continue;
      switch (b.look) {
        case 'room':
        case 'tile':
          this.drawTileBox(b);
          break;
        case 'chrome':
          this.drawPipe(b);
          break;
        case 'soap':
          this.drawSoap(b);
          break;
        case 'curtain':
          this.drawCurtain(b);
          break;
        case 'bottle':
          this.drawBottle(b);
          break;
      }
    }
  }

  private drawTileBox(b: Box): void {
    const ctx = this.ctx;
    const x = this.X(b.min.x);
    const y = this.Y(b.max.y);
    const w = this.X(b.max.x - b.min.x);
    const h = this.s * (b.max.y - b.min.y);
    if (b.look === 'tile') {
      // A soft shadow onto the wall behind sets the ledge in front of it.
      ctx.save();
      ctx.shadowColor = 'rgba(0,16,22,0.7)';
      ctx.shadowBlur = this.s * 0.7;
      ctx.shadowOffsetY = this.s * 0.35;
      ctx.fillStyle = '#11343a';
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    ctx.fillStyle = b.look === 'room' ? this.patterns!.room : this.patterns!.ledge;
    ctx.fillRect(x, y, w, h);

    if (b.look === 'tile') {
      const shade = ctx.createLinearGradient(0, y, 0, y + h);
      shade.addColorStop(0, 'rgba(255,255,255,0.12)');
      shade.addColorStop(0.18, 'rgba(255,255,255,0)');
      shade.addColorStop(1, 'rgba(0,25,30,0.55)');
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, w, h);
      // Glazed cream bullnose along the top: this is what you land on.
      const lip = this.s * 0.16;
      const top = ctx.createLinearGradient(0, y, 0, y + lip);
      top.addColorStop(0, '#fffdf0');
      top.addColorStop(0.5, '#efe7cc');
      top.addColorStop(1, '#a7a48e');
      ctx.fillStyle = top;
      ctx.fillRect(x, y, w, lip);
      ctx.fillStyle = 'rgba(0,30,36,0.35)';
      ctx.fillRect(x, y + lip, w, this.s * 0.06);
      // A moving glint along the glaze.
      const gx = x + ((this.time * 0.13 * this.s * 8 + b.id * 77) % (w + 200)) - 100;
      const glint = ctx.createLinearGradient(gx - 60, 0, gx + 60, 0);
      glint.addColorStop(0, 'rgba(255,255,255,0)');
      glint.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      glint.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glint;
      ctx.fillRect(x, y, w, lip * 0.6);
    } else {
      const side = b.max.x > 0 ? 1 : -1;
      const edge = side > 0 ? x : x + w;
      const g = ctx.createLinearGradient(edge, 0, edge + side * this.s * 2.2, 0);
      g.addColorStop(0, 'rgba(235,255,245,0.32)');
      g.addColorStop(0.08, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,16,24,0.62)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
    for (const [y0, y1] of b.wetBands) this.drawWetBand(b, y0, y1);
  }

  /** Running water: a dark gloss on the tile with bright threads falling down it. */
  private drawWetBand(b: Box, y0: number, y1: number): void {
    const ctx = this.ctx;
    const faceRight = b.max.x < 0;
    const face = faceRight ? b.max.x : b.min.x;
    const x0 = faceRight ? face - 1.4 : face;
    const top = this.Y(y1);
    const h = this.s * (y1 - y0);
    const g = ctx.createLinearGradient(this.X(face), 0, this.X(face + (faceRight ? -1.4 : 1.4)), 0);
    g.addColorStop(0, 'rgba(10,55,85,0.8)');
    g.addColorStop(1, 'rgba(10,55,85,0)');
    ctx.fillStyle = g;
    ctx.fillRect(this.X(x0), top, this.s * 1.4, h);
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const lane = face + (faceRight ? -1 : 1) * (0.06 + i * 0.13);
      const seed = (i * 37) % 11;
      const len = 1.5 + (seed % 4) * 0.7;
      for (let k = 0; k < 3; k++) {
        const span = y1 - y0 + len;
        const yy = y1 - ((this.time * (3 + seed * 0.4) + k * span * 0.34 + seed) % span);
        ctx.strokeStyle = `rgba(190,240,255,${0.55 - i * 0.05})`;
        ctx.lineWidth = this.s * 0.035;
        ctx.beginPath();
        ctx.moveTo(this.X(lane), this.Y(Math.min(y1, yy + len)));
        ctx.lineTo(this.X(lane), this.Y(Math.max(y0, yy)));
        ctx.stroke();
      }
    }
  }

  private drawPipe(b: Box): void {
    const ctx = this.ctx;
    const x = this.X(b.min.x);
    const y = this.Y(b.max.y);
    const w = this.X(b.max.x - b.min.x);
    const h = this.s * (b.max.y - b.min.y);
    ctx.fillStyle = this.chromeGradient(x, 0, x + w, 0);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = this.chromeGradient(x - this.s * 0.15, 0, x + w + this.s * 0.15, 0);
    ctx.beginPath();
    ctx.roundRect(x - this.s * 0.15, y + h - this.s * 0.45, w + this.s * 0.3, this.s * 0.45, this.s * 0.1);
    ctx.fill();
  }

  private drawSoap(b: Box): void {
    const ctx = this.ctx;
    const x = this.X(b.min.x);
    const y = this.Y(b.max.y);
    const w = this.X(b.max.x - b.min.x);
    const h = this.s * (b.max.y - b.min.y);
    const radius = h * 0.48;
    ctx.save();
    ctx.shadowColor = 'rgba(0,16,22,0.55)';
    ctx.shadowBlur = this.s * 0.5;
    ctx.shadowOffsetY = this.s * 0.3;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#fff3fb');
    g.addColorStop(0.42, '#e0c8f2');
    g.addColorStop(1, '#8e70b4');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.roundRect(x + w * 0.1, y + h * 0.12, w * 0.5, h * 0.16, h * 0.08);
    ctx.fill();
    // Suds gather along the edges, and they drip.
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 6; i++) {
      const px = x + (w * (i + 0.5)) / 6;
      const r = this.s * (0.07 + ((i * 7) % 3) * 0.03);
      ctx.beginPath();
      ctx.arc(px, y + h + Math.sin(this.time * 2 + i) * this.s * 0.03, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCurtain(b: Box): void {
    const ctx = this.ctx;
    const midX = (b.min.x + b.max.x) / 2;
    const top = b.max.y;
    const steps = 22;
    ctx.save();
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = top - (top - b.min.y) * t;
      const sway = Math.sin(t * 7 + this.time * 1.3) * 0.13 * (0.3 + t);
      left.push([this.X(midX - 0.5 + sway), this.Y(y)]);
      right.push([this.X(midX + 0.5 + sway), this.Y(y)]);
    }
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    right.reverse().forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    const g = ctx.createLinearGradient(this.X(midX - 0.6), 0, this.X(midX + 0.6), 0);
    g.addColorStop(0, '#6f8ea8');
    g.addColorStop(0.28, '#e9f2f6');
    g.addColorStop(0.55, '#a6bdcc');
    g.addColorStop(0.8, '#f5fafa');
    g.addColorStop(1, '#65809a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // Indigo bands, and bright water sheeting down the plastic.
    ctx.fillStyle = 'rgba(30,55,105,0.55)';
    for (let yy = b.min.y; yy < top; yy += 3.2) ctx.fillRect(this.X(midX - 1), this.Y(yy + 0.5), this.s * 2, this.s * 0.5);
    ctx.strokeStyle = 'rgba(205,245,255,0.7)';
    ctx.lineWidth = this.s * 0.03;
    for (let i = 0; i < 5; i++) {
      const lx = midX - 0.4 + i * 0.2;
      const span = top - b.min.y;
      const yy = top - ((this.time * (2.6 + i * 0.5) + i * 3) % span);
      ctx.beginPath();
      ctx.moveTo(this.X(lx), this.Y(yy + 1.6));
      ctx.lineTo(this.X(lx), this.Y(yy));
      ctx.stroke();
    }
    ctx.restore();
    // Chrome rings where it hangs from the rod.
    ctx.fillStyle = this.chromeGradient(this.X(midX - 1.2), 0, this.X(midX + 1.2), 0);
    ctx.fillRect(this.X(midX - 1.2), this.Y(top + 0.25), this.s * 2.4, this.s * 0.2);
  }

  private drawBottle(b: Box): void {
    const ctx = this.ctx;
    const midX = (b.min.x + b.max.x) / 2;
    const x = this.X(midX - 0.75);
    const y = this.Y(b.max.y - 1);
    const w = this.s * 1.5;
    const h = this.s * (b.max.y - 1 - b.min.y);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#ad3a2a');
    g.addColorStop(0.3, '#f39067');
    g.addColorStop(0.65, '#d65636');
    g.addColorStop(1, '#7c2518');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, this.s * 0.28);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,246,220,0.9)';
    ctx.fillRect(x + w * 0.14, y + h * 0.3, w * 0.72, h * 0.38);
    ctx.fillStyle = '#7c2518';
    ctx.fillRect(x + w * 0.24, y + h * 0.4, w * 0.52, h * 0.05);
    ctx.fillRect(x + w * 0.24, y + h * 0.5, w * 0.36, h * 0.04);
    ctx.fillStyle = this.chromeGradient(this.X(midX - 0.2), 0, this.X(midX + 0.2), 0);
    ctx.fillRect(this.X(midX - 0.16), this.Y(b.max.y), this.s * 0.32, this.s);
  }

  private drawProps(): void {
    if (!this.propSheet.complete) return;
    const ctx = this.ctx;
    for (const p of this.props) {
      if (Math.abs(p.x - this.camX) > this.w / this.s / 2 + 3 || Math.abs(p.y - this.camY) > this.h / this.s / 2 + 3) continue;
      const size = PROP_SIZES[p.kind] * p.scale * this.s;
      const sway = p.kind < 4 ? Math.sin(this.time * 1.2 + p.x) * 0.03 : 0;
      ctx.save();
      ctx.translate(this.X(p.x), this.Y(p.y) + this.s * 0.05);
      ctx.transform(p.flip ? -1 : 1, 0, sway, 1, 0, 0);
      ctx.drawImage(this.propSheet, p.kind * PROP_CELL, 0, PROP_CELL, PROP_CELL, -size / 2, -size, size, size);
      ctx.restore();
    }
  }

  private drawRails(game: TrialGame): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (const r of game.level.rails) {
      const a = r.points[0];
      const b = r.points[r.points.length - 1];
      const dx = this.X(b.x - a.x);
      const dy = this.Y(b.y) - this.Y(a.y);
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * this.s * 0.1;
      const ny = (dx / len) * this.s * 0.1;
      const mx = (this.X(a.x) + this.X(b.x)) / 2;
      const my = (this.Y(a.y) + this.Y(b.y)) / 2;
      ctx.strokeStyle = 'rgba(0,16,22,0.4)';
      ctx.lineWidth = this.s * 0.2;
      ctx.beginPath();
      ctx.moveTo(this.X(a.x), this.Y(a.y) + this.s * 0.28);
      ctx.lineTo(this.X(b.x), this.Y(b.y) + this.s * 0.28);
      ctx.stroke();
      ctx.strokeStyle = this.chromeGradient(mx - nx, my - ny, mx + nx, my + ny);
      ctx.lineWidth = this.s * 0.2;
      ctx.beginPath();
      ctx.moveTo(this.X(a.x), this.Y(a.y));
      ctx.lineTo(this.X(b.x), this.Y(b.y));
      ctx.stroke();
    }
    // Sparks and spray off the rail.
    const n = game.ninja;
    if (game.phase === 'playing' && n.state === 'grind') {
      ctx.fillStyle = '#fff2b8';
      for (let i = 0; i < 8; i++) {
        const t = (this.time * 7 + i * 0.37) % 1;
        const a = i * 2.4;
        ctx.globalAlpha = 1 - t;
        ctx.fillRect(this.X(n.pos.x - n.facing * t * (1 + (i % 3))) , this.Y(n.pos.y + Math.sin(a) * 0.3 + t * (i % 2 ? 0.8 : -0.5)), this.s * 0.06, this.s * 0.06);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawAnchors(game: TrialGame): void {
    const ctx = this.ctx;
    for (const a of game.level.anchors) {
      const active = game.wireTarget === a;
      const x = this.X(a.x);
      const y = this.Y(a.y);
      if (active) {
        ctx.strokeStyle = 'rgba(255,215,140,0.9)';
        ctx.lineWidth = this.s * 0.05;
        ctx.beginPath();
        ctx.arc(x, y, this.s * (0.8 + Math.sin(this.time * 7) * 0.08), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = this.chromeGradient(x - this.s * 0.5, y - this.s * 0.5, x + this.s * 0.5, y + this.s * 0.5);
      ctx.lineWidth = this.s * 0.15;
      ctx.beginPath();
      ctx.arc(x, y, this.s * 0.46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = this.chromeGradient(x - this.s * 0.1, 0, x + this.s * 0.1, 0);
      ctx.fillRect(x - this.s * 0.07, this.Y(a.y + 40), this.s * 0.14, this.s * 39.6);
    }
  }

  /** The summit: a golden spout and a paper lantern. */
  private drawGoal(game: TrialGame): void {
    const ctx = this.ctx;
    const g = game.level.goal;
    const x = this.X(g.x);
    const y = this.Y(g.y + 0.3);
    const pulse = 0.9 + Math.sin(this.time * 2.4) * 0.1;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, this.s * 3.6 * pulse);
    glow.addColorStop(0, 'rgba(255,225,150,0.72)');
    glow.addColorStop(1, 'rgba(255,225,150,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - this.s * 4, y - this.s * 4, this.s * 8, this.s * 8);
    const body = ctx.createRadialGradient(x - this.s * 0.2, y - this.s * 0.25, this.s * 0.1, x, y, this.s * 0.8);
    body.addColorStop(0, '#fffbe8');
    body.addColorStop(0.65, '#ffd67e');
    body.addColorStop(1, '#d6652e');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, y, this.s * 0.65, this.s * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#23161a';
    ctx.fillRect(x - this.s * 0.3, y - this.s * 0.92, this.s * 0.6, this.s * 0.14);
    ctx.fillRect(x - this.s * 0.3, y + this.s * 0.78, this.s * 0.6, this.s * 0.14);
    ctx.strokeStyle = 'rgba(160,70,30,0.5)';
    ctx.lineWidth = this.s * 0.02;
    for (const k of [-0.4, 0, 0.4]) {
      ctx.beginPath();
      ctx.ellipse(x, y, this.s * Math.abs(k) * 1.5 + 0.1, this.s * 0.82, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawBouncers(game: TrialGame): void {
    const ctx = this.ctx;
    for (const b of game.bouncers) {
      if (b.gone > 0) continue;
      const x = this.X(b.pos.x);
      const y = this.Y(b.pos.y);
      const r = b.spec.r * this.s;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 + b.squash * 0.25, 1 - b.squash * 0.32);
      const fill = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
      fill.addColorStop(0, 'rgba(255,255,255,0.06)');
      fill.addColorStop(0.8, 'rgba(195,225,255,0.22)');
      fill.addColorStop(1, 'rgba(255,255,255,0.8)');
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      // Thin-film colour swirling around the rim.
      for (let i = 0; i < 3; i++) {
        const a = this.time * 0.8 + (i * Math.PI * 2) / 3;
        ctx.strokeStyle = ['rgba(255,120,190,0.75)', 'rgba(110,235,200,0.75)', 'rgba(255,225,110,0.75)'][i];
        ctx.lineWidth = r * 0.055;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.93, a, a + 1.5);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.36, -r * 0.42, r * 0.2, r * 0.11, -0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawWetCells(game: TrialGame): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(16,80,105,0.5)';
    for (const c of game.grid.cells.values()) {
      if (c.axis === 1) ctx.fillRect(this.X(c.x - 0.75), this.Y(c.y), this.s * 1.5, this.s * 0.17);
      else ctx.fillRect(this.X(c.x) - this.s * 0.08, this.Y(c.y + 0.75), this.s * 0.16, this.s * 1.5);
    }
  }

  /** Before a heavy drop lands, a thin line and a closing ring mark exactly where. */
  private drawShadows(game: TrialGame): void {
    const ctx = this.ctx;
    for (const d of game.droplets) {
      const height = d.pos.y - d.landY;
      const near = Math.max(0, 1 - height / 18);
      ctx.strokeStyle = `rgba(200,240,255,${0.08 + near * 0.28})`;
      ctx.lineWidth = this.s * 0.025;
      ctx.setLineDash([this.s * 0.25, this.s * 0.25]);
      ctx.beginPath();
      ctx.moveTo(this.X(d.pos.x), this.Y(d.pos.y));
      ctx.lineTo(this.X(d.pos.x), this.Y(d.landY));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.translate(this.X(d.pos.x), this.Y(d.landY) - this.s * 0.02);
      ctx.scale(1, 0.26);
      ctx.fillStyle = `rgba(0,28,48,${0.2 + near * 0.45})`;
      ctx.beginPath();
      ctx.arc(0, 0, this.s * (0.35 + near * 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.2 + near * 0.7})`;
      ctx.lineWidth = this.s * 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, this.s * (1.6 - near), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private pickStrip(game: TrialGame): string {
    const n = game.ninja;
    const k = game.katana;
    if (k.swinging) return k.side > 0 ? 'cutA' : 'cutB';
    if (n.iframes > 0.3 && n.state !== 'dash') return 'hurt';
    if (n.state === 'dash') return 'dash';
    if (n.state === 'slide' || n.state === 'grind') return 'slide';
    if (n.state === 'wallrun') return 'run';
    if (n.wire.attached) return 'wire';
    if (!n.grounded) return 'air';
    if (n.speed > 0.7) return 'run';
    return 'idle';
  }

  private frameOf(strip: string, t: number): number {
    const s = __ATLAS__.strips[strip];
    return s.start + (Math.floor(t) % s.count);
  }

  private blit(frame: number, x: number, y: number, facing: number, rotation: number, alpha: number): void {
    const a = __ATLAS__;
    const ctx = this.ctx;
    const size = a.metresPerCell * this.s;
    const sx = (frame % a.columns) * a.cell;
    const sy = Math.floor(frame / a.columns) * a.cell;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.X(x), this.Y(y));
    if (rotation) ctx.rotate(rotation);
    ctx.scale(facing, 1);
    ctx.drawImage(this.ninja, sx, sy, a.cell, a.cell, -size / 2, -size * (1 - a.feetFromBottom), size, size);
    ctx.restore();
  }

  private drawGhosts(dt: number): void {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.age += dt;
      if (g.age > 0.28) {
        this.ghosts.splice(i, 1);
        continue;
      }
      this.blit(g.frame, g.x, g.y, g.facing, 0, (1 - g.age / 0.28) * 0.42);
    }
  }

  private drawWire(game: TrialGame): void {
    const a = game.ninja.wire.anchor;
    if (!a) return;
    const ctx = this.ctx;
    const c = game.ninja.center;
    ctx.strokeStyle = '#141c2c';
    ctx.lineWidth = this.s * 0.05;
    ctx.beginPath();
    ctx.moveTo(this.X(c.x), this.Y(c.y + 0.6));
    ctx.lineTo(this.X(a.x), this.Y(a.y));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,225,170,0.7)';
    ctx.lineWidth = this.s * 0.015;
    ctx.stroke();
  }

  private drawNinja(dt: number, game: TrialGame): void {
    const n = game.ninja;
    const k = game.katana;
    const strip = this.pickStrip(game);
    if (strip !== this.currentStrip) {
      this.currentStrip = strip;
      this.frameT = 0;
    }
    const rate = strip === 'run' ? Math.max(8, (n.state === 'wallrun' ? 8 : n.speed) * 1.6) : strip === 'idle' ? 5 : strip === 'air' ? 7 : 12;
    this.frameT += dt * rate;
    let frame = this.frameOf(strip, this.frameT);
    if (k.swinging) frame = __ATLAS__.strips[strip].start + Math.min(__ATLAS__.strips[strip].count - 1, Math.floor(k.progress * __ATLAS__.strips[strip].count));
    if (strip === 'dash' || strip === 'hurt') frame = Math.min(__ATLAS__.strips[strip].start + __ATLAS__.strips[strip].count - 1, __ATLAS__.strips[strip].start + Math.floor(this.frameT));

    // Face the reticle while cutting. Running up a wall tips him so his feet are on it.
    const facing = n.facing;
    let rotation = 0;
    let dx = 0;
    let dy = 0;
    if (n.state === 'wallrun') {
      rotation = n.wallSide > 0 ? -Math.PI / 2 : Math.PI / 2;
      dx = n.wallSide * 0.3;
      dy = 0.9;
    } else if (n.state === 'grind') {
      rotation = -Math.atan2(n.vel.y, Math.abs(n.vel.x)) * n.facing;
    }
    const flicker = n.iframes > 0 && n.state !== 'dash' && Math.floor(this.time * 30) % 2 === 0;
    if (n.state === 'dash' && this.ghosts.length < 8) this.ghosts.push({ x: n.pos.x, y: n.pos.y, frame, facing, age: 0 });
    if (!flicker) this.blit(frame, n.pos.x + dx, n.pos.y + dy, n.state === 'wallrun' ? n.wallSide : facing, rotation, 1);
  }

  /** A white crescent over the blade's real reach, sweeping as the swing progresses. */
  private drawSlash(game: TrialGame): void {
    const k = game.katana;
    if (!k.swinging) return;
    const ctx = this.ctx;
    const n = game.ninja;
    const eye = n.eye;
    const aim = this.lastAim;
    const center = Math.atan2(-aim.y, aim.x);
    const span = ARC * k.side;
    const start = center - span / 2;
    const end = start + span * k.progress;
    const steps = 18;
    const R = RANGE * this.s;
    ctx.save();
    ctx.translate(this.X(eye.x), this.Y(eye.y));
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, R * 0.25, 0, 0, R);
    g.addColorStop(0, 'rgba(180,225,255,0)');
    g.addColorStop(0.72, 'rgba(195,235,255,0.2)');
    g.addColorStop(0.97, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = start + ((end - start) * i) / steps;
      const r = R * (0.92 + 0.08 * Math.sin((i / steps) * Math.PI));
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = steps; i >= 0; i--) {
      const a = start + ((end - start) * i) / steps;
      const r = R * (0.42 + (0.45 * i) / steps);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // The leading edge is the blade itself.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = this.s * 0.05;
    ctx.beginPath();
    ctx.moveTo(this.X(eye.x) + Math.cos(end) * R * 0.25, this.Y(eye.y) + Math.sin(end) * R * 0.25);
    ctx.lineTo(this.X(eye.x) + Math.cos(end) * R * 0.98, this.Y(eye.y) + Math.sin(end) * R * 0.98);
    ctx.stroke();
  }

  lastAim = { x: 1, y: 0 };

  private drawStreams(game: TrialGame, back: boolean): void {
    const ctx = this.ctx;
    for (const s of game.streams) {
      if (!s.on) continue;
      const length = Math.min(s.length, s.blockedAt);
      if (length <= 0.05) continue;
      const o = s.spec.origin;
      const ex = o.x + s.dir.x * length;
      const ey = o.y + s.dir.y * length;
      const x0 = this.X(o.x);
      const y0 = this.Y(o.y);
      const x1 = this.X(ex);
      const y1 = this.Y(ey);
      const r = s.spec.radius * this.s;
      if (back) {
        // A soft glow behind the water.
        ctx.strokeStyle = 'rgba(90,190,255,0.22)';
        ctx.lineWidth = r * 3.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        continue;
      }
      const nx = -(y1 - y0);
      const ny = x1 - x0;
      const l = Math.hypot(nx, ny) || 1;
      const ux = (nx / l) * r;
      const uy = (ny / l) * r;
      const g = ctx.createLinearGradient(x0 - ux, y0 - uy, x0 + ux, y0 + uy);
      g.addColorStop(0, 'rgba(35,120,215,0.92)');
      g.addColorStop(0.3, 'rgba(200,240,255,0.97)');
      g.addColorStop(0.55, 'rgba(80,170,240,0.95)');
      g.addColorStop(1, 'rgba(20,90,190,0.92)');
      ctx.strokeStyle = g;
      ctx.lineWidth = r * 2;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      // Fast white flecks show the pressure.
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1, r * 0.2);
      ctx.setLineDash([this.s * 0.7, this.s * 1.1]);
      ctx.lineDashOffset = -this.time * this.s * 30;
      ctx.beginPath();
      ctx.moveTo(x0 + ux * 0.4, y0 + uy * 0.4);
      ctx.lineTo(x1 + ux * 0.4, y1 + uy * 0.4);
      ctx.stroke();
      ctx.setLineDash([this.s * 0.4, this.s * 1.7]);
      ctx.lineDashOffset = -this.time * this.s * 22;
      ctx.beginPath();
      ctx.moveTo(x0 - ux * 0.5, y0 - uy * 0.5);
      ctx.lineTo(x1 - ux * 0.5, y1 - uy * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      // Foam where it hits.
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 7; i++) {
        const a = this.time * 9 + i * 2.2;
        const fr = (r * 0.45 + this.s * 0.05) * (1 + Math.sin(a) * 0.4);
        ctx.beginPath();
        ctx.arc(x1 + Math.cos(i * 1.7 + this.time) * r * 1.3, y1 + Math.sin(a) * r * 0.5, fr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawMist(game: TrialGame): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffffff';
    for (const m of game.mist) {
      ctx.globalAlpha = Math.max(0, 1 - m.age / m.life) * 0.85;
      ctx.beginPath();
      ctx.arc(this.X(m.pos.x), this.Y(m.pos.y), this.s * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Real refraction: each droplet shows the frame behind it, flipped and shrunk, as a lens does. */
  private refract(px: number, py: number, r: number, originX: number, originY: number, clip: () => void): void {
    const ctx = this.ctx;
    const dx = px + originX;
    const dy = py + originY;
    ctx.save();
    ctx.beginPath();
    clip();
    ctx.clip();
    ctx.setTransform(-1, 0, 0, -1, 2 * dx, 2 * dy);
    const span = r * 4.4;
    ctx.drawImage(this.canvas, dx - span / 2, dy - span / 2, span, span, dx - r * 1.05, dy - r * 1.05, r * 2.1, r * 2.1);
    ctx.restore();
  }

  private drawDroplets(game: TrialGame, originX: number, originY: number): void {
    const ctx = this.ctx;
    for (const d of game.droplets) {
      const px = this.X(d.pos.x);
      const py = this.Y(d.pos.y);
      const r = d.r * this.s;
      if (px + originX < -r || px + originX > this.w + r || py + originY < -r || py + originY > this.h + r) continue;
      const stretch = 1 + Math.min(0.35, Math.abs(d.vel.y) * 0.012);
      // A droplet is pointed on top when it falls fast.
      const drop = () => {
        ctx.moveTo(px, py - r * stretch * 1.25);
        ctx.bezierCurveTo(px + r * 0.5, py - r * 0.7, px + r, py - r * 0.1, px + r, py + r * 0.15);
        ctx.arc(px, py + r * 0.15, r, 0, Math.PI);
        ctx.bezierCurveTo(px - r, py - r * 0.1, px - r * 0.5, py - r * 0.7, px, py - r * stretch * 1.25);
      };
      this.refract(px, py, r, originX, originY, drop);
      const rim = ctx.createRadialGradient(px, py, r * 0.55, px, py, r * 1.1);
      rim.addColorStop(0, 'rgba(60,160,235,0.12)');
      rim.addColorStop(0.75, 'rgba(70,170,245,0.55)');
      rim.addColorStop(1, 'rgba(225,248,255,0.95)');
      ctx.fillStyle = rim;
      ctx.beginPath();
      drop();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.ellipse(px - r * 0.35, py - r * 0.2, r * 0.2, r * 0.3, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Halves: two caps drifting apart, cut faces bright.
    for (const h of game.halves) {
      const a = Math.atan2(-h.axis.y, h.axis.x);
      const r = h.r * this.s;
      const px = this.X(h.pos.x);
      const py = this.Y(h.pos.y);
      const fade = halfFade(h);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(px, py);
      ctx.rotate(a);
      const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
      g.addColorStop(0, 'rgba(95,185,250,0.75)');
      g.addColorStop(1, 'rgba(225,248,255,0.95)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = this.s * 0.04;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawRings(dt: number): void {
    const ctx = this.ctx;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.age += dt;
      const t = ring.age / 0.36;
      if (t >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `${ring.color}${1 - t})`;
      ctx.lineWidth = this.s * 0.07 * (1 - t);
      ctx.beginPath();
      ctx.arc(this.X(ring.x), this.Y(ring.y), this.s * ring.size * (0.2 + t), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawTrails(game: TrialGame): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = this.s * 0.03;
    for (const d of game.droplets) {
      ctx.beginPath();
      let x = d.pos.x;
      let y = d.pos.y;
      let vy = d.vel.y;
      ctx.moveTo(this.X(x), this.Y(y));
      for (let i = 0; i < 12; i++) {
        vy -= 22 * 0.06;
        x += d.vel.x * 0.06;
        y = Math.max(d.landY, y + vy * 0.06);
        ctx.lineTo(this.X(x), this.Y(y));
      }
      ctx.stroke();
    }
  }

  private drawSteam(game: TrialGame, originX: number, originY: number): void {
    if (this.steam < 0.02) return;
    const ctx = this.ctx;
    const c = game.ninja.center;
    const x = this.X(c.x) + originX;
    const y = this.Y(c.y) + originY;
    const g = ctx.createRadialGradient(x, y, this.s * 2.5, x, y, this.s * 8.5);
    g.addColorStop(0, 'rgba(235,245,240,0)');
    g.addColorStop(0.55, `rgba(235,245,240,${this.steam * 0.85})`);
    g.addColorStop(1, `rgba(235,245,240,${this.steam * 0.98})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    // Slow rolling clouds in the fog.
    ctx.globalAlpha = this.steam * 0.28;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 7; i++) {
      const px = ((i * 310 + this.time * (14 + i * 3) * this.dpr) % (this.w + 500)) - 250;
      const py = (this.h * (i + 0.5)) / 7;
      ctx.beginPath();
      ctx.ellipse(px, py, this.s * 3.6, this.s * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawVignette(): void {
    const ctx = this.ctx;
    const r = Math.hypot(this.w, this.h) / 2;
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, r * 0.5, this.w / 2, this.h / 2, r);
    g.addColorStop(0, 'rgba(0,12,20,0)');
    g.addColorStop(1, 'rgba(0,12,20,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /** Water on the lens runs down it and bends the picture. */
  private drawLens(dt: number): void {
    const ctx = this.ctx;
    for (let i = this.lens.length - 1; i >= 0; i--) {
      const d = this.lens[i];
      d.age += dt;
      d.y += d.speed * dt * (1 + d.age * 0.5);
      if (d.age > d.life || d.y > 1.1) {
        this.lens.splice(i, 1);
        continue;
      }
      const a = Math.min(1, (d.life - d.age) * 2);
      const px = d.x * this.w;
      const py = d.y * this.h;
      const r = d.r * this.h;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.moveTo(px - r * 0.95, py - r * 0.2);
      ctx.quadraticCurveTo(px, py - r * 4.2, px + r * 0.95, py - r * 0.2);
      ctx.clip();
      ctx.setTransform(-1, 0, 0, -1, 2 * px, 2 * py - r * 1.2);
      ctx.drawImage(this.canvas, px - r * 3, py - r * 3, r * 6, r * 6, px - r * 1.1, py - r * 3.3, r * 2.2, r * 4.6);
      ctx.restore();
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(px - r * 0.34, py - r * 0.3, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** The cursor is hidden while playing, so the reticle stands in for it. */
  private drawReticle(game: TrialGame, mouseX: number, mouseY: number): void {
    const ctx = this.ctx;
    const x = mouseX * this.dpr;
    const y = mouseY * this.dpr;
    const r = 11 * this.dpr;
    const wire = game.wireTarget !== null;
    ctx.lineWidth = 2 * this.dpr;
    for (const [color, width] of [['#10203a', 5], [wire ? '#ffd27a' : '#fff6e0', 2]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * this.dpr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0.3, 1.27);
      ctx.moveTo(x + Math.cos(1.87) * r, y + Math.sin(1.87) * r);
      ctx.arc(x, y, r, 1.87, 2.84);
      ctx.moveTo(x + Math.cos(3.44) * r, y + Math.sin(3.44) * r);
      ctx.arc(x, y, r, 3.44, 4.41);
      ctx.moveTo(x + Math.cos(5.01) * r, y + Math.sin(5.01) * r);
      ctx.arc(x, y, r, 5.01, 5.98);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff6e0';
    ctx.beginPath();
    ctx.arc(x, y, 1.8 * this.dpr, 0, Math.PI * 2);
    ctx.fill();
  }
}
