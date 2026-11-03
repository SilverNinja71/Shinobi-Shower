import * as THREE from 'three';
import { makeRng } from './BoardGeometry.ts';

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

/**
 * Loose hemp fibres for the frayed tufts: strands from a root along the bottom edge (v = 0) fanning
 * out toward the top, on a transparent ground (drawn with alpha cutout).
 */
export function fibreTexture(): THREE.Texture {
  const W = 64;
  const H = 128;
  const [c, g] = canvas(W, H);
  const rng = makeRng(0xf1b4e);
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x0 = W * (0.3 + 0.4 * rng());
    const spread = (rng() - 0.5) * W * 0.9;
    const len = H * (0.45 + 0.55 * rng());
    const bend = (rng() - 0.5) * W * 0.5;
    const shade = 0.55 + 0.45 * rng();
    g.strokeStyle = `rgb(${Math.round(176 * shade)}, ${Math.round(152 * shade)}, ${Math.round(112 * shade)})`;
    g.lineWidth = 0.8 + rng() * 1.6;
    g.beginPath();
    g.moveTo(x0, H);
    g.quadraticCurveTo(x0 + bend, H - len * 0.5, x0 + spread, H - len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Oiled paper for the lantern panels, lit from inside: hot in the middle, darker toward the frame,
 * with the shadows of a bamboo lattice and paper fibres.
 */
export function paperTexture(): THREE.Texture {
  const S = 64;
  const [c, g] = canvas(S, S);
  const rng = makeRng(0x9a7e5);
  const glow = g.createRadialGradient(S / 2, S * 0.56, 2, S / 2, S / 2, S * 0.7);
  glow.addColorStop(0, '#fff1c8');
  glow.addColorStop(0.45, '#ffc46e');
  glow.addColorStop(1, '#a8501c');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  // Fibres and stains.
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(${rng() < 0.5 ? '90,40,10' : '255,230,180'}, ${0.04 + rng() * 0.08})`;
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 6, 1);
  }
  // Lattice shadows.
  g.fillStyle = 'rgba(40, 14, 4, 0.55)';
  g.fillRect(0, S * 0.33, S, 2);
  g.fillRect(0, S * 0.66, S, 2);
  g.fillRect(S * 0.5 - 1, 0, 2, S);
  g.fillStyle = 'rgba(30, 10, 2, 0.8)';
  g.fillRect(0, 0, S, 3);
  g.fillRect(0, S - 3, S, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
