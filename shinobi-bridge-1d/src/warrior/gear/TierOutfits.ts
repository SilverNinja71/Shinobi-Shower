import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Assets } from '../../render/Assets.ts';
import type { GearBinder, Segment } from './GearBinder.ts';
import { GeoBuilder, mat } from './GeoBuilder.ts';
import { furTexture, strawTexture } from './GearTextures.ts';
import { aim, drape, painted } from './Garments.ts';
import type { Ring } from './Garments.ts';
import { BLADE_BASE, addSaya, hiltGeometry } from './Katana.ts';
import type { BladeStyle } from './Katana.ts';
import { makePaintedMaterial, shadeWarrior } from './WarriorShading.ts';
import type { Dye, WarriorUniforms } from './WarriorShading.ts';

/**
 * The five cosmetic tiers, each a set of gear skinned to the warrior's skeleton in the rest pose:
 *   1 Wandering Exile: burlap poncho, frayed straw kasa, one plain wooden saya.
 *   2 Dual Ronin: indigo silk haori, leather bracers, cloth mask, two saya at the left hip.
 *   3 Armored Kenshi: black-and-gold lacquered sode, cuirass and tassets, a spirit headband.
 *   4 Ashen Warlord: a scarred fur mantle and blackened pauldrons with ember seams.
 *   5 Apex Sovereign: black lacquer laced in crimson (the cape is cloth, simulated elsewhere).
 * Gear is modelled in the torso's frame: x toward the warrior's left, y up from the deck, z forward.
 */

export interface TierLook {
  tier: number;
  group: THREE.Group;
  /** Grip and guard standing in each hip saya, shown while that blade is sheathed: [off-hand, third]. */
  hilts: (THREE.Object3D | null)[];
  dye: Dye;
  /** Hand colour: wraps, gloves or gauntlets. */
  hands: THREE.ColorRepresentation;
  hair: boolean;
  blade: BladeStyle;
}

export interface Tailor {
  binder: GearBinder;
  /** Torso frame → model space, at rest. */
  torso: THREE.Matrix4;
  low: boolean;
  u: WarriorUniforms;
  assets: Assets;
  /** Shared vertex-painted gear material (lacquer, gold, cord, iron...). */
  gear: THREE.MeshStandardMaterial;
}

/** Glow palette for painted gear: vInfo.x is the strength, vInfo.y the colour, vInfo.z a flicker phase. */
export const GEAR_GLSL = /* glsl */ `
if (vInfo.x > 0.0) {
  vec3 glowColor = vInfo.y < 0.5 ? vec3(1.0, 0.34, 0.07) : vInfo.y < 1.5 ? vec3(0.62, 0.42, 1.0) : vInfo.y < 2.5 ? vec3(1.0, 0.07, 0.15) : vec3(1.0, 0.78, 0.42);
  float flick = 0.7 + 0.3 * sin(uTime * 8.0 + vInfo.z * 17.0) * sin(uTime * 3.1 + vInfo.z * 5.0);
  totalEmissiveRadiance += glowColor * vInfo.x * flick * uGearGlow;
}
`;

export function makeGearMaterial(u: WarriorUniforms, glow: { value: number }): THREE.MeshStandardMaterial {
  return makePaintedMaterial(u, { key: 'gear', wet: 0.6, snow: true, pars: 'uniform float uGearGlow;\n', main: GEAR_GLSL, uniforms: { uGearGlow: glow }, side: THREE.DoubleSide });
}

/* ------------------------------------------------------------------ shared pieces */

const UP = new THREE.Vector3(0, 1, 0);

/** Torso-frame drape moved onto the rest pose. */
function onTorso(t: Tailor, g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.applyMatrix4(t.torso);
}

/** A saya worn through the sash at the left hip, edge up, mouth forward, tip trailing down behind. */
function hipSaya(t: Tailor, style: BladeStyle, slot: number): { saya: THREE.BufferGeometry; hilt: THREE.BufferGeometry } {
  const mouth = slot === 0 ? new THREE.Vector3(0.17, 1.0, 0.13) : new THREE.Vector3(0.19, 0.955, 0.1);
  const dir = slot === 0 ? new THREE.Vector3(0.1, -0.36, -1) : new THREE.Vector3(0.14, -0.46, -1);
  dir.normalize();
  const grip = mouth.clone().addScaledVector(dir, -BLADE_BASE);
  const m = new THREE.Matrix4().multiplyMatrices(t.torso, aim(grip, dir, UP));
  const b = new GeoBuilder();
  addSaya(b, style, m, false, t.low);
  const hilt = hiltGeometry(style, t.low).applyMatrix4(m);
  return { saya: t.binder.fix(b.build(), 'pelvis'), hilt: t.binder.fix(hilt, 'pelvis') };
}

