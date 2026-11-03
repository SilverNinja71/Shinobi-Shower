import * as THREE from 'three';

/**
 * Uniforms every warrior surface shares. They are single objects held by reference, so one write per
 * frame reaches the body, the gear and the blades at once.
 */
export interface WarriorUniforms {
  uTime: { value: number };
  /** View-space direction toward the moon, refreshed each frame from the scene's moonlight. */
  uMoonDir: { value: THREE.Vector3 };
  /** Moonlight rim on the silhouette (colour × strength): what keeps a dark figure readable at night. */
  uMoonRim: { value: THREE.Color };
  /** State rim (vulnerable pulse, exposed glint, tier-up flash), colour × strength. */
  uCueRim: { value: THREE.Color };
  /** 0–1: how soaked the cloth is. */
  uWet: { value: number };
  /** 0–1: snow settled on upward faces (hat brim, shoulders). */
  uSnowCover: { value: number };
}

export function makeWarriorUniforms(): WarriorUniforms {
  return {
    uTime: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(-0.45, 0.72, -0.53).normalize() },
    uMoonRim: { value: new THREE.Color(0xc8d6ff).multiplyScalar(0.8) },
    uCueRim: { value: new THREE.Color(0, 0, 0) },
    uWet: { value: 0.3 },
    uSnowCover: { value: 0 },
  };
}

export interface Dye {
  /** Replaces the atlas's green cloth. */
  main: THREE.ColorRepresentation;
  /** Replaces its brown leather and trims. */
  trim: THREE.ColorRepresentation;
  /** Replaces its pale buckles and studs. */
  metal: THREE.ColorRepresentation;
}

export interface ShadeOptions {
  /** Unique per shader variant (the GLSL below differs by it). */
  key: string;
  /** How much rain darkens and glosses this surface: 1 for cloth, about 0.3 for skin, 0 for metal. */
  wet?: number;
  /** Snow settles on it. */
  snow?: boolean;
  /** Recolours the Quaternius cloth atlas in two tones, keeping its painted detail. */
  dye?: Dye;
  /** Extra GLSL: declarations, and code run just before lighting (where `normal` is known). */
  pars?: string;
  main?: string;
  /** Extra GLSL in the vertex shader: declarations and code after `begin_vertex`. */
  vertexPars?: string;
  vertexMain?: string;
  uniforms?: Record<string, THREE.IUniform>;
}

const DYE_GLSL = /* glsl */ `
#ifdef WARRIOR_DYE
{
  vec3 c = diffuseColor.rgb;
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  float green = smoothstep(-0.015, 0.05, c.g - c.r);
  float pale = smoothstep(0.28, 0.5, lum) * (1.0 - green);
  vec3 tone = mix(uDyeTrim, uDyeMain, green);
  tone = mix(tone, uDyeMetal, pale);
  diffuseColor.rgb = tone * (0.45 + lum * 2.2);
}
#endif
`;

const SURFACE_GLSL = /* glsl */ `
{
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
#ifdef WARRIOR_SNOW
  // Snow settles only on what faces the sky.
  float settle = smoothstep(0.5, 0.92, wN.y) * uSnowCover;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.82, 0.9), settle);
  roughnessFactor = mix(roughnessFactor, 0.85, settle);
  metalnessFactor = mix(metalnessFactor, 0.0, settle);
#endif
  // Soaked cloth darkens and its sheen tightens.
  float soak = uWet * WARRIOR_WET;
  diffuseColor.rgb *= 1.0 - 0.42 * soak;
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, soak);
  // The moon behind the warrior traces the silhouette: a tight fresnel, only on the edges that
  // turn toward it. (A broad one would wash whole panels pale whenever cloth tilts from the view.)
  float edge = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
  float edge2 = edge * edge;
  float moonEdge = edge2 * edge2 * edge * smoothstep(-0.25, 0.75, dot(normal, uMoonDir));
  // State cues wash wider over the figure, so a warning reads at a glance.
  // A faint wash plus a strong rim: the figure keeps its form while the warning pulses.
  float cueEdge = 0.05 + 0.95 * edge2;
  totalEmissiveRadiance += moonEdge * uMoonRim + cueEdge * uCueRim;
}
`;

