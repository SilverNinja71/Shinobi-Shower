import * as THREE from 'three';

/**
 * Small canvas-painted textures for gear the PBR library does not cover: woven straw with a frayed
 * rim (the kasa), and matted fur with ragged tufts (the warlord's cloak). Painted once, at start.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(c: HTMLCanvasElement, srgb: boolean, maxAnisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = maxAnisotropy;
  // Canvas rows map straight to v (row 0 is v = 0).
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Woven straw for a conical hat: u runs around the cone, v from the crown (0) to the brim (1).
 * Radial straws, rings of stitching, and a ragged edge of loose straws in the alpha channel.
 */
export function strawTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const r = rand(11);
  g.fillStyle = 'rgb(150,124,74)';
  g.fillRect(0, 0, W, H * 0.9);
  // Radial straws: thin strips of varying ripeness.
  for (let x = 0; x < W; x += 2) {
    const k = 0.7 + r() * 0.5;
    g.fillStyle = `rgb(${Math.round(168 * k)},${Math.round(138 * k)},${Math.round(80 * k)})`;
    g.fillRect(x, 0, 1.6, H * 0.9);
  }
  // Rings of stitching every few centimetres, slightly wobbly.
  for (let y = 10; y < H * 0.9; y += 18 + r() * 6) {
    g.strokeStyle = 'rgba(52,38,20,0.75)';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 1.2);
    g.stroke();
    g.strokeStyle = 'rgba(210,180,120,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 16) g.lineTo(x, y - 2 + Math.sin(x * 0.05 + y) * 1.2);
    g.stroke();
  }
  // Weathering: grime and darker water stains toward the brim.
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(40,30,18,${0.05 + r() * 0.12})`;
    const y = H * (0.3 + r() * 0.6);
    g.fillRect(r() * W, y, 4 + r() * 20, 2 + r() * 8);
  }
  // Frayed rim: straws of random length poking past the stitched edge, transparent between them.
  g.clearRect(0, H * 0.9, W, H * 0.1);
  for (let x = 0; x < W; x += 2.5) {
    const len = H * (0.02 + r() * r() * 0.1);
    const k = 0.6 + r() * 0.5;
    g.fillStyle = `rgb(${Math.round(160 * k)},${Math.round(130 * k)},${Math.round(76 * k)})`;
    g.fillRect(x + r(), H * 0.9 - 1, 1.4, len);
  }
  return finish(c, true, maxAnisotropy);
}

/**
 * Matted fur: u around the mantle, v from the collar (1) to the hem (0). Strands combed downward,
 * pale tips, bald scars where blades cut it, and ragged tufts at the hem in the alpha channel.
 */
export function furTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const r = rand(23);
  g.fillStyle = 'rgb(46,40,36)';
  g.fillRect(0, H * 0.12, W, H * 0.88);
  // Strands in layers: dark underfur, then longer guard hairs with pale tips.
  for (let i = 0; i < 9000; i++) {
    const x = r() * W;
    const y = H * 0.12 + r() * H * 0.88;
    const len = 6 + r() * 16;
    const k = 0.5 + r() * 0.9;
    g.strokeStyle = `rgba(${Math.round(70 * k)},${Math.round(62 * k)},${Math.round(56 * k)},0.55)`;
    g.lineWidth = 1 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 4, y - len);
    g.stroke();
    if (r() < 0.25) {
      g.strokeStyle = 'rgba(150,140,128,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y - len);
      g.lineTo(x + (r() - 0.5) * 3, y - len - 3);
      g.stroke();
    }
  }
  // Old cuts: pale, matted scars across the pelt.
  for (let i = 0; i < 6; i++) {
    const x = r() * W;
    const y = H * (0.3 + r() * 0.5);
    g.strokeStyle = 'rgba(120,104,92,0.5)';
    g.lineWidth = 3 + r() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 30 + r() * 50, y + (r() - 0.5) * 30);
    g.stroke();
  }
  // Ragged tufts at the hem (top rows of the canvas are the hem since v = 0 is the bottom).
  g.clearRect(0, 0, W, H * 0.12);
  for (let x = 0; x < W; x += 3) {
    const len = H * (0.03 + r() * 0.1);
    const k = 0.5 + r() * 0.7;
    g.fillStyle = `rgb(${Math.round(64 * k)},${Math.round(56 * k)},${Math.round(50 * k)})`;
    g.beginPath();
    g.moveTo(x - 2, H * 0.12 + 2);
    g.lineTo(x + 1 + (r() - 0.5) * 3, H * 0.12 - len);
    g.lineTo(x + 4, H * 0.12 + 2);
    g.fill();
  }
  return finish(c, true, maxAnisotropy);
}
