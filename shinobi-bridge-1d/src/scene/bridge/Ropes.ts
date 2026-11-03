import * as THREE from 'three';
import type { RenderContext } from '../../render/RenderContext.ts';
import ropeSource from '../../shaders/Rope.glsl';
import { makeRng } from './BoardGeometry.ts';
import { DECK_GLSL } from './DeckSampler.ts';
import type { DeckSampler } from './DeckSampler.ts';
import { extendMaterial, glslSections } from './glsl.ts';
import type { Splice } from './glsl.ts';
import { BRIDGE_LENGTH, EDGE_RADIUS, HAND_HEIGHT, HAND_RADIUS, SUSPENDER_RADIUS, SUSPENDER_STEP, layoutDefines } from './layout.ts';
import { makeRopeMaterial } from './materials.ts';
import { RopeBuilder, RopePath } from './RopeGeometry.ts';
import { fibreTexture } from './textures.ts';

const ROPE = glslSections(ropeSource);
const SUSPENDERS = Math.round(BRIDGE_LENGTH / SUSPENDER_STEP) - 1;
const VERTEX_COMMON = `${layoutDefines()}\n${DECK_GLSL}\n${ROPE.common}`;

/** A smooth bump: 1 at u = 0, 0 from |u| = 1. */
const bump = (u: number) => (Math.abs(u) >= 1 ? 0 : (1 - u * u) ** 2);

/** Sorted, de-duplicated parameters. */
function stations(values: number[]): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1] > 0.004);
}

/**
 * Every moving rope of the bridge: the two hand ropes dipping between suspenders, the two deck-edge ropes
 * the planks rest on, and the suspenders between them, as one merged mesh deformed on the GPU from the
 * deck samples (one draw call, plus one for its shadow); and the frayed fibre tufts as a second, alpha-cut
 * mesh. The ropes are camera-facing ribbons shaded round (see Rope.glsl): a few pixels thick on screen,
 * a real tube's many slivers of triangles would cost far more than they show. Nothing to update per
 * frame: the shader reads the deck samples.
 */
