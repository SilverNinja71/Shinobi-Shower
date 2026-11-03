import * as THREE from 'three';
import commonSource from '../../shaders/StormCommon.glsl';
import vertexSource from '../../shaders/StormVertex.glsl';

/** A uniform object shared by reference between materials. */
export type Shared<T> = { value: T };

/**
 * Drops fall at one of SPEED_CLASSES speeds, (SPEED_BASE + k) / SPEED_DIV of their field's velocity.
 * A field's travelled distance wraps at SPEED_DIV box lengths, which moves every class by a whole
 * number of boxes, so GPU-animated particles never jump however long the game runs.
 */
export const SPEED_BASE = 26;
export const SPEED_CLASSES = 12;
export const SPEED_DIV = 32;

export const SPEED_DEFINES = {
  SPEED_BASE: SPEED_BASE.toFixed(1),
  SPEED_CLASSES: SPEED_CLASSES.toFixed(1),
  SPEED_DIV: SPEED_DIV.toFixed(1),
};

/**
 * Quads per instance in the GPU-animated fields. Software WebGL pays a fixed cost per instance, so
 * 12 000 one-quad instances cost far more than 188 instances of 64 quads, while a GPU sees no difference.
 */
export const BATCH = 64;

/** Wraps a field's travelled distance into [0, period) without losing whole boxes. */
export function wrapTravel(value: number, boxSize: number): number {
  const period = boxSize * SPEED_DIV;
  return ((value % period) + period) % period;
}

export interface StormShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
  defines?: Record<string, string | number>;
}

/**
 * A storm particle material: depth-tested but never depth-writing, faded by the scene's fog (see
 * StormCommon.glsl), with premultiplied-alpha blending so one shader can add light (alpha 0), darken
 * (colour 0) or both. Shared uniforms go in by reference.
 */
export function stormMaterial(shader: StormShader): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `${commonSource}\n${vertexSource}\n${shader.vertexShader}`,
    fragmentShader: `${commonSource}\n${shader.fragmentShader}`,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shader.uniforms },
    defines: { STORM_BATCH: BATCH.toFixed(1), ...shader.defines },
    transparent: true,
    depthWrite: false,
    fog: true,
    // Quads are built on screen and may wind either way.
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

/** Splits a GLSL file into its "// @@name" sections (the convention of WetSurfacePBR.frag). */
export function glslSections(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = source.split(/^\/\/ @@([\w-]+)[^\n]*$/m);
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

/** One quad: x runs −1..1 across, y runs from y0 to 1. */
function quad(y0: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, y0, 0, 1, y0, 0, -1, 1, 0, 1, 1, 0], 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

/** A streak: x −1..1 across, y 0 (head) to 1 (tail). */
export const streakQuad = () => quad(0);
/** A sprite or decal: −1..1 on both axes. */
export const spriteQuad = () => quad(-1);

/**
 * A streak as one tapering triangle: twice the width at the head (x ±2), a point at the tail, so it is
 * the full width halfway. Rasterizers walk a thin primitive along its whole length, so one triangle
 * per streak costs half of a two-triangle quad; the taper suits a motion-blurred drop.
 */
export function streakTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-2, 0, 0, 2, 0, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2]);
  return g;
}

/**
 * `count` GPU-animated particles as instanced batches of BATCH copies of `base`. Each vertex keeps its
 * corner in position.xy and its copy's place in the batch in position.z; each instance carries its
 * batch number (aBatch). A shader turns the two into a particle id (stormParticleId) and hashes all
 * its randomness from that, so the buffers are written once and never touched again. The shader must
 * hide ids at or past `count` (the PARTICLES define from `particleDefines`).
 */
export function particleBatches(base: THREE.BufferGeometry, count: number): THREE.InstancedBufferGeometry {
  const corners = base.getAttribute('position') as THREE.BufferAttribute;
  const cornerIndex = base.index!;
  const per = corners.count;
  const position = new Float32Array(BATCH * per * 3);
  const index: number[] = [];
  for (let q = 0; q < BATCH; q++) {
    for (let v = 0; v < per; v++) position.set([corners.getX(v), corners.getY(v), q], (q * per + v) * 3);
    for (let k = 0; k < cornerIndex.count; k++) index.push(cornerIndex.getX(k) + q * per);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setIndex(index);
  const batches = Math.ceil(count / BATCH);
  g.setAttribute('aBatch', new THREE.InstancedBufferAttribute(Float32Array.from({ length: batches }, (_, i) => i), 1));
  g.instanceCount = batches;
  return g;
}

/** The define a batched particle shader uses to hide the padding past `count`. */
export function particleDefines(count: number): Record<string, string> {
  return { ...SPEED_DEFINES, PARTICLES: count.toFixed(1) };
}

/**
 * A pool of instances rewritten every frame from the simulation: per-instance float attributes plus a
 * live count. `begin` resets it, writers fill slots in order, `end` uploads only the used part.
 */
export class InstancePool {
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly capacity: number;
  count = 0;
  private readonly attributes: THREE.InstancedBufferAttribute[] = [];

  constructor(base: THREE.BufferGeometry, capacity: number, layout: Record<string, number>) {
    this.capacity = capacity;
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute('position', base.getAttribute('position'));
    for (const [name, size] of Object.entries(layout)) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, a);
      this.attributes.push(a);
    }
    this.geometry.instanceCount = 0;
  }

  /** The backing array of an attribute, for writers. */
  array(name: string): Float32Array {
    return (this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).array as Float32Array;
  }

  begin(): void {
    this.count = 0;
  }

  /** Claims the next slot, or returns −1 when the pool is full. */
  next(): number {
    return this.count < this.capacity ? this.count++ : -1;
  }

  end(mesh: THREE.Object3D): void {
    for (const a of this.attributes) {
      a.updateRange.offset = 0;
      a.updateRange.count = this.count * a.itemSize;
      a.needsUpdate = this.count > 0;
    }
    this.geometry.instanceCount = this.count;
    mesh.visible = this.count > 0;
  }
}