function skinnedMesh(t: Tailor, pieces: THREE.BufferGeometry[], material: THREE.Material): THREE.SkinnedMesh {
  const m = t.binder.mesh(pieces, material);
  m.castShadow = !t.low;
  return m;
}

/** Hip saya for a tier (one or two), merged into the gear pieces, plus a hilt mesh per saya. */
function sayaSet(t: Tailor, style: BladeStyle, count: number, pieces: THREE.BufferGeometry[]): (THREE.Object3D | null)[] {
  const hilts: (THREE.Object3D | null)[] = [null, null];
  for (let i = 0; i < count; i++) {
    const s = hipSaya(t, style, i);
    pieces.push(s.saya);
    const hilt = skinnedMesh(t, [s.hilt], t.gear);
    hilt.visible = false;
    hilts[i] = hilt;
  }
  return hilts;
}

/** A sash (obi) wrapped at the waist with a flat knot at the back. */
function sash(t: Tailor, color: THREE.ColorRepresentation, y = 1.0, height = 0.09): THREE.BufferGeometry {
  const rings: Ring[] = [
    { y: y + height / 2, rx: 0.188, rz: 0.158, z: 0.005 },
    { y: y - height / 2, rx: 0.195, rz: 0.165, z: 0.005 },
  ];
  const band = painted(onTorso(t, drape(rings, { around: t.low ? 16 : 28, subdiv: 1 })), color, 0, 0.8);
  const knot = painted(new THREE.BoxGeometry(0.12, 0.07, 0.04).applyMatrix4(mat(0, y, -0.175)).applyMatrix4(t.torso), color, 0, 0.75);
  return t.binder.soft(mergeSimple([band, knot]), [{ bone: 'pelvis', to: 'spine_01' }, { bone: 'spine_01', to: 'spine_02' }], 3);
}

/** Merges painted, unskinned pieces (same attribute set) into one geometry. */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Could not merge gear pieces');
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * Lacquered armour lames: `rows` overlapping curved strips, each with a gold (or coloured) edge
 * and vertical lacing. The plate curves around the vertical axis through `centre`.
 */
