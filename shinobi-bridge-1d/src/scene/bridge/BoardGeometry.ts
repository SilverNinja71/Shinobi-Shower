import * as THREE from 'three';

/** A small deterministic generator (mulberry32), so every build of the bridge looks the same. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise in [0, 1] over [0, span], with `cells` lattice cells. */
function noise1(rng: () => number, span: number, cells: number): (t: number) => number {
  const v = Array.from({ length: cells + 2 }, rng);
  return (t: number) => {
    const f = THREE.MathUtils.clamp(t / span, 0, 1) * cells;
    const i = Math.min(cells, Math.floor(f));
    const u = f - i;
    return v[i] + (v[i + 1] - v[i]) * (u * u * (3 - 2 * u));
  };
}

export interface BoardOptions {
  /** Across the board (x), through it (y, from the top face at 0 down to −thickness), along it (z). */
  width: number;
  thickness: number;
  length: number;
  /** z of the first end (default −length / 2, a board centred on its origin). */
  z0?: number;
  /** Cross-sections along the length (at least 3). */
  stations: number;
  /** Radius of the rounded top edges, and of the bottom ones (default sharp). */
  bevel: number;
  bevelBottom?: number;
  bevelSegments: number;
  /** Points across the top face, for cupping and chips. */
  topSegments: number;
  rng: () => number;
  /** Deepest chip knocked out of a top edge, in metres. */
  chips: number;
  /** How uneven the sawn ends are, in metres. */
  ragged: number;
  /** The start end is a fresh break: long splinters instead of a weathered cut. */
  brokenStart?: boolean;
  /** Scale of the bow, cup and twist of the board, in metres. */
  warp: number;
  /** Metres of wood per texture repeat. */
  texScale: number;
}

interface ProfilePoint {
  x: number;
  y: number;
  /** Distance around the outline from the bottom centre, for the texture's u. */
  p: number;
  /** 1 on the top face (cupping and surface wear apply), 0 below. */
  top: number;
}

/**
 * A weathered timber board: a section with bevelled edges lofted along z with irregular width and
 * thickness, a bow, cup and twist, chips knocked out of the top edges, and ragged (or freshly broken)
 * end cuts. The grain (the texture's v) runs along the board and wraps round its sides; the end grain
 * gets its own faces so the shader can tell them apart by their normals. Kept to few, large triangles:
 * the camera never comes within 18 m, where a pixel is nearly 2 cm.
 */
