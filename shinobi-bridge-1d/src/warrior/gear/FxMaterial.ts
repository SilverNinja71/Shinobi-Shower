import * as THREE from 'three';

/**
 * An additive light effect material that respects the scene fog (the shaders fade their light out
 * with fog distance rather than tinting it). `uniforms` are put in by reference, so one uniform
 * object can drive several materials.
 */
export function additiveMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  defines: Record<string, string> = {},
  side: THREE.Side = THREE.DoubleSide,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    defines,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
    fog: true,
  });
}