function lames(
  b: GeoBuilder,
  o: {
    centre: THREE.Vector3;
    radius: number;
    facing: number;
    span: number;
    top: number;
    rows: number;
    rowHeight: number;
    /** Each row steps this far further out than the one above. */
    flare: number;
    lacquer: number;
    edge: number;
    lace: number;
    /** How far each lame's bottom stands out from its top: the plates hang at an angle, like scales. */
    tilt?: number;
    /** Glow palette of the edge binding (see GEAR_GLSL): 3 gold, 2 crimson. */
    edgeGlow?: number;
  },
  low: boolean,
): void {
  const seg = low ? 5 : 9;
  for (let r = 0; r < o.rows; r++) {
    const yTop = o.top - r * o.rowHeight * 0.82;
    const yBot = yTop - o.rowHeight;
    const rad = o.radius + r * o.flare;
    const lean = o.tilt ?? 0;
    const strip = (y0: number, y1: number, f0: number, f1: number, inset: number, color: number, metal: number, rough: number, glow: [number, number, number]) => {
      b.paint(color, metal, rough, glow);
      const ring0: number[] = [];
      const ring1: number[] = [];
      // The lame's outward normal tips up a little as it leans out.
      const ny = lean / Math.max(0.01, o.rowHeight);
      for (let i = 0; i <= seg; i++) {
        const a = o.facing + (i / seg - 0.5) * o.span;
        const nx = Math.sin(a);
        const nz = Math.cos(a);
        const r0 = rad + inset + lean * f0;
        const r1 = rad + inset + lean * f1;
        ring0.push(b.vertex(o.centre.x + nx * r0, y0, o.centre.z + nz * r0, nx, ny, nz, i / seg, 1));
        ring1.push(b.vertex(o.centre.x + nx * r1, y1, o.centre.z + nz * r1, nx, ny, nz, i / seg, 0));
      }
      // Counter-clockwise seen from outside the plate.
      for (let i = 0; i < seg; i++) b.quad(ring0[i], ring1[i], ring1[i + 1], ring0[i + 1]);
    };
    strip(yTop, yBot, 0, 1, 0, o.lacquer, 0.1, 0.18, [0, 0, 0]);
    // Edge binding along the bottom of each lame: polished metal that catches a glint.
    const f = 0.02 / o.rowHeight;
    strip(yBot + 0.02, yBot - 0.003, 1 - f, 1 + 0.003 / o.rowHeight, 0.004, o.edge, 1, 0.28, [0.1, o.edgeGlow ?? 3, r * 1.7]);
    // Lacing cords running down the lame.
    if (!low) {
      b.paint(o.lace, 0, 0.7, [0, 0, 0]);
      for (const k of [-0.3, 0, 0.3]) {
        const a = o.facing + k * o.span;
        const nx = Math.sin(a);
        const nz = Math.cos(a);
        const x0 = o.centre.x + nx * (rad + 0.004);
        const z0 = o.centre.z + nz * (rad + 0.004);
        const x1 = x0 + nx * lean;
        const z1 = z0 + nz * lean;
        const tx = Math.cos(a) * 0.006;
        const tz = -Math.sin(a) * 0.006;
        const v0 = b.vertex(x0 - tx, yTop, z0 - tz, nx, 0, nz);
        const v1 = b.vertex(x0 + tx, yTop, z0 + tz, nx, 0, nz);
        const v2 = b.vertex(x1 + tx, yBot, z1 + tz, nx, 0, nz);
        const v3 = b.vertex(x1 - tx, yBot, z1 - tz, nx, 0, nz);
        b.quad(v0, v3, v2, v1);
      }
    }
  }
}

/** Shoulder guards (sode) hanging outside each upper arm, fixed to that arm. */
function sode(t: Tailor, colors: { lacquer: number; edge: number; lace: number }, pieces: THREE.BufferGeometry[]): void {
  for (const side of [1, -1]) {
    const b = new GeoBuilder();
    lames(
      b,
      { centre: new THREE.Vector3(side * 0.12, 0, -0.01), radius: 0.155, facing: (side * Math.PI) / 2, span: 1.2, top: 1.48, rows: t.low ? 4 : 5, rowHeight: 0.08, flare: 0.016, lacquer: colors.lacquer, edge: colors.edge, lace: colors.lace, tilt: 0.026 },
      t.low,
    );
    const g = b.build().applyMatrix4(t.torso);
    pieces.push(t.binder.soft(g, [{ bone: side > 0 ? 'upperarm_l' : 'upperarm_r', to: side > 0 ? 'lowerarm_l' : 'lowerarm_r' }, { bone: side > 0 ? 'clavicle_l' : 'clavicle_r', to: side > 0 ? 'upperarm_l' : 'upperarm_r' }], 5));
  }
}

