import * as THREE from 'three';
import { GeoBuilder, mat } from './GeoBuilder.ts';
import { makePaintedMaterial } from './WarriorShading.ts';
import type { WarriorUniforms } from './WarriorShading.ts';

/**
 * Procedural katana and saya (scabbard).
 *
 * Katana space: the grip centre is the origin, the blade runs along +z to the tip, the cutting edge
 * faces +y and the flats face ±x. In a hand the blade leaves the thumb side of the fist (the hand
 * bone's +z) with the edge toward the knuckles (+y).
 *
 * Every vertex carries `aInfo` = (edge 0 spine → 1 edge, along 0 → 1 to the tip, part): part 1 is
 * steel, 2 the cord-wrapped grip, 0 the fittings. The blade shader reads it for the temper line,
 * the edge glint and each tier's own treatment.
 */

export type BladeStyle = 'chipped' | 'polished' | 'spirit' | 'ember' | 'obsidian';

/** Blade length from the collar to the tip (m); long enough to read at gameplay distance. */
export const BLADE_LENGTH = 0.86;
/** Where the blade leaves the guard, along +z. */
export const BLADE_BASE = 0.118;
const GRIP_BACK = -0.15;
const GUARD_FRONT = 0.106;
/** Curvature (sori): the tip sits this far toward the spine. */
const SORI = 0.032;

interface Furniture {
  steel: THREE.ColorRepresentation;
  steelMetal: number;
  steelRough: number;
  cord: THREE.ColorRepresentation;
  guard: THREE.ColorRepresentation;
  guardMetal: number;
  collar: THREE.ColorRepresentation;
  saya: THREE.ColorRepresentation;
  sayaRough: number;
  sayaTrim: THREE.ColorRepresentation;
}

const LOOK: Record<BladeStyle, Furniture> = {
  // A traveller's blade: dull, scratched, with a worn cord grip and a plain wooden saya.
  chipped: { steel: 0x8a9096, steelMetal: 1, steelRough: 0.34, cord: 0x3d3126, guard: 0x3b3430, guardMetal: 0.6, collar: 0x8c5b3a, saya: 0x4a3524, sayaRough: 0.62, sayaTrim: 0x2a221c },
  // A ronin's pride: mirror steel, indigo silk cord over white ray skin, black lacquer saya.
  polished: { steel: 0xc9d0d8, steelMetal: 1, steelRough: 0.16, cord: 0x1b2550, guard: 0x22252b, guardMetal: 0.9, collar: 0xb9bcc2, saya: 0x0d0f14, sayaRough: 0.22, sayaTrim: 0x9aa0a8 },
  // Spirit steel: faintly violet, black cord with gold fittings.
  spirit: { steel: 0xb8b2d8, steelMetal: 1, steelRough: 0.14, cord: 0x121018, guard: 0xb08a3a, guardMetal: 1, collar: 0xc9a24a, saya: 0x0a090d, sayaRough: 0.18, sayaTrim: 0xc9a24a },
  // Dark carbon steel etched with ember script; charred grip.
  ember: { steel: 0x3c3836, steelMetal: 1, steelRough: 0.3, cord: 0x1a1716, guard: 0x2a2320, guardMetal: 0.8, collar: 0x6a4a2a, saya: 0x1c1816, sayaRough: 0.5, sayaTrim: 0x5a3a22 },
  // Black-varnished supreme steel: a glossy black body with a mirror edge, crimson cord.
  obsidian: { steel: 0x060608, steelMetal: 0.35, steelRough: 0.07, cord: 0x5c0a12, guard: 0x0c0c0e, guardMetal: 1, collar: 0x8a1420, saya: 0x08080a, sayaRough: 0.12, sayaTrim: 0x7a0d14 },
};

/** A tiny seeded random, so a blade's chips land in the same places every run. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blade centreline height (toward the edge is +y) at distance s from the collar. */
const centre = (s: number, length: number) => -SORI * (s / length) ** 2;

/**
 * A point on the blade in katana space: `along` 0 at the collar → 1 at the point, `edge` 0 on the
 * spine → 1 on the cutting edge (approximate width, ignoring the point's curve).
 */
export function bladePoint(along: number, edge: number, out: THREE.Vector3): THREE.Vector3 {
  const s = along * BLADE_LENGTH;
  const w = THREE.MathUtils.lerp(0.033, 0.024, along);
  return out.set(0, centre(s, BLADE_LENGTH) + (edge - 0.5) * w, BLADE_BASE + s);
}

