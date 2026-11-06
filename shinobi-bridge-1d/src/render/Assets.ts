import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import wetSource from '../shaders/WetSurfacePBR.frag';
import type { SharedUniforms } from './RenderContext.ts';

/** CC0 PBR sets in assets/tex (see CREDITS.md). */
export type PBRName = 'plank' | 'slate' | 'rope' | 'snow' | 'burlap' | 'leather' | 'tile' | 'wall' | 'rock';

const PBR_FILES: Record<PBRName, string[]> = {
  plank: ['d', 'n', 'r', 'ao'],
  slate: ['d', 'n', 'r', 'ao'],
  rope: ['d', 'n', 'r'],
  snow: ['d', 'n', 'r'],
  burlap: ['d', 'n', 'r'],
  leather: ['d', 'n', 'r'],
  tile: ['d', 'n', 'r'],
  wall: ['d', 'n', 'r'],
  rock: ['d', 'n', 'r'],
};

/** The character's own textures, from the Quaternius packs. */
const CHAR_FILES = ['arm_m_d', 'arm_m_n', 'eye_d', 'head_m_d', 'head_m_n', 'ranger_d', 'ranger_n', 'ranger_orm'];
const SRGB = /_d$/;

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture | null;
}

export interface CharacterGLTF {
  body: GLTF;
  anims: GLTF;
  ninjaAnims: GLTF;
}

export interface WorldModels {
  nature: GLTF;
  wukong: GLTF;
  nezhaGeo: THREE.BufferGeometry;
}

export class Assets {
  /** Every texture by file stem, e.g. `plank_d`, `slate_n`, `head_m_d`. */
  readonly tex: Record<string, THREE.Texture>;
  readonly character: CharacterGLTF;
  readonly world: WorldModels;
  readonly maxAnisotropy: number;

  private constructor(tex: Record<string, THREE.Texture>, character: CharacterGLTF, world: WorldModels, maxAnisotropy: number) {
    this.tex = tex;
    this.character = character;
    this.world = world;
    this.maxAnisotropy = maxAnisotropy;
  }

  /** Loads everything the game draws. `onProgress` gets 0–1. */
  static async load(renderer: THREE.WebGLRenderer, onProgress: (p: number) => void): Promise<Assets> {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => onProgress(total ? loaded / total : 0);
    const texLoader = new THREE.TextureLoader(manager);
    const gltfLoader = new GLTFLoader(manager);
    const fileLoader = new THREE.FileLoader(manager);
    fileLoader.setResponseType('arraybuffer');
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const stems: string[] = [];
    for (const [name, maps] of Object.entries(PBR_FILES)) for (const m of maps) stems.push(`${name}_${m}`);
    const texJobs = [
      ...stems.map((s) => ({ stem: s, url: `assets/tex/${s}.jpg` })),
      ...CHAR_FILES.map((s) => ({ stem: s, url: `assets/chars/${s}.jpg` })),
    ].map(async ({ stem, url }) => {
      const t = await texLoader.loadAsync(url);
      t.colorSpace = SRGB.test(stem) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      if (url.includes('/tex/')) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      // Character textures belong to glTF meshes, whose UVs expect an unflipped image.
      if (url.includes('/chars/')) t.flipY = false;
      return [stem, t] as const;
    });
    const [texPairs, body, anims, ninjaAnims, nature, wukong, nezhaBuf] = await Promise.all([
      Promise.all(texJobs),
      gltfLoader.loadAsync('assets/chars/steve.glb'),
      gltfLoader.loadAsync('assets/chars/anims.glb'),
      gltfLoader.loadAsync('assets/chars/ninja_anims.glb'),
      gltfLoader.loadAsync('assets/world/nature.glb'),
      gltfLoader.loadAsync('assets/world/wukong.glb'),
      fileLoader.loadAsync('assets/world/nezha.stl') as Promise<ArrayBuffer>,
    ]);
    const nezhaGeo = parseBinarySTL(nezhaBuf);
    return new Assets(Object.fromEntries(texPairs), { body, anims, ninjaAnims }, { nature, wukong, nezhaGeo }, aniso);
  }