/** Cuirass (do) and tassets (kusazuri) in lacquer with coloured bands. */
function cuirass(t: Tailor, colors: { lacquer: number; band: number; lace: number; bandGlow: number }, pieces: THREE.BufferGeometry[]): void {
  const rows = t.low ? 6 : 10;
  const rings: Ring[] = [];
  for (let i = 0; i <= 4; i++) {
    const y = 1.43 - i * 0.11;
    rings.push({ y, rx: i === 0 ? 0.17 : 0.195, rz: i === 0 ? 0.14 : 0.168, z: 0.012 });
  }
  const doGeo = drape(rings, { around: t.low ? 14 : 26, subdiv: Math.max(1, Math.round(rows / 4)) });
  // Banded colours: every few rows a lacquered band edge in the trim colour.
  const pos = doGeo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const pbr = new Float32Array(pos.count * 2);
  const lac = new THREE.Color(colors.lacquer);
  const band = new THREE.Color(colors.band);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const isBand = Math.abs(((1.43 - y) / 0.075) % 1 - 0.5) > 0.42;
    const c = isBand ? band : lac;
    col.set([c.r, c.g, c.b], i * 3);
    pbr.set(isBand ? [1, 0.32] : [0.1, 0.16], i * 2);
  }
  doGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  doGeo.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 2));
  doGeo.setAttribute('aInfo', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  pieces.push(t.binder.soft(onTorso(t, doGeo), [{ bone: 'spine_02', to: 'spine_03' }, { bone: 'spine_03', to: 'neck_01' }, { bone: 'spine_01', to: 'spine_02' }], 3));
  // Tassets: panels around the hips that swing with the nearer thigh.
  const panels = t.low ? 4 : 6;
  for (let p = 0; p < panels; p++) {
    const facing = (p / panels) * Math.PI * 2 + Math.PI / panels;
    const b = new GeoBuilder();
    lames(b, { centre: new THREE.Vector3(0, 0, 0.0), radius: 0.215, facing, span: (Math.PI * 2) / panels - 0.08, top: 1.0, rows: 3, rowHeight: 0.085, flare: 0.012, lacquer: colors.lacquer, edge: colors.band, lace: colors.lace, tilt: 0.03, edgeGlow: colors.bandGlow }, t.low);
    const g = b.build().applyMatrix4(t.torso);
    const left = Math.sin(facing) > 0;
    pieces.push(t.binder.soft(g, [{ bone: 'pelvis', to: 'spine_01' }, { bone: left ? 'thigh_l' : 'thigh_r', to: left ? 'calf_l' : 'calf_r' }], 2.5));
  }
}

/* ------------------------------------------------------------------ tier 1 */

function wanderingExile(t: Tailor): TierLook {
  const group = new THREE.Group();
  // Burlap poncho: pointed front and back, raised at the sides where the arms hold it out.
  const set = t.assets.pbr('burlap', 3, 2);
  // Seen from the side it should hang flat front and back, not balloon: its depth stays close in.
  const poncho = drape(
    [
      { y: 1.55, rx: 0.075, rz: 0.07, z: 0.02 },
      { y: 1.505, rx: 0.17, rz: 0.125, z: 0.012 },
      { y: 1.445, rx: 0.27, rz: 0.175, z: 0.005 },
      { y: 1.3, rx: 0.315, rz: 0.2 },
      { y: 1.1, rx: 0.335, rz: 0.21 },
      { y: 0.92, rx: 0.35, rz: 0.215 },
    ],
    { around: t.low ? 20 : 40, subdiv: t.low ? 2 : 4, hem: (a) => -0.16 * Math.abs(Math.cos(a)) + 0.12 * Math.abs(Math.sin(a)), folds: 0.08, foldCount: 7, seed: 1.3 },
  );
  // The arms only half lift the cloth: it moves with the shoulders, the arms swing beneath it.
  const ponchoSegments: Segment[] = [
    { bone: 'spine_02', to: 'spine_03' },
    { bone: 'spine_03', to: 'neck_01' },
    { bone: 'clavicle_l', to: 'upperarm_l' },
    { bone: 'clavicle_r', to: 'upperarm_r' },
    { bone: 'upperarm_l', to: 'lowerarm_l', gain: 0.3 },
    { bone: 'upperarm_r', to: 'lowerarm_r', gain: 0.3 },
    { bone: 'pelvis', to: 'spine_02' },
  ];
  const burlap = shadeWarrior(
    new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, color: 0xb5a283, side: THREE.DoubleSide }),
    t.u,
    {
      key: 'poncho',
      wet: 1,
      snow: true,
      // A frayed hem: loose threads of random length below the last weave row.
      main: /* glsl */ `
        if (vUv.y < 0.075) {
          float lane = floor(vUv.x * 300.0);
          float len = fract(sin(lane * 12.9898) * 43758.5453);
          if (fract(vUv.x * 300.0) > 0.55 || vUv.y < 0.075 * (1.0 - len)) discard;
        }`,
    },
  );
  burlap.defines = { ...burlap.defines, USE_UV: '' };
  group.add(skinnedMesh(t, [t.binder.soft(onTorso(t, poncho), ponchoSegments, 3)], burlap));

  // Kasa: a shallow cone of woven straw with a frayed brim, set on the head.
  const kasa = strawCone(t.low ? 24 : 48, t.low ? 6 : 12);
  const straw = shadeWarrior(
    new THREE.MeshStandardMaterial({ map: strawTexture(t.assets.maxAnisotropy), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82 }),
    t.u,
    { key: 'kasa', wet: 0.9, snow: true },
  );
  const hat = t.binder.rigid(kasa, 'Head', mat(0, 0.005, -0.012, -0.16));
  const band = painted(new THREE.TorusGeometry(0.098, 0.009, 5, 18).rotateX(Math.PI / 2), 0x3a2c1c, 0, 0.8);
  const hatBand = t.binder.rigid(band, 'Head', mat(0, 0.2, -0.012, -0.16));
  group.add(skinnedMesh(t, [hat], straw));

  const pieces: THREE.BufferGeometry[] = [hatBand];
  // A rope belt over the poncho's waist.
  const belt = painted(onTorso(t, drape([{ y: 1.03, rx: 0.2, rz: 0.17, z: 0.005 }, { y: 1.01, rx: 0.203, rz: 0.173, z: 0.005 }], { around: 20, subdiv: 1 })), 0x5a4a32, 0, 0.9);
  pieces.push(t.binder.soft(belt, [{ bone: 'pelvis', to: 'spine_01' }], 3));
  const hilts = sayaSet(t, 'chipped', 1, pieces);
  group.add(skinnedMesh(t, pieces, t.gear));
  for (const h of hilts) if (h) group.add(h);
  return { tier: 1, group, hilts, dye: { main: 0x3b3428, trim: 0x2a2018, metal: 0x5c574f }, hands: 0x7a6e5c, hair: true, blade: 'chipped' };
}