/** GLSL that carries GeoBuilder's per-vertex paint (metalness, roughness, info) to the fragment shader. */
export const PAINT_VERTEX_PARS = 'attribute vec2 aPbr;\nattribute vec3 aInfo;\nvarying vec2 vPbr;\nvarying vec3 vInfo;\n';
export const PAINT_VERTEX_MAIN = 'vPbr = aPbr;\nvInfo = aInfo;\n';
export const PAINT_PARS = 'varying vec2 vPbr;\nvarying vec3 vInfo;\n';
export const PAINT_MAIN = 'metalnessFactor = vPbr.x;\nroughnessFactor = vPbr.y;\n';

/**
 * A vertex-painted PBR material for GeoBuilder meshes: colour, metalness and roughness per vertex,
 * so lacquer, gold, leather and cord share one draw call. `main` may use `vInfo`.
 */
export function makePaintedMaterial(
  u: WarriorUniforms,
  opts: Omit<ShadeOptions, 'vertexPars' | 'vertexMain'> & { side?: THREE.Side; envMapIntensity?: number },
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, side: opts.side ?? THREE.FrontSide });
  m.envMapIntensity = opts.envMapIntensity ?? 1;
  return shadeWarrior(m, u, {
    ...opts,
    pars: PAINT_PARS + (opts.pars ?? ''),
    main: PAINT_MAIN + (opts.main ?? ''),
    vertexPars: PAINT_VERTEX_PARS,
    vertexMain: PAINT_VERTEX_MAIN,
  });
}

/**
 * Patches a standard (or physical) material with the warrior's shared look: optional atlas dye, rain
 * soak, settling snow and the moonlit rim. Extra GLSL lets gear add its own detail in the same pass.
 */
export function shadeWarrior<T extends THREE.MeshStandardMaterial>(material: T, u: WarriorUniforms, opts: ShadeOptions): T {
  const defines: Record<string, string> = { ...(material.defines ?? {}), WARRIOR_WET: (opts.wet ?? 1).toFixed(3) };
  if (opts.snow) defines.WARRIOR_SNOW = '';
  if (opts.dye) defines.WARRIOR_DYE = '';
  material.defines = defines;
  const dye = opts.dye
    ? { uDyeMain: { value: new THREE.Color(opts.dye.main) }, uDyeTrim: { value: new THREE.Color(opts.dye.trim) }, uDyeMetal: { value: new THREE.Color(opts.dye.metal) } }
    : {};
  material.userData.dye = dye;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime: u.uTime,
      uMoonDir: u.uMoonDir,
      uMoonRim: u.uMoonRim,
      uCueRim: u.uCueRim,
      uWet: u.uWet,
      uSnowCover: u.uSnowCover,
      ...dye,
      ...(opts.uniforms ?? {}),
    });
    const pars = `uniform float uTime;\nuniform vec3 uMoonDir;\nuniform vec3 uMoonRim;\nuniform vec3 uCueRim;\nuniform float uWet;\nuniform float uSnowCover;\n${
      opts.dye ? 'uniform vec3 uDyeMain;\nuniform vec3 uDyeTrim;\nuniform vec3 uDyeMetal;\n' : ''
    }${opts.pars ?? ''}`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${pars}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${DYE_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${opts.main ?? ''}\n${SURFACE_GLSL}`);
    if (opts.vertexPars || opts.vertexMain) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;\n${opts.vertexPars ?? ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${opts.vertexMain ?? ''}`);
    }
  };
  material.customProgramCacheKey = () => `warrior-${opts.key}`;
  return material;
}
