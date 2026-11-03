import * as THREE from 'three';
import { makeRng } from './BoardGeometry.ts';

/** Crack patterns per damage level (1–3), and the tiles of the atlas: 15 patterns and an empty one. */
export const CRACK_VARIANTS = 5;
export const CRACK_TILES = 16;
export const CRACK_EMPTY = CRACK_TILES - 1;
/** Where along the board (0–1) each variant's stone struck: its cracks spread from there, and it sags there. */
export const CRACK_IMPACT_V = [0.45, 0.58, 0.38, 0.62, 0.5];

/** Pixels per tile: across the board (0.24 m) and along it (1.6 m), about 4 mm and 3 mm a pixel. */
const TILE_W = 64;
const TILE_H = 512;

type Layer = CanvasRenderingContext2D;

function layer(w: number, h: number): Layer {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2D canvas unavailable');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return g;
}

function stroke(g: Layer, x0: number, y0: number, x1: number, y1: number, width: number, alpha: number): void {
  g.strokeStyle = `rgba(255,255,255,${alpha})`;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

/**
 * One damage pattern: splits wandering along the grain from the impact (longer and wider with each
 * level), torn pale fibres and splinters along them, crushed wood where the stone hit, and on a board
 * that gave way a jagged break right across it. Drawn into three layers: open gaps, raw rims, crush.
 */
function drawTile(x0: number, level: number, impactY: number, rng: () => number, gap: Layer, rim: Layer, crush: Layer): void {
  for (const g of [gap, rim, crush]) {
    g.save();
    g.beginPath();
    g.rect(x0, 0, TILE_W, TILE_H);
    g.clip();
  }
  const split = (cx: number, extent: number, width: number, rimWidth: number) => {
    for (const dir of [-1, 1]) {
      let x = cx;
      let y = impactY;
      while (Math.abs(y - impactY) < extent && y > -8 && y < TILE_H + 8) {
        const nx = Math.min(TILE_W - 6, Math.max(6, x + (rng() - 0.5) * 3 + (rng() < 0.12 ? (rng() - 0.5) * 10 : 0)));
        const ny = y + dir * (5 + rng() * 9);
        const along = Math.min(1, Math.abs(ny - impactY) / extent);
        const w = width * (1 - along * along) * (0.55 + 0.9 * rng());
        stroke(gap, x0 + x, y, x0 + nx, ny, Math.max(0.5, w), 1);
        stroke(rim, x0 + x, y, x0 + nx, ny, w + rimWidth * (0.3 + 1.3 * rng()), 0.5 + 0.5 * rng());
        // Splinters peel off at a slant along the grain.
        if (rng() < 0.3) stroke(rim, x0 + nx, ny, x0 + nx + (rng() - 0.5) * 7, ny + dir * (6 + rng() * 16), 1 + rng() * 1.5, 0.8);
        x = nx;
        y = ny;
      }
    }
  };
  const cx = 22 + rng() * 20;
  const side = cx < TILE_W / 2 ? 1 : -1;
  if (level === 1) split(cx, TILE_H * 0.3, 1.3, 2.5);
  if (level === 2) {
    split(cx, TILE_H * 0.6, 2.3, 5);
    split(cx + side * (13 + rng() * 7), TILE_H * 0.35, 1.4, 3.5);
  }
  if (level === 3) {
    split(cx, TILE_H * 1.3, 3.6, 7);
    split(cx + side * (13 + rng() * 7), TILE_H * 0.7, 2.2, 5);
    split(side > 0 ? TILE_W - 10 : 10, TILE_H * 0.3, 1.4, 3);
    // Broken right across where it gave way.
    let x = -4;
    let y = impactY + (rng() - 0.5) * 10;
    while (x < TILE_W + 4) {
      const nx = x + 3 + rng() * 6;
      const ny = impactY + (rng() - 0.5) * 16;
      stroke(gap, x0 + x, y, x0 + nx, ny, 2.5 + rng() * 2, 1);
      stroke(rim, x0 + x, y, x0 + nx, ny, 8 + rng() * 6, 0.7);
      x = nx;
      y = ny;
    }
  }
  if (level >= 2) {
    // Crushed fibres round the impact.
    const r = level === 2 ? 14 : 20;
    const blot = crush.createRadialGradient(x0 + cx, impactY, 1, x0 + cx, impactY, r);
    blot.addColorStop(0, 'rgba(255,255,255,1)');
    blot.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    blot.addColorStop(1, 'rgba(255,255,255,0)');
    crush.fillStyle = blot;
    crush.fillRect(x0 + cx - r, impactY - r, r * 2, r * 2);
    for (let i = 0; i < 40; i++) {
      crush.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * rng()})`;
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 1.3;
      crush.fillRect(x0 + cx + Math.cos(a) * d, impactY + Math.sin(a) * d * 1.6, 1 + rng() * 2, 1 + rng() * 3);
    }
  }
  for (const g of [gap, rim, crush]) g.restore();
}

/**
 * The damage patterns of the deck's boards in one texture, laid out as tiles across it (tile t covers
 * u from t / CRACK_TILES): red is an open crack, green the pale torn wood along it, blue crushed fibres.
 * Drawn once at load; mipmapped, a split far below a pixel fades out instead of shimmering, and a board
 * costs one texture read for its damage instead of a stack of noise.
 */
export function crackAtlas(anisotropy: number): THREE.Texture {
  const W = TILE_W * CRACK_TILES;
  const H = TILE_H;
  const gap = layer(W, H);
  const rim = layer(W, H);
  const crush = layer(W, H);
  for (let level = 1; level <= 3; level++) {
    for (let v = 0; v < CRACK_VARIANTS; v++) {
      const t = (level - 1) * CRACK_VARIANTS + v;
      drawTile(t * TILE_W, level, CRACK_IMPACT_V[v] * H, makeRng(0xc4ac + t * 7919), gap, rim, crush);
    }
  }
  const out = layer(W, H);
  const img = out.createImageData(W, H);
  const g = gap.getImageData(0, 0, W, H).data;
  const r = rim.getImageData(0, 0, W, H).data;
  const c = crush.getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = g[i * 4];
    img.data[i * 4 + 1] = r[i * 4];
    img.data[i * 4 + 2] = c[i * 4];
    img.data[i * 4 + 3] = 255;
  }
  out.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out.canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}