/** A kasa in head space: crown up the head's y axis, brim at brow height, u around, v crown → brim. */
function strawCone(around: number, rings: number): THREE.BufferGeometry {
  const radius = 0.32;
  const apex = 0.36;
  const brim = 0.17;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const tMax = 1.08;
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * tMax;
    const r = radius * t;
    const y = apex - (apex - brim) * (t + 0.18 * t * (1 - t));
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(j / around * 3, t / tMax);
    }
  }
  const cols = around + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * cols + j;
      index.push(a, a + cols, a + cols + 1, a, a + cols + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ tier 2 */

function dualRonin(t: Tailor): TierLook {
  const group = new THREE.Group();
  // Indigo silk haori: open at the front, with wide sleeves over the upper arms.
  const body = drape(
    [
      { y: 1.52, rx: 0.1, rz: 0.1, z: 0.0 },
      { y: 1.47, rx: 0.2, rz: 0.15 },
      { y: 1.41, rx: 0.235, rz: 0.178 },
      { y: 1.25, rx: 0.212, rz: 0.182 },
      { y: 1.05, rx: 0.215, rz: 0.185 },
      { y: 0.86, rx: 0.255, rz: 0.205 },
      { y: 0.7, rx: 0.285, rz: 0.225 },
    ],
    { around: t.low ? 18 : 34, subdiv: t.low ? 2 : 3, from: 0.36, to: Math.PI * 2 - 0.36, folds: 0.05, foldCount: 6, hem: () => 0 },
  );
  const bodySkin: Segment[] = [
    { bone: 'spine_03', to: 'neck_01' },
    { bone: 'spine_02', to: 'spine_03' },
    { bone: 'spine_01', to: 'spine_02' },
    { bone: 'pelvis', to: 'spine_01' },
    { bone: 'thigh_l', to: 'calf_l' },
    { bone: 'thigh_r', to: 'calf_r' },
  ];
  const silkPieces: THREE.BufferGeometry[] = [t.binder.soft(trimmed(onTorso(t, body), 0x0b0d16, 0x1b2446), bodySkin, 3)];
  for (const side of ['l', 'r'] as const) silkPieces.push(sleeve(t, side));
  const silk = shadeWarrior(
    // Indigo, not royal blue: the sheen only lifts the folds a shade toward a cold violet-grey.
    new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.56, sheen: 0.8, sheenColor: new THREE.Color(0.11, 0.13, 0.28), sheenRoughness: 0.4, side: THREE.DoubleSide }),
    t.u,
    {
      key: 'haori',
      wet: 0.8,
      snow: true,
      // A pale family crest (mon) between the shoulder blades.
      main: /* glsl */ `
        vec2 crestUv = vec2((vUv.x - 0.5) * 3.4, (vUv.y - 0.84) * 2.0);
        float crestR = length(crestUv);
        float crest = smoothstep(0.075, 0.068, crestR) * smoothstep(0.045, 0.052, crestR) + smoothstep(0.03, 0.024, length(crestUv - vec2(0.0, 0.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.74, 0.7), clamp(crest, 0.0, 1.0) * step(0.3, vUv.x) * step(vUv.x, 0.7));`,
    },
  );
  silk.defines = { ...silk.defines, USE_UV: '' };
  group.add(skinnedMesh(t, silkPieces, silk));

  // Leather bracers on both forearms.
  const set = t.assets.pbr('leather', 1, 1);
  const leather = shadeWarrior(new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, color: 0x6a4e3a }), t.u, { key: 'leather', wet: 0.7 });
  const bracers: THREE.BufferGeometry[] = [];
  for (const side of ['l', 'r'] as const) {
    const g = new THREE.CylinderGeometry(0.047, 0.056, 0.17, t.low ? 8 : 14, 1, true);
    bracers.push(t.binder.rigid(g, `lowerarm_${side}`, mat(0, 0.145, 0)));
    const cuff = new THREE.TorusGeometry(0.05, 0.006, 4, t.low ? 8 : 14).rotateX(Math.PI / 2);
    bracers.push(t.binder.rigid(cuff, `lowerarm_${side}`, mat(0, 0.065, 0)));
  }
  group.add(skinnedMesh(t, bracers.map(stripPaint), leather));

  // Cloth mask over nose and mouth, an indigo-black obi, a topknot, and two saya.
  const pieces: THREE.BufferGeometry[] = [];
  pieces.push(t.binder.rigid(painted(faceMask(t.low), 0x14151a, 0, 0.85), 'Head'));
  pieces.push(t.binder.rigid(painted(topknot(), 0x0e0c0b, 0, 0.55), 'Head'));
  pieces.push(sash(t, 0x1a1d28));
  const hilts = sayaSet(t, 'polished', 2, pieces);
  group.add(skinnedMesh(t, pieces, t.gear));
  for (const h of hilts) if (h) group.add(h);
  return { tier: 2, group, hilts, dye: { main: 0x22252b, trim: 0x17130f, metal: 0x8a8f98 }, hands: 0x2a221c, hair: true, blade: 'polished' };
}

