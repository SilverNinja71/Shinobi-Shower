/** Maps world metres to canvas pixels: x grows right, y grows up from the ground line. */
export interface View {
  s: number;
  ox: number;
  groundY: number;
}

export const X = (v: View, x: number) => v.ox + x * v.s;
export const Y = (v: View, y: number) => v.groundY - y * v.s;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  kind: 'dot' | 'shard' | 'puff' | 'ember';
  spin: number;
}

interface Ripple {
  x: number;
  r: number;
  max: number;
  life: number;
  color: string;
}

interface Text {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
}

export const COLORS = {
  water: '#58e6ff',
  flame: '#ff4a3d',
  ember: '#ffb347',
  spirit: '#b88cff',
  snow: '#eef4ff',
  hail: '#cfe3f2',
  danger: '#ff5468',
};

/** Ripples on the rooftop puddles, vapour, shards, embers, screen shake and flashes. */
export class PostProcessVFX {
  private readonly particles: Particle[] = [];
  private readonly ripples: Ripple[] = [];
  private readonly texts: Text[] = [];
  shake = 0;
  flash = 0;
  flashColor = '#ffffff';
  /** Red edge glow after taking a hit. */
  hurt = 0;
  readonly reducedMotion: boolean;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
  }

  private add(p: Partial<Particle> & { x: number; y: number }): void {
    if (this.particles.length > 700) this.particles.shift();
    this.particles.push({ vx: 0, vy: 0, life: 0.5, max: 0.5, size: 0.05, color: COLORS.water, gravity: 9, kind: 'dot', spin: 0, ...p });
  }

  addShake(a: number): void {
    if (!this.reducedMotion) this.shake = Math.min(0.6, this.shake + a);
  }

  doFlash(a: number, color = '#ffffff'): void {
    this.flash = Math.max(this.flash, this.reducedMotion ? a * 0.4 : a);
    this.flashColor = color;
  }

  ripple(x: number, size: number, color = COLORS.water): void {
    if (this.ripples.length > 60) this.ripples.shift();
    this.ripples.push({ x, r: 0.05, max: size, life: 0, color });
  }

  spray(x: number, y: number, count: number, color: string, speed = 3, size = 0.05): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      const life = 0.25 + Math.random() * 0.3;
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + speed * 0.3, life, max: life, size, color });
    }
  }

  shards(x: number, y: number, count: number, color: string, speed = 5): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.5 + Math.random());
      const life = 0.5 + Math.random() * 0.4;
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 2, life, max: life, size: 0.08 + Math.random() * 0.1, color, kind: 'shard', spin: (Math.random() - 0.5) * 20 });
    }
  }

  puff(x: number, y: number, count: number, color = 'rgba(235,240,255,0.55)', radius = 1, size = 0.3): void {
    for (let i = 0; i < count; i++) {
      const life = 0.6 + Math.random() * 0.6;
      this.add({ x: x + (Math.random() - 0.5) * radius, y: y + (Math.random() - 0.5) * radius * 0.6, vx: (Math.random() - 0.5) * 1.2, vy: 0.6 + Math.random() * 1.2, life, max: life, size: size * (0.8 + Math.random() * 1.2), color, gravity: 0, kind: 'puff' });
    }
  }

  ember(x: number, y: number): void {
    const life = 0.5 + Math.random() * 0.7;
    this.add({ x, y, vx: (Math.random() - 0.5) * 0.8, vy: 0.8 + Math.random(), life, max: life, size: 0.035 + Math.random() * 0.03, color: COLORS.ember, gravity: -0.5, kind: 'ember' });
  }

  float(x: number, y: number, text: string, color: string): void {
    if (this.texts.length > 12) this.texts.shift();
    this.texts.push({ x, y, text, life: 0, color });
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.hurt = Math.max(0, this.hurt - dt * 1.4);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'puff') p.size += dt * 0.6;
      if (p.y < 0 && p.kind !== 'puff') {
        p.y = 0;
        p.vy *= -0.3;
        p.vx *= 0.6;
      }
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.life += dt;
      r.r = r.max * Math.min(1, r.life / 0.6);
      if (r.life > 0.7) this.ripples.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life += dt;
      t.y += dt * 0.9;
      if (t.life > 0.9) this.texts.splice(i, 1);
    }
  }

  shakeOffset(time: number): [number, number] {
    if (this.shake <= 0) return [0, 0];
    const a = this.shake * this.shake * 14;
    return [Math.sin(time * 91) * a, Math.cos(time * 77) * a];
  }

  drawRipples(ctx: CanvasRenderingContext2D, v: View): void {
    ctx.lineWidth = Math.max(1, v.s * 0.03);
    for (const r of this.ripples) {
      ctx.globalAlpha = 0.55 * (1 - r.life / 0.7);
      ctx.strokeStyle = r.color;
      ctx.beginPath();
      ctx.ellipse(X(v, r.x), v.groundY + v.s * 0.18, r.r * v.s, r.r * v.s * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawParticles(ctx: CanvasRenderingContext2D, v: View): void {
    for (const p of this.particles) {
      const k = p.life / p.max;
      const px = X(v, p.x);
      const py = Y(v, p.y);
      const size = p.size * v.s;
      ctx.fillStyle = p.color;
      if (p.kind === 'puff') {
        ctx.globalAlpha = k * 0.7;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'shard') {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.spin * (p.max - p.life));
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.6, size * 0.4);
        ctx.lineTo(-size * 0.5, size * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, size), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx: CanvasRenderingContext2D, v: View, font: string): void {
    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.round(Math.max(12, v.s * 0.42))}px ${font}`;
    for (const t of this.texts) {
      ctx.globalAlpha = 1 - t.life / 0.9;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, X(v, t.x), Y(v, t.y));
    }
    ctx.globalAlpha = 1;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.55;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    if (this.hurt > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
      g.addColorStop(0, 'rgba(255,60,80,0)');
      g.addColorStop(1, `rgba(255,60,80,${0.45 * this.hurt})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
