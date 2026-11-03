import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import peaksFrag from '../../shaders/Peaks.frag';
import peaksVert from '../../shaders/Peaks.vert';
import type { RenderContext } from '../../render/RenderContext.ts';
import type { EnvUniforms } from './EnvUniforms.ts';
import { Noise3, smoothstep } from './noise.ts';
import { MOON_DIR, PALETTE, RENDER_ORDER } from './palette.ts';
import { SEA_LEVEL } from './StormSea.ts';

/** The ranges rise out of the storm sea; their roots run below it (and are clipped at the water). */
const ROOT_Y = SEA_LEVEL - 30;
/** Where a crest sinks to between islands: under the roots, so open water shows. */
const DROWNED_Y = ROOT_Y - 20;

interface RangeSpec {
  /** z of the crest line. */
  z: number;
  /** Half-width of the range, front to back, and half its length along x. */
  depth: number;
  halfLength: number;
  /** Column spacing (m): fine enough that the ridgeline stays jagged at this distance. */
  spacing: number;
  valley: number;
  summit: number;
  /** Floor under the massif profile (0–1): the far giants never sink to foothills. */
  lift: number;
  /** Where the coast falls (0–1 of a broad noise): higher means more open sea between islands. */
  shore: number;
  /** Open-water sounds kept clear of land: [azimuth from the bridge (rad, +x is right), half-width]. */
  channels: [number, number][];
  /** Ridge frequency along x (per m). */
  freq: number;
  seed: number;
}

/** Azimuth of the moon: a sound opens under it so its glitter path runs out to the horizon. */
const MOON_SOUND = Math.atan2(MOON_DIR.x, -MOON_DIR.z);

/**
 * Near foothills, a middle range and the far giants, each taller and further: layered silhouettes
 * from about 250 m to 1.4 km. They stand in the sea as islands, so open water shows between them.
 */
const RANGES: RangeSpec[] = [
  {
    // The near islands keep to the sides: nothing dark stands right behind the warrior.
    z: -330, depth: 170, halfLength: 420, spacing: 3, valley: -90, summit: 30, lift: 0.2, shore: 0.47,
    channels: [[MOON_SOUND, 0.09], [0, 0.13], [0.3, 0.05]], freq: 0.006, seed: 101,
  },
  {
    z: -700, depth: 260, halfLength: 820, spacing: 5, valley: -70, summit: 110, lift: 0.35, shore: 0.36,
    channels: [[MOON_SOUND, 0.07], [0.26, 0.05]], freq: 0.0031, seed: 202,
  },
  {
    z: -1150, depth: 340, halfLength: 1350, spacing: 6.5, valley: -30, summit: 320, lift: 0.6, shore: 0.35,
    channels: [[MOON_SOUND, 0.045]], freq: 0.0019, seed: 303,
  },
];
const ROWS = 22;

/**
 * Distant snow-capped ranges: heightfield strips that follow a wandering crest line, with ridged
 * noise for knife-edge ridgelines and side spurs. All three ranges share one draw call.
 */
export class DistantPeaks {
  readonly mesh: THREE.Mesh;