/** Colours a drape: a dark collar band along the open front and around the neck, silk elsewhere. */
function trimmed(g: THREE.BufferGeometry, trim: number, silk: number): THREE.BufferGeometry {
  painted(g, silk, 0, 0.5);
  const uv = g.getAttribute('uv');
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const c = new THREE.Color(trim);
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < 0.035 || u > 0.965 || v > 0.93) col.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

/**
 * A wide haori sleeve hanging from the shoulder past the elbow: flat side to side, deep front to
 * back, its bag drooping lower behind the arm, so the arm reads as a broad panel in profile.
 */
function sleeve(t: Tailor, side: 'l' | 'r'): THREE.BufferGeometry {
  const shoulder = t.binder.restPosition(`upperarm_${side}`);
  const elbow = t.binder.restPosition(`lowerarm_${side}`);
  const down = elbow.clone().sub(shoulder);
  const len = down.length();
  down.normalize();
  const rings: Ring[] = [
    { y: 0.035, rx: 0.068, rz: 0.085 },
    { y: -len * 0.45, rx: 0.075, rz: 0.15 },
    { y: -len - 0.13, rx: 0.08, rz: 0.2, z: -0.02 },
  ];
  // θ = π is behind the arm: the sleeve's bag hangs lower there.
  const g = drape(rings, { around: t.low ? 10 : 18, subdiv: 3, folds: 0.06, foldCount: 3, hem: (a) => -0.07 * Math.max(0, -Math.cos(a)) });
  // Frame: y up along the arm, z toward the chest's facing (kept square to the arm), x across.
  const forward = new THREE.Vector3().setFromMatrixColumn(t.torso, 2);
  const frame = aim(shoulder, forward, down.clone().negate());
  // aim() keeps z exact and bends y; here the arm axis must stay exact, so rebuild around it.
  const y = down.clone().negate();
  const z = forward.addScaledVector(y, -forward.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  frame.makeBasis(x, y, z).setPosition(shoulder);
  g.applyMatrix4(frame);
  painted(g, 0x1b2446, 0, 0.5);
  return t.binder.soft(g, [
    { bone: `upperarm_${side}`, to: `lowerarm_${side}` },
    { bone: `lowerarm_${side}`, to: `hand_${side}` },
    { bone: `clavicle_${side}`, to: `upperarm_${side}` },
  ], 4);
}

/** Removes paint attributes so a piece can join a plainly textured mesh. */
function stripPaint(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of ['color', 'aPbr', 'aInfo']) if (g.getAttribute(name)) g.deleteAttribute(name);
  return g;
}