/** Adds the faceted blade: edge bevel, ridge (shinogi), flats and spine, closing to the point. */
function addBlade(b: GeoBuilder, look: Furniture, length: number, stations: number, chips: number[]): void {
  b.paint(look.steel, look.steelMetal, look.steelRough);
  // Section points around the blade, as (x, yFraction) where y runs from spine (0) to edge (1).
  const faces: [number, number][][] = [
    [[0, 1], [0.5, 0.32]],
    [[0.5, 0.32], [0.3, 0]],
    [[0.3, 0], [-0.3, 0]],
    [[-0.3, 0], [-0.5, 0.32]],
    [[-0.5, 0.32], [0, 1]],
  ];
  const rings: number[][] = [];
  for (let i = 0; i <= stations; i++) {
    const s = (i / stations) * length;
    const f = s / length;
    const w = THREE.MathUtils.lerp(0.033, 0.024, f);
    const t = THREE.MathUtils.lerp(0.0078, 0.0052, f);
    const yc = centre(s, length);
    const spine = yc - w / 2;
    let edge = yc + w / 2;
    let thick = t;
    // The point (kissaki): the edge sweeps up to meet the straight spine.
    const k = (f - 0.88) / 0.12;
    if (k > 0) {
      edge = spine + w * Math.sqrt(Math.max(0, 1 - k * k));
      thick = t * Math.sqrt(Math.max(0, 1 - k * k * 0.92));
    }
    // Chips bite into the edge.
    for (const c of chips) edge -= 0.005 * Math.max(0, 1 - Math.abs(f - c) * 70);
    const width = Math.max(1e-4, edge - spine);
    const ring: number[] = [];
    for (const face of faces) {
      const [p, q] = face;
      const px = p[0] * thick;
      const py = spine + p[1] * width;
      const qx = q[0] * thick;
      const qy = spine + q[1] * width;
      // Outward normal of this facet in the section plane.
      let nx = qy - py;
      let ny = -(qx - px);
      const mx = (px + qx) / 2;
      const my = (py + qy) / 2 - (spine + width * 0.45);
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      const nl = Math.hypot(nx, ny) || 1;
      const z = BLADE_BASE + s;
      const a = b.vertex(px, py, z, nx / nl, ny / nl, 0, f, p[1]);
      b.setInfo(a, p[1], f, 1);
      const c = b.vertex(qx, qy, z, nx / nl, ny / nl, 0, f, q[1]);
      b.setInfo(c, q[1], f, 1);
      ring.push(a, c);
    }
    rings.push(ring);
  }
  for (let i = 0; i < stations; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    for (let j = 0; j < faces.length; j++) {
      const a0 = r0[j * 2];
      const b0 = r0[j * 2 + 1];
      const a1 = r1[j * 2];
      const b1 = r1[j * 2 + 1];
      // Counter-clockwise seen from outside the facet.
      b.quad(a0, a1, b1, b0);
    }
  }
}

/** Grip, guard, collar and pommel cap. */
function addFittings(b: GeoBuilder, look: Furniture, segments: number): void {
  // Cord-wrapped grip: an oval tube (part 2, so the shader draws the diamond wrap).
  b.paint(look.cord, 0, 0.85, [0, 0, 2]);
  const grip = new THREE.CylinderGeometry(1, 1, GUARD_FRONT - GRIP_BACK, segments, 1, true);
  b.add(grip, mat(0, 0, (GUARD_FRONT + GRIP_BACK) / 2, Math.PI / 2, 0, 0, 0.0135, 1, 0.017));
  // Pommel cap and the collar at the guard (fuchi), in the fitting metal.
  b.paint(look.guard, look.guardMetal, 0.4, [0, 0, 0]);
  b.add(new THREE.CylinderGeometry(1, 1, 0.016, segments), mat(0, 0, GRIP_BACK - 0.006, Math.PI / 2, 0, 0, 0.0145, 1, 0.0185));
  b.add(new THREE.CylinderGeometry(1, 1, 0.012, segments), mat(0, 0, GUARD_FRONT - 0.008, Math.PI / 2, 0, 0, 0.0145, 1, 0.0185));
  // Guard (tsuba): an oval plate with a rim.
  b.add(new THREE.CylinderGeometry(1, 1, 0.008, segments * 2), mat(0, 0, GUARD_FRONT + 0.004, Math.PI / 2, 0, 0, 0.038, 1, 0.044));
  b.add(new THREE.TorusGeometry(1, 0.08, 4, segments * 2), mat(0, 0, GUARD_FRONT + 0.004, 0, 0, 0, 0.038, 0.044, 0.05));
  // Blade collar (habaki).
  b.paint(look.collar, 1, 0.3, [0, 0, 0]);
  b.add(new THREE.BoxGeometry(0.011, 0.038, 0.03), mat(0, -0.001, BLADE_BASE + 0.012));
}

