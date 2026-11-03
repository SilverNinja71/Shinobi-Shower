import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/Rng.ts';
import type { RenderContext } from '../../render/RenderContext.ts';
import { worldX } from '../../render/RenderContext.ts';
import iceSource from '../../shaders/HailIce.glsl';
import type { Drop } from '../PrecipitationDroplet.ts';
import { glslSections } from './StormMaterial.ts';
import { directions, displacedIcosphere, fbm3 } from './lumpGeometry.ts';

const ICE = glslSections(iceSource);
const VARIANTS = 3;
/** Faces meeting at more than this angle keep a hard edge. */
const CREASE = THREE.MathUtils.degToRad(26);

/**
 * One jagged stone: an icosphere roughened by ridged noise and thrust out into a few blunt spikes.
 * All variants use the same detail, so they share vertex order and can live in one geometry.
 */
function stoneShape(detail: number, seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed * 977 + 13);
  const spikes = directions(9, rng);
  const heights = spikes.map(() => 0.22 + rng() * 0.4);
  const geometry = displacedIcosphere(detail, (x, y, z) => {
    const ridged = 1 - Math.abs(fbm3(x * 1.8 + seed, y * 1.8, z * 1.8, seed, 3) * 2 - 1);
    let r = 0.74 + 0.3 * ridged + 0.08 * fbm3(x * 4.5 + 7, y * 4.5, z * 4.5, seed + 3, 2);
    for (let k = 0; k < spikes.length; k++) {
      const d = x * spikes[k].x + y * spikes[k].y + z * spikes[k].z;
      if (d > 0.87) r += heights[k] * ((d - 0.87) / 0.13) ** 1.2;
    }
    return r;
  });
  // Smooth across gentle bends, sharp along ridges and spike edges: chipped ice rather than a low-poly
  // gem. The geometry is already non-indexed, so its vertex order (shared by the variants) is kept.
  return toCreasedNormals(geometry, CREASE);
}

/**
 * The hailstones: massive jagged ice, a few shape variants drawn in one InstancedMesh with a
 * MeshPhysicalMaterial (clearcoat, icy faked translucency; see HailIce.glsl), each spinning about its
 * own axis by the simulation's drop phase.
 */
export class HailStones {
  readonly mesh: THREE.InstancedMesh;
  private readonly ice: THREE.InstancedBufferAttribute;
  private readonly buffers: THREE.BufferAttribute[];
  private readonly capacity: number;
  private n = 0;
  private readonly axis = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();

  constructor(ctx: RenderContext, capacity: number) {
    this.capacity = capacity;
    const detail = ctx.quality === 'low' ? 2 : 3;
    const shapes = Array.from({ length: VARIANTS }, (_, v) => stoneShape(detail, v + 1));
    const geometry = shapes[0];
    for (let v = 1; v < VARIANTS; v++) {
      geometry.setAttribute(`position${v}`, shapes[v].getAttribute('position'));
      geometry.setAttribute(`normal${v}`, shapes[v].getAttribute('normal'));
    }
    this.ice = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aIce', this.ice);

    // Clear ice scatters little light diffusely: a dark glassy body, glints on the facets (clearcoat),
    // and the faked light inside and at the rim (HailIce.glsl) carry the look.
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.3, 0.4, 0.52),
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      ior: 1.31,
      specularIntensity: 1,
      envMapIntensity: 1.5,
    });
    const uIceDeep = { value: new THREE.Color(0.07, 0.15, 0.27) };
    const uIceRim = { value: new THREE.Color(0.55, 0.78, 1.15) };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uLightning = ctx.uniforms.uLightning;
      shader.uniforms.uIceDeep = uIceDeep;
      shader.uniforms.uIceRim = uIceRim;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${ICE['vertex-common']}`)
        .replace('#include <beginnormal_vertex>', ICE['vertex-normal'])
        .replace('#include <begin_vertex>', ICE['vertex-position']);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${ICE['fragment-common']}`)
        .replace('#include <opaque_fragment>', `${ICE['fragment-ice']}\n#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'storm-hail';

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.buffers = [this.mesh.instanceMatrix, this.ice];
    ctx.scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  add(d: Drop): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    // A fixed tumbling axis per stone, from its id; the simulation's phase is the spin angle.
    this.axis.set(Math.sin(d.id * 12.9898), Math.cos(d.id * 78.233), Math.sin(d.id * 37.719) + 0.3).normalize();
    this.q.setFromAxisAngle(this.axis, d.phase);
    this.pos.set(worldX(d.x), d.y, d.z);
    this.scale.setScalar(d.r);
    this.m.compose(this.pos, this.q, this.scale);
    this.m.toArray(this.mesh.instanceMatrix.array as Float32Array, i * 16);
    const ice = this.ice.array as Float32Array;
    ice[i * 2] = d.id % VARIANTS;
    ice[i * 2 + 1] = (d.id * 0.381966) % 1;
  }

  end(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    for (const a of this.buffers) {
      a.updateRange.offset = 0;
      a.updateRange.count = n * a.itemSize;
      a.needsUpdate = n > 0;
    }
  }
}