/** A cloth mask over the lower face, in head space (y up the head, z out of the face). */
function faceMask(low: boolean): THREE.BufferGeometry {
  return drape(
    [
      { y: 0.118, rx: 0.088, rz: 0.1, z: 0.022 },
      { y: 0.07, rx: 0.098, rz: 0.118, z: 0.02 },
      { y: 0.02, rx: 0.088, rz: 0.11, z: 0.012 },
      { y: -0.025, rx: 0.06, rz: 0.075, z: 0.0 },
    ],
    { around: low ? 10 : 18, subdiv: 2, from: -1.75, to: 1.75 },
  );
}

/** A topknot (chonmage) folded forward on the crown, in head space. */
function topknot(): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.018, 0.07, 3, 8);
  return g.applyMatrix4(mat(0, 0.255, -0.035, 1.25, 0, 0));
}

/* ------------------------------------------------------------------ tier 3 */

function armoredKenshi(t: Tailor): TierLook {
  const group = new THREE.Group();
  const pieces: THREE.BufferGeometry[] = [];
  const colors = { lacquer: 0x08080b, edge: 0xc9a24a, band: 0xb08a3a, lace: 0x4a2a6a, bandGlow: 3 };
  sode(t, colors, pieces);
  cuirass(t, colors, pieces);
  // Headband (hachimaki) with a gold brow plate; the spirit ribbons stream from its knot.
  pieces.push(t.binder.rigid(painted(new THREE.TorusGeometry(0.103, 0.013, 5, t.low ? 12 : 22).rotateX(Math.PI / 2), 0x1a1424, 0, 0.8), 'Head', mat(0, 0.175, -0.008, -0.2)));
  pieces.push(t.binder.rigid(painted(new THREE.BoxGeometry(0.07, 0.03, 0.01), 0xc9a24a, 1, 0.3), 'Head', mat(0, 0.19, 0.103, -0.2)));
  pieces.push(sash(t, 0x14101c, 0.985, 0.07));
  const hilts = sayaSet(t, 'spirit', 2, pieces);
  group.add(skinnedMesh(t, pieces, t.gear));
  for (const h of hilts) if (h) group.add(h);
  return { tier: 3, group, hilts, dye: { main: 0x121117, trim: 0x2a2014, metal: 0xb08a3a }, hands: 0x121016, hair: true, blade: 'spirit' };
}

/* ------------------------------------------------------------------ tier 4 */