  constructor(ctx: RenderContext, env: EnvUniforms, noise: THREE.Texture) {
    const u = ctx.uniforms;
    const detail = ctx.quality === 'high' ? 1 : 0.5;
    const parts = RANGES.map((spec, i) => buildRange(spec, i, detail));
    const geometry = mergeGeometries(parts);
    for (const p of parts) p.dispose();

    const material = new THREE.ShaderMaterial({
      vertexShader: peaksVert,
      fragmentShader: peaksFrag,
      uniforms: {
        uNoise: { value: noise },
        uLightning: u.uLightning,
        uMist: u.uMist,
        uRain: u.uRain,
        uSnow: u.uSnow,
        uMoonDir: env.uMoonDir,
        uMoonColor: { value: PALETTE.moon },
        uFlashPos: env.uFlashPos,
        uFlashColor: { value: PALETTE.lightning },
        uHaze: { value: PALETTE.haze },
        uRock: { value: new THREE.Color(0.028, 0.032, 0.042) },
        uSnowColor: { value: new THREE.Color(0.55, 0.6, 0.7) },
        uSeaLevel: { value: SEA_LEVEL },
      },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'env-peaks';
    // After the cliffs, which hide much of them from the anchors.
    this.mesh.renderOrder = RENDER_ORDER.peaks;
    ctx.scene.add(this.mesh);
  }
}

function buildRange(spec: RangeSpec, rangeIndex: number, detail: number): THREE.BufferGeometry {
  const n = new Noise3(spec.seed);
  const columns = Math.round(((spec.halfLength * 2) / spec.spacing) * detail) + 1;
  const pos = new Float32Array(columns * ROWS * 3);
  const f = spec.freq;
  let k = 0;
  for (let i = 0; i < columns; i++) {
    const x = -spec.halfLength + (i / (columns - 1)) * spec.halfLength * 2;
    // Broad massifs with low passes between them, their crests broken into jagged summits.
    const massif = spec.lift + (1 - spec.lift) * smoothstep(0.18, 0.78, 0.5 + 0.5 * n.fbm(x * f * 0.45, 3.3, 1.7, 4));
    // Knife-edge crests at every scale (ridged multifractal), so summits break into sub-peaks and
    // no stretch of ridge repeats. The further the range, the more of its crest is ridge: the far
    // giants are read by their skyline alone.
    const ridge = n.ridged(x * f * 1.8, 0.5, 0.5, 6);
    const sharp = 0.45 + rangeIndex * 0.1;
    const crest01 = Math.min(1, massif * (1 - sharp + sharp * ridge));
    // Between islands the crest sinks below the sea, which hides it; coasts slope down gently.
    let land = smoothstep(spec.shore, spec.shore + 0.3, 0.5 + 0.5 * n.fbm(x * f * 0.22, 6.6, 4.1, 3));
    const az = Math.atan2(x, -spec.z);
    for (const [at, half] of spec.channels) land = Math.min(land, smoothstep(half, half * 2.6, Math.abs(az - at)));
    const height = spec.valley + (spec.summit - spec.valley) * Math.pow(crest01, 1.15);
    const crest = DROWNED_Y + (height - DROWNED_Y) * land;
    const zc = spec.z + spec.depth * 0.3 * n.noise(x * f * 0.5, 9.1, 0.3);
    const half = spec.depth * (0.8 + 0.35 * n.noise(x * f * 0.7, 2.2, 7.7));
    // Spurs and gullies scale with the island's own relief above the water, not its submerged root.
    const relief = Math.max(0, crest - SEA_LEVEL) * 0.3;
    for (let j = 0; j < ROWS; j++) {
      const t = (j / (ROWS - 1)) * 2 - 1;
      // Steep under the crest, broadening into shoulders lower down.
      const at = Math.abs(t);
      const fall = 1 - Math.pow(at, 0.75) * 0.55 - at * at * 0.45;
      // Spurs and gullies down the faces: none at the crest (it keeps its designed line) or the shore.
      const spur = (n.ridged(x * f * 3.2, t * 2.6, 4.4, 3) - 0.5) * relief * Math.sin(Math.PI * at);
      pos[k++] = x;
      pos[k++] = ROOT_Y + (crest - ROOT_Y) * fall + spur;
      pos[k++] = zc + t * half;
    }
  }
  // Rows run from the back (t = −1) to the front (t = +1); wound so the surface faces up and out.
  const tris: number[] = [];
  for (let i = 0; i < columns - 1; i++) {
    for (let j = 0; j < ROWS - 1; j++) {
      const a = i * ROWS + j;
      const b = a + ROWS;
      tris.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRange', new THREE.BufferAttribute(new Float32Array(columns * ROWS).fill(rangeIndex), 1));
  g.setIndex(tris);
  g.computeVertexNormals();
  return g;
}