export function buildBoard(o: BoardOptions): THREE.BufferGeometry {
  const { rng } = o;
  const hw = o.width / 2;
  const T = o.thickness;
  const z0 = o.z0 ?? -o.length / 2;
  const z1 = z0 + o.length;
  const zMid = (z0 + z1) / 2;
  const rTop = o.bevel;
  const rBot = o.bevelBottom ?? 0;

  // Outline, counter-clockwise seen from +z, from the bottom centre back to it (the seam hides below).
  // A corner is rounded over `bevelSegments` steps, or left sharp when its radius is 0.
  const raw: { x: number; y: number }[] = [{ x: 0, y: -T }];
  const corner = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    if (r <= 0) {
      raw.push({ x: cx, y: cy });
      return;
    }
    for (let i = 0; i <= o.bevelSegments; i++) {
      const a = a0 + ((a1 - a0) * i) / o.bevelSegments;
      raw.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  const H = Math.PI / 2;
  corner(hw - rBot, -T + rBot, rBot, -H, 0);
  corner(hw - rTop, -rTop, rTop, 0, H);
  for (let i = 1; i < o.topSegments; i++) raw.push({ x: hw - rTop - ((2 * (hw - rTop)) * i) / o.topSegments, y: 0 });
  corner(-hw + rTop, -rTop, rTop, H, 2 * H);
  corner(-hw + rBot, -T + rBot, rBot, 2 * H, 3 * H);
  raw.push({ x: 0, y: -T });
  const profile: ProfilePoint[] = [];
  let p = 0;
  raw.forEach((q, i) => {
    if (i > 0) p += Math.hypot(q.x - raw[i - 1].x, q.y - raw[i - 1].y);
    profile.push({ x: q.x, y: q.y, p, top: q.y > -T * 0.3 ? 1 : 0 });
  });
  const P = profile.length;
  const pTop = profile.reduce((best, q) => (q.top && Math.abs(q.x) < Math.abs(best.x) ? q : best), profile[0]).p;

  // Stations, spread evenly: a few carry the bow, twist and chips.
  const S = Math.max(3, o.stations);
  const zs = Array.from({ length: S }, (_, k) => z0 + (o.length * k) / (S - 1));

  // The board's own character.
  const widthNoise = noise1(rng, o.length, 6);
  const thickNoise = noise1(rng, o.length, 5);
  const wearNoise = noise1(rng, o.length, 9);
  const bow = (rng() - 0.5) * 2 * o.warp;
  const twist = (rng() - 0.5) * 1.2 * o.warp;
  const cup = (rng() - 0.5) * 0.5 * o.warp;
  // Chips knocked out of a top edge sit on stations, mostly at the battered ends.
  const chips: { side: number; k: number; depth: number }[] = [];
  const chipCount = o.chips > 0 ? 1 + Math.floor(rng() * 3) : 0;
  for (let i = 0; i < chipCount; i++) {
    const k = rng() < 0.7 ? (rng() < 0.5 ? 0 : S - 1) : 1 + Math.floor(rng() * (S - 2));
    chips.push({ side: rng() < 0.5 ? -1 : 1, k, depth: o.chips * (0.4 + 0.6 * rng()) });
  }
  // Per outline point offsets of the end cuts (outward only, so no face can fold back).
  const endStart = profile.map(() => rng() * o.ragged);
  const endEnd = profile.map(() => rng() * o.ragged);
  if (o.brokenStart) {
    let splinter = 0;
    profile.forEach((q, i) => {
      // Fibres tear out in runs: a few long slivers along the top, shorter ones below.
      if (rng() < 0.3) splinter = (0.02 + rng() * 0.07) * (q.top ? 1 : 0.5);
      else splinter *= 0.45;
      endStart[i] = 0.004 + rng() * 0.02 + splinter;
    });
    endStart[P - 1] = endStart[0];
  } else {
    endStart[P - 1] = endStart[0];
  }
  endEnd[P - 1] = endEnd[0];

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ring: THREE.Vector3[][] = [];

  zs.forEach((z, k) => {
    const along = (z - zMid) / (o.length / 2);
    const sx = 1 + (widthNoise(z - z0) - 0.5) * 0.05;
    const bottomLift = (thickNoise(z - z0) - 0.5) * T * 0.16;
    // Worn ends: the end faces are a little smaller than the board.
    const end = k === 0 || k === S - 1;
    const shrink = end ? 0.985 : 1;
    const row: THREE.Vector3[] = [];
    profile.forEach((q, i) => {
      let x = q.x * sx * shrink;
      let y = q.y;
      if (end) y = -T / 2 + (y + T / 2) * 0.96;
      if (!q.top) y += bottomLift * (y < -T / 2 ? 1 : 0.5);
      y += bow * along * along + twist * (q.x / hw) * along;
      if (q.top) y += cup * (q.x / hw) * (q.x / hw) + (wearNoise(z - z0 + q.x * 3) - 0.5) * 0.0016;
      for (const c of chips) {
        if (c.k !== k) continue;
        const w = Math.max(0, 1 - Math.hypot(q.x - c.side * hw, q.y) / (c.depth * 3 + 0.008));
        x -= c.side * c.depth * w;
        y -= c.depth * 0.75 * w;
      }
      let zz = z;
      if (k === 0) zz -= endStart[i];
      if (k === S - 1) zz += endEnd[i];
      row.push(new THREE.Vector3(x, y, zz));
      positions.push(x, y, zz);
      uvs.push((q.p - pTop) / o.texScale, z / o.texScale);
    });
    ring.push(row);
  });
  for (let k = 0; k < S - 1; k++) {
    for (let i = 0; i < P - 1; i++) {
      const a = k * P + i;
      const b = a + 1;
      const c = a + P;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  // End caps: fans with their own vertices, so the end grain keeps a hard edge.
  const cap = (row: THREE.Vector3[], facing: number) => {
    const base = positions.length / 3;
    const centre = new THREE.Vector3();
    row.forEach((v) => centre.add(v));
    centre.divideScalar(row.length);
    positions.push(centre.x, centre.y, centre.z);
    uvs.push(centre.x / o.texScale + 0.37, centre.y / o.texScale + 0.61);
    row.forEach((v) => {
      positions.push(v.x, v.y, v.z);
      uvs.push(v.x / o.texScale + 0.37, v.y / o.texScale + 0.61);
    });
    for (let i = 0; i < P - 1; i++) {
      if (facing > 0) indices.push(base, base + 1 + i, base + 2 + i);
      else indices.push(base, base + 2 + i, base + 1 + i);
    }
  };
  cap(ring[0], -1);
  cap(ring[S - 1], 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