export interface KatanaOptions {
  style: BladeStyle;
  /** Fewer facets and stations on low quality. */
  low: boolean;
  seed?: number;
  length?: number;
}

/** A complete drawn katana, in katana space. */
export function katanaGeometry(o: KatanaOptions): THREE.BufferGeometry {
  const look = LOOK[o.style];
  const b = new GeoBuilder();
  const r = rand(o.seed ?? 7);
  const chips = o.style === 'chipped' ? [0.18 + r() * 0.1, 0.4 + r() * 0.15, 0.62 + r() * 0.1, 0.8 + r() * 0.05] : [];
  addBlade(b, look, o.length ?? BLADE_LENGTH, o.low ? 18 : o.style === 'chipped' ? 60 : 36, chips);
  addFittings(b, look, o.low ? 8 : 12);
  return b.build();
}

/** The grip, guard and collar alone, as they stand at the mouth of a saya holding the blade. */
export function hiltGeometry(style: BladeStyle, low: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  addFittings(b, LOOK[style], low ? 8 : 12);
  return b.build();
}

/**
 * A saya following the blade's curve, edge up as it is worn through the sash. With `hilt` the
 * sheathed sword's grip and guard stand at its mouth.
 */
export function addSaya(b: GeoBuilder, style: BladeStyle, matrix: THREE.Matrix4, hilt: boolean, low: boolean): void {
  const look = LOOK[style];
  const length = BLADE_LENGTH + 0.05;
  const stations = low ? 8 : 16;
  const around = low ? 6 : 10;
  const tmp = new GeoBuilder();
  tmp.paint(look.saya, 0, look.sayaRough);
  const rings: number[][] = [];
  for (let i = 0; i <= stations; i++) {
    const s = (i / stations) * length;
    const yc = centre(s, BLADE_LENGTH);
    const taper = 1 - 0.18 * (s / length);
    const ring: number[] = [];
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      ring.push(tmp.vertex(nx * 0.0135 * taper, yc + ny * 0.0215 * taper, BLADE_BASE + s, nx, ny, 0, j / around, s / length));
    }
    rings.push(ring);
  }
  for (let i = 0; i < stations; i++) for (let j = 0; j < around; j++) tmp.quad(rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]);
  // Mouth ring (koiguchi) and end cap (kojiri) in the trim colour.
  tmp.paint(look.sayaTrim, 0.6, 0.35);
  tmp.add(new THREE.CylinderGeometry(1, 1, 0.022, around), mat(0, 0, BLADE_BASE + 0.011, Math.PI / 2, 0, 0, 0.0155, 1, 0.0235));
  tmp.add(new THREE.SphereGeometry(1, around, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, centre(length, BLADE_LENGTH), BLADE_BASE + length, Math.PI / 2, 0, 0, 0.0115, 0.03, 0.018));
  if (hilt) addFittings(tmp, look, around);
  const geo = tmp.build();
  geo.applyMatrix4(matrix);
  b.add(geo);
}

/**
 * Steel shading for every style: a wavy temper line (hamon) near the edge, a cold glint along the
 * edge so the blade reads at night, the cord wrap's diamonds, and each tier's treatment:
 * spirit veins, ember-etched script that heats up, or a crimson edge on black varnish.
 */