function ashenWarlord(t: Tailor): TierLook {
  const group = new THREE.Group();
  // Fur mantle: a thick ruff at the neck, over the shoulders, down the back; open at the front.
  const fur = shadeWarrior(
    new THREE.MeshStandardMaterial({ map: furTexture(t.assets.maxAnisotropy), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95, color: 0xb0a89e }),
    t.u,
    { key: 'fur', wet: 0.9, snow: true },
  );
  const mantle = drape(
    [
      { y: 1.6, rx: 0.115, rz: 0.11, z: -0.005 },
      { y: 1.53, rx: 0.2, rz: 0.17, z: -0.01 },
      { y: 1.46, rx: 0.3, rz: 0.225, z: -0.015 },
      { y: 1.35, rx: 0.34, rz: 0.25, z: -0.02 },
      { y: 1.18, rx: 0.33, rz: 0.26, z: -0.03 },
      { y: 0.98, rx: 0.32, rz: 0.27, z: -0.04 },
    ],
    { around: t.low ? 18 : 36, subdiv: t.low ? 2 : 3, from: 0.55, to: Math.PI * 2 - 0.55, folds: 0.11, foldCount: 8, seed: 2.2, hem: (a) => 0.24 * Math.max(0, Math.cos(a)) },
  );
  const mantleSkin: Segment[] = [
    { bone: 'spine_03', to: 'neck_01' },
    { bone: 'spine_02', to: 'spine_03' },
    { bone: 'clavicle_l', to: 'upperarm_l' },
    { bone: 'clavicle_r', to: 'upperarm_r' },
    { bone: 'upperarm_l', to: 'lowerarm_l' },
    { bone: 'upperarm_r', to: 'lowerarm_r' },
  ];
  group.add(skinnedMesh(t, [stripPaint(t.binder.soft(onTorso(t, mantle), mantleSkin, 3.5))], fur));

  const pieces: THREE.BufferGeometry[] = [];
  // Blackened iron pauldrons with ember seams, under the fur at the shoulder points.
  for (const side of ['l', 'r'] as const) {
    const s = side === 'l' ? 1 : -1;
    const b = new GeoBuilder();
    for (let r = 0; r < 3; r++) {
      b.paint(0x1d1b1a, 0.85, 0.42, [0, 0, 0]);
      const dome = new THREE.SphereGeometry(0.12 - r * 0.012, t.low ? 8 : 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
      b.add(dome, mat(s * (0.24 + r * 0.025), 1.43 - r * 0.075, -0.01, 0, 0, -s * (0.75 + r * 0.12), 1, 0.8, 1));
      b.paint(0x2a1a10, 0.6, 0.5, [1.2, 0, r * 1.7]);
      const seam = new THREE.TorusGeometry(0.12 - r * 0.012, 0.004, 3, t.low ? 8 : 14);
      b.add(seam, mat(s * (0.24 + r * 0.025) + s * 0.045, 1.43 - r * 0.075 - 0.04, -0.01, Math.PI / 2, 0, -s * (0.75 + r * 0.12), 1, 1, 0.8));
    }
    const g = b.build().applyMatrix4(t.torso);
    pieces.push(t.binder.soft(g, [{ bone: `upperarm_${side}`, to: `lowerarm_${side}` }, { bone: `clavicle_${side}`, to: `upperarm_${side}` }], 5));
  }
  pieces.push(sash(t, 0x1c1a19, 1.0, 0.1));
  const hilts = sayaSet(t, 'ember', 2, pieces);
  group.add(skinnedMesh(t, pieces, t.gear));
  for (const h of hilts) if (h) group.add(h);
  return { tier: 4, group, hilts, dye: { main: 0x3d3b39, trim: 0x1a1817, metal: 0x6a4a2a }, hands: 0x1e1b19, hair: true, blade: 'ember' };
}

/* ------------------------------------------------------------------ tier 5 */

function apexSovereign(t: Tailor): TierLook {
  const group = new THREE.Group();
  const pieces: THREE.BufferGeometry[] = [];
  const colors = { lacquer: 0x050506, edge: 0x9a7a34, band: 0x6a0a12, lace: 0x7a0d14, bandGlow: 2 };
  sode(t, colors, pieces);
  cuirass(t, colors, pieces);
  // A thin black-gold circlet; the celestial eye stays uncovered.
  pieces.push(t.binder.rigid(painted(new THREE.TorusGeometry(0.104, 0.006, 4, t.low ? 12 : 22).rotateX(Math.PI / 2), 0x9a7a34, 1, 0.28), 'Head', mat(0, 0.19, -0.005, -0.22)));
  pieces.push(sash(t, 0x3a060c, 0.985, 0.07));
  const hilts = sayaSet(t, 'obsidian', 2, pieces);
  group.add(skinnedMesh(t, pieces, t.gear));
  for (const h of hilts) if (h) group.add(h);
  return { tier: 5, group, hilts, dye: { main: 0x0e0d10, trim: 0x3e070d, metal: 0xa08436 }, hands: 0x0f0c0d, hair: true, blade: 'obsidian' };
}

export function tailorTiers(t: Tailor): TierLook[] {
  return [wanderingExile(t), dualRonin(t), armoredKenshi(t), ashenWarlord(t), apexSovereign(t)];
}