export function addRopes(ctx: RenderContext, parent: THREE.Object3D, deck: DeckSampler): void {
  const low = ctx.quality === 'low';
  const rng = makeRng(0x4092);
  const uniforms = { uDeck: deck.uniform, uTime: ctx.uniforms.uTime, uWind: ctx.uniforms.uWind };
  const vertex: Splice[] = [
    { anchor: '#include <common>', code: VERTEX_COMMON },
    { anchor: '#include <beginnormal_vertex>', code: ROPE['normal-vertex'] },
    { anchor: '#include <begin_vertex>', code: ROPE.position },
  ];

  // The strands' relief is far below a pixel on a ribbon this thin; colour and gloss carry the hemp.
  const material = makeRopeMaterial(ctx, false);
  material.defines = { ...(material.defines ?? {}), ROPE_RIBBON: '' };
  // The ribbon turns to face the moon for its shadow: draw that face, whichever way it winds.
  material.shadowSide = THREE.DoubleSide;
  extendMaterial(material, 'wet-rope', uniforms, vertex, [
    { anchor: '#include <common>', code: ROPE['fragment-common'] },
    { anchor: '#include <clearcoat_normal_fragment_begin>', code: ROPE['fragment-normal'], before: true },
  ]);
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.defines = { ROPE_RIBBON: '' };
  extendMaterial(depth, 'rope-depth', uniforms, [
    { anchor: '#include <common>', code: VERTEX_COMMON },
    { anchor: '#include <begin_vertex>', code: ROPE['depth-position'] },
  ]);

  const ropes = new RopeBuilder();
  const knots = Array.from({ length: SUSPENDERS }, (_, k) => (k + 1) * SUSPENDER_STEP);
  const knotStations = (offsets: number[]) => knots.flatMap((x) => offsets.flatMap((d) => [x - d, x + d]));
  const knotSwell = (s: number, width: number) => knots.reduce((m, x) => Math.max(m, bump((s - x) / width)), 0);
  const along = (from: number, to: number, d: number) => Array.from({ length: Math.round((to - from) / d) + 1 }, (_, i) => from + i * d);

  // Hand ropes: thick old hawsers dipping between suspenders (a few stations per span shape the dip),
  // swollen where each suspender is lashed round them.
  const hand = stations([...along(-0.12, BRIDGE_LENGTH + 0.12, low ? 0.4 : 0.2), ...(low ? [] : knotStations([0, 0.06]))]);
  for (const path of [RopePath.HandFront, RopePath.HandBack]) {
    const phase = rng() * 10;
    ropes.ribbon(path, hand, (s) => HAND_RADIUS * (1 + 0.5 * knotSwell(s, 0.06) + 0.05 * Math.sin(s * 5.3 + phase)), (s) => s);
  }
  // Deck-edge ropes: straight under the plank ends, knotted at every suspender.
  const edge = stations([...along(-0.12, BRIDGE_LENGTH + 0.12, low ? 1.2 : 0.6), ...(low ? [] : knotStations([0, 0.05]))]);
  for (const path of [RopePath.EdgeFront, RopePath.EdgeBack]) {
    ropes.ribbon(path, edge, (s) => EDGE_RADIUS * (1 + 0.35 * knotSwell(s, 0.05)), (s) => s);
  }
  // Suspenders, knotted round the edge rope at the bottom and the hand rope at the top.
  const length = HAND_HEIGHT + 0.07;
  const hang = low ? [-0.02, 1.02] : [-0.03, 0.03, 0.97, 1.03];
  for (const path of [RopePath.SuspenderFront, RopePath.SuspenderBack]) {
    for (const x of knots) {
      const fat = 0.9 + 0.25 * rng();
      ropes.ribbon(path, hang, (s) => SUSPENDER_RADIUS * fat * (1 + 0.9 * bump(s / 0.05) + 0.9 * bump((s - 1) / 0.05)), (s) => s * length, x);
    }
  }

  const mesh = new THREE.Mesh(ropes.build(), material);
  mesh.customDepthMaterial = depth;
  // The vertices are placed in the shader, far from where the static bounds say.
  mesh.frustumCulled = false;
  // Ropes a few pixels thick show nothing of the shadows falling on them, and soft shadow lookups
  // are among the dearest things a pixel does; they still cast theirs on the deck and the snow.
  mesh.castShadow = !low;
  mesh.name = 'ropes';
  parent.add(mesh);

  if (low) return;
  // Frayed tufts at the knots and here and there along the ropes.
  const fibres = new RopeBuilder();
  const tuft = (path: RopePath, s: number, lane: number, radius: number, size: number) =>
    fibres.card(path, s, lane, radius, rng() * Math.PI * 2, (rng() - 0.5) * 1.6, size * (0.6 + 0.6 * rng()), size * (0.4 + 0.3 * rng()), rng() * Math.PI);
  for (const path of [RopePath.HandFront, RopePath.HandBack]) {
    for (const x of knots) tuft(path, x + (rng() - 0.5) * 0.08, 0, HAND_RADIUS * 1.3, 0.08);
    for (let i = 0; i < 16; i++) tuft(path, rng() * BRIDGE_LENGTH, 0, HAND_RADIUS, 0.065);
  }
  for (const path of [RopePath.EdgeFront, RopePath.EdgeBack]) {
    for (let i = 0; i < 10; i++) tuft(path, rng() * BRIDGE_LENGTH, 0, EDGE_RADIUS, 0.06);
  }
  for (const path of [RopePath.SuspenderFront, RopePath.SuspenderBack]) {
    for (const x of knots) if (rng() < 0.6) tuft(path, 0.02 + rng() * 0.03, x, SUSPENDER_RADIUS * 1.6, 0.05);
  }
  // Not a wet material: loose fibres facing up would pool "puddles" and shine like mirrors.
  const fibreMaterial = new THREE.MeshStandardMaterial({
    map: fibreTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    color: 0x8a7e6c,
    roughness: 0.9,
    metalness: 0,
  });
  extendMaterial(fibreMaterial, 'rope-fibre', uniforms, vertex);
  const tufts = new THREE.Mesh(fibres.build(), fibreMaterial);
  tufts.frustumCulled = false;
  tufts.name = 'rope-fibres';
  parent.add(tufts);
}