  /**
   * A PBR set with its own tiling. Textures are cloned per call, so two materials can tile the
   * same image differently; the image data itself is shared.
   */
  pbr(name: PBRName, repeatX = 1, repeatY = repeatX): PBRSet {
    const get = (m: string) => {
      const base = this.tex[`${name}_${m}`];
      if (!base) return null;
      const t = base.clone();
      t.repeat.set(repeatX, repeatY);
      t.needsUpdate = true;
      return t;
    };
    return { map: get('d')!, normalMap: get('n')!, roughnessMap: get('r')!, aoMap: get('ao') };
  }
}

function parseBinarySTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(buffer);
  const faces = view.getUint32(80, true);
  const positions = new Float32Array(faces * 9);
  const normals = new Float32Array(faces * 9);
  let offset = 84;
  for (let i = 0; i < faces; i++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;
    for (let v = 0; v < 3; v++) {
      const idx = i * 9 + v * 3;
      const vx = view.getFloat32(offset, true);
      const vy = view.getFloat32(offset + 4, true);
      const vz = view.getFloat32(offset + 8, true);
      // MakerWorld STL is Z-up; convert to Three.js Y-up
      positions[idx] = vx;
      positions[idx + 1] = vz;
      positions[idx + 2] = -vy;
      normals[idx] = nx;
      normals[idx + 1] = nz;
      normals[idx + 2] = -ny;
      offset += 12;
    }
    offset += 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.center();
  return geo;
}

/* ---------------- Wet-surface PBR ---------------- */

function section(name: string): string {
  const start = wetSource.indexOf(`// @@${name}`);
  if (start < 0) throw new Error(`WetSurfacePBR.frag has no @@${name} section`);
  const from = wetSource.indexOf('\n', start) + 1;
  const next = wetSource.indexOf('// @@', from);
  return wetSource.slice(from, next < 0 ? undefined : next);
}

const WET = {
  common: section('common'),
  albedo: section('albedo'),
  roughness: section('roughness'),
  normal: section('normal'),
};

const WET_VERTEX_COMMON = 'varying vec3 vWetPos;\nvarying vec3 vWetNormal;\n';
const WET_VERTEX_MAIN = `
#ifdef USE_INSTANCING
  vec4 wetWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vWetNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vec4 wetWorld = modelMatrix * vec4(transformed, 1.0);
  vWetNormal = normalize(mat3(modelMatrix) * objectNormal);
#endif
vWetPos = wetWorld.xyz;
`;

export interface WetOptions {
  /** How much this surface soaks up the weather (multiplies the global wetness). Default 1. */
  wet?: number;
  /**
   * World-space triplanar mapping, for rock with no usable UVs. `scale` is texture repeats per metre.
   * When set, the set's maps are sampled by the wet shader and must not also be passed as material maps.
   */
  triplanar?: { set: PBRSet; scale: number; tint?: THREE.ColorRepresentation };
}

/**
 * A MeshStandardMaterial that reacts to the weather: soaked surfaces darken and gloss over, puddles
 * gather on upward faces with rain rings in them, and water runs down steep faces. The material's
 * `userData.uWetLocal` uniform scales how wet it gets (shelter, for example).
 */
export function makeWetMaterial(params: THREE.MeshStandardMaterialParameters & WetOptions, uniforms: SharedUniforms): THREE.MeshStandardMaterial {
  const { wet = 1, triplanar, ...standard } = params;
  const material = new THREE.MeshStandardMaterial(standard);
  const uWetLocal = { value: wet };
  material.userData.uWetLocal = uWetLocal;
  if (triplanar) material.defines = { ...(material.defines ?? {}), WET_TRIPLANAR: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = uniforms.uWetness;
    shader.uniforms.uWetLocal = uWetLocal;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uRain = uniforms.uRain;
    if (triplanar) {
      shader.uniforms.uTriMap = { value: triplanar.set.map };
      shader.uniforms.uTriNormal = { value: triplanar.set.normalMap };
      shader.uniforms.uTriRough = { value: triplanar.set.roughnessMap };
      shader.uniforms.uTriAO = { value: triplanar.set.aoMap ?? triplanar.set.roughnessMap };
      shader.uniforms.uTriScale = { value: triplanar.scale };
      shader.uniforms.uTriTint = { value: new THREE.Color(triplanar.tint ?? 0xffffff) };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WET_VERTEX_COMMON}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${WET_VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WET.common}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${WET.albedo}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${WET.roughness}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${WET.normal}`);
  };
  material.customProgramCacheKey = () => (triplanar ? 'wet-tri' : 'wet');
  return material;
}
