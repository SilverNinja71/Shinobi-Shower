import * as THREE from 'three';
import type { RenderContext } from '../../render/RenderContext.ts';
import { worldX } from '../../render/RenderContext.ts';
import clumpSource from '../../shaders/StormSnowClump.glsl';
import type { Drop } from '../PrecipitationDroplet.ts';
import { mulberry32 } from '../../core/Rng.ts';
import { directions, displacedIcosphere, fbm3, smoothNormals } from './lumpGeometry.ts';

/** Flakes bigger than this (m) are drawn as clumps of snow rather than sprites. */
export const CLUMP_R = 0.25;

/**
 * Snow clumps: flakes that merged in the air into heavy lumps. Lumpy snow meshes with the snow PBR set,
 * one InstancedMesh. Each is squashed like its hit box (1.5 r wide, 0.8 r tall) and turns slowly
 * about the vertical as it sways down, with a little wobble.
 */
export class SnowClumps {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private n = 0;
  private readonly q = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();

  constructor(ctx: RenderContext, capacity: number) {
    this.capacity = capacity;
    const low = ctx.quality === 'low';
    // Flakes stuck together: a few rounded lobes bulging out of a soft core, with a little crumb on top.
    const lobes = directions(7, mulberry32(71));
    const geometry = displacedIcosphere(low ? 2 : 3, (x, y, z) => {
      let r = 0.62 + 0.3 * fbm3(x * 1.7 + 3, y * 1.7, z * 1.7, 5, 3) + 0.1 * fbm3(x * 5, y * 5, z * 5 + 9, 8, 2);
      for (const l of lobes) {
        const d = x * l.x + y * l.y + z * l.z;
        if (d > 0.55) r += 0.32 * Math.sin(((d - 0.55) / 0.45) * Math.PI * 0.5) ** 2;
      }
      return r;
    });
    smoothNormals(geometry);
    const set = ctx.assets.pbr('snow', 1.5, 1.5);
    const material = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: set.roughnessMap,
      color: new THREE.Color(1.0, 1.0, 1.05),
      roughness: 0.95,
      metalness: 0,
    });
    const uRimColor = { value: new THREE.Color(0.45, 0.55, 0.72) };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uLightning = ctx.uniforms.uLightning;
      shader.uniforms.uRimColor = uRimColor;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${clumpSource}`)
        // The deck snow's albedo carries dark specks of grit; on a clump in the air they read as stone.
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuse * 0.56, diffuseColor.rgb, 0.3);')
        .replace('#include <opaque_fragment>', 'outgoingLight += clumpRim(normal, vViewPosition, diffuseColor.rgb);\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => 'storm-snow-clump';
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    ctx.scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  add(d: Drop): void {
    if (this.n >= this.capacity) return;
    // Spin about the vertical keeps the squashed shape level; the wobble is small enough not to matter.
    this.euler.set(Math.sin(d.age * 1.1 + d.phase) * 0.18, d.phase + d.age * 0.5, Math.sin(d.age * 0.8 + d.phase * 2) * 0.15);
    this.q.setFromEuler(this.euler);
    this.pos.set(worldX(d.x), d.y, d.z);
    this.scale.set(d.r * 1.45, d.r * 0.95, d.r * 1.35);
    this.m.compose(this.pos, this.q, this.scale);
    this.m.toArray(this.mesh.instanceMatrix.array as Float32Array, this.n * 16);
    this.n++;
  }

  end(): void {
    const im = this.mesh.instanceMatrix;
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    im.updateRange.offset = 0;
    im.updateRange.count = this.n * 16;
    im.needsUpdate = this.n > 0;
  }
}