const BLADE_GLSL = /* glsl */ `
{
  float edge = vInfo.x;
  float along = vInfo.y;
  if (vInfo.z > 1.5) {
    // Cord wrap: diamonds of pale ray skin between crossing bands of cord.
    float u = vUv.x * 6.0;
    float v = vUv.y * 14.0;
    float d = abs(fract(u + v) - 0.5) + abs(fract(u - v) - 0.5);
    float skin = smoothstep(0.62, 0.7, d);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.55), skin * 0.8);
  } else if (vInfo.z > 0.5) {
    float wave = 0.05 * sin(along * 62.0) + 0.025 * sin(along * 151.0 + 1.3);
    float hamon = smoothstep(0.6, 0.66, edge + wave);
#if defined(BLADE_OBSIDIAN)
    // Black varnish on the body; the hardened edge is left bare and mirror-bright.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.56, 0.6), hamon);
    metalnessFactor = mix(metalnessFactor, 1.0, hamon);
    roughnessFactor = mix(roughnessFactor, 0.1, hamon);
    float pulse = 0.55 + 0.45 * sin(uTime * 7.0 + along * 9.0);
    totalEmissiveRadiance += vec3(1.0, 0.07, 0.15) * smoothstep(0.88, 1.0, edge) * (0.5 + uBladeHeat * 2.5) * pulse;
#else
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.06, hamon);
    roughnessFactor = mix(roughnessFactor, roughnessFactor + 0.1, hamon);
#endif
    // The edge catches what little light there is.
    totalEmissiveRadiance += uEdgeGlint * smoothstep(0.86, 1.0, edge) * (0.6 + 0.4 * along);
#if defined(BLADE_SPIRIT)
    // Spirit veins drifting up the flat toward the point.
    float vein = sin(along * 40.0 - uTime * 3.0 + edge * 9.0) * sin(along * 17.0 + uTime * 1.7 - edge * 5.0);
    float glow = smoothstep(0.55, 0.95, vein) * (1.0 - hamon * 0.5);
    totalEmissiveRadiance += vec3(0.62, 0.42, 1.0) * (glow * 1.6 + hamon * 0.35) * (0.6 + uBladeHeat * 1.4);
#endif
#if defined(BLADE_EMBER)
    // Etched script down the flat: short glyph strokes that smoulder, flaring when drawn.
    float row = floor(along * 34.0);
    float h = fract(sin(row * 91.7) * 4375.85);
    float glyph = step(0.3, h) * step(abs(fract(along * 34.0) - 0.5), 0.32) * step(abs(edge - 0.32 - h * 0.12), 0.05 + 0.04 * h);
    float crack = (1.0 - smoothstep(0.0, 0.08, abs(edge - 0.3 - 0.06 * sin(along * 23.0))));
    float flick = 0.75 + 0.25 * sin(uTime * 13.0 + along * 30.0) * sin(uTime * 7.3);
    vec3 ember = vec3(1.0, 0.36, 0.08);
    totalEmissiveRadiance += ember * (glyph * 2.2 + crack * 0.9) * (0.35 + uBladeHeat * 2.4) * flick;
    totalEmissiveRadiance += vec3(1.0, 0.55, 0.2) * smoothstep(0.9, 1.0, edge) * uBladeHeat * 1.5;
#endif
  }
}
`;

/** Per-blade state the effects drive: how hot / charged the steel is right now (0–1). */
export interface BladeUniforms {
  uBladeHeat: { value: number };
  uEdgeGlint: { value: THREE.Color };
}

export function makeBladeMaterial(u: WarriorUniforms, style: BladeStyle, blade: BladeUniforms): THREE.MeshStandardMaterial {
  const m = makePaintedMaterial(u, {
    key: `blade-${style}`,
    wet: 0,
    pars: 'uniform float uBladeHeat;\nuniform vec3 uEdgeGlint;\n',
    main: BLADE_GLSL,
    uniforms: { uBladeHeat: blade.uBladeHeat, uEdgeGlint: blade.uEdgeGlint },
    envMapIntensity: 1.6,
  });
  // vUv is only declared when a map is used; force the UV varying on.
  m.defines = { ...m.defines, USE_UV: '' };
  if (style === 'spirit') m.defines.BLADE_SPIRIT = '';
  if (style === 'ember') m.defines.BLADE_EMBER = '';
  if (style === 'obsidian') m.defines.BLADE_OBSIDIAN = '';
  return m;
}

export function makeBladeUniforms(style: BladeStyle): BladeUniforms {
  const glint = style === 'obsidian' ? 0x6a5a66 : style === 'ember' ? 0x5a3a2a : style === 'spirit' ? 0x6e62a8 : 0x6f8090;
  return { uBladeHeat: { value: 0 }, uEdgeGlint: { value: new THREE.Color(glint).multiplyScalar(0.55) } };
}
