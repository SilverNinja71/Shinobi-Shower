import * as THREE from 'three';

/**
 * Effects that must blend softly into the world (steam, dust, sparks, spray) live in their own little
 * scene instead of the main one. PostFX draws the main scene first, then this layer into a separate
 * target while it samples the main scene's depth, so every particle fades out where it meets a plank,
 * the warrior or a cliff instead of being sliced by it, and is hidden behind whatever stands in front.
 *
 * VFX fills the layer; PostFX renders it. Both reach the same instance through `softLayerOf(scene)`.
 */
export interface SoftLayer {
  /** Holds the soft meshes. Its fog is kept equal to the main scene's by PostFX. */
  readonly scene: THREE.Scene;
  /** Put these by reference into every soft material (see SOFT_DEPTH_GLSL). */
  readonly uniforms: SoftUniforms;
  /** True while anything in the layer may be visible; PostFX skips the layer entirely otherwise. */
  active: boolean;
}

export interface SoftUniforms {
  /** Depth of the opaque scene (a DepthTexture), or null before the first frame. */
  tSceneDepth: { value: THREE.Texture | null };
  /** 1 / size of the target the layer is being drawn into, to turn gl_FragCoord into a depth UV. */
  uSoftInvSize: { value: THREE.Vector2 };
  uCameraNear: { value: number };
  uCameraFar: { value: number };
}

const layers = new WeakMap<THREE.Scene, SoftLayer>();

export function softLayerOf(scene: THREE.Scene): SoftLayer {
  let layer = layers.get(scene);
  if (!layer) {
    const soft = new THREE.Scene();
    soft.name = 'vfx-soft-layer';
    soft.matrixWorldAutoUpdate = true;
    layer = {
      scene: soft,
      uniforms: {
        tSceneDepth: { value: null },
        uSoftInvSize: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 2500 },
      },
      active: false,
    };
    layers.set(scene, layer);
  }
  return layer;
}

/**
 * GLSL for soft materials: `softDepthFade(viewZ, softness)` is 0 where the scene is in front of the
 * fragment, rising to 1 once the fragment is `softness` metres in front of it.
 */
export const SOFT_DEPTH_GLSL = /* glsl */ `
uniform sampler2D tSceneDepth;
uniform vec2 uSoftInvSize;
uniform float uCameraNear;
uniform float uCameraFar;

float softSceneViewZ() {
  float d = texture2D(tSceneDepth, gl_FragCoord.xy * uSoftInvSize).x;
  return (uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * d - uCameraFar);
}

float softDepthFade(float viewZ, float softness) {
  return clamp((viewZ - softSceneViewZ()) / softness, 0.0, 1.0);
}
`;
