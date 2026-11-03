import type * as THREE from 'three';
import { makeWetMaterial } from '../../render/Assets.ts';
import type { RenderContext } from '../../render/RenderContext.ts';

/** A rain strength that stays 0, for surfaces that can hold no puddle (see withoutRipples). */
export const NO_RAIN = { value: 0 };

/**
 * Wet, but without the rain ripples of standing water. The wet shader draws ripples only in puddles on
 * upward faces, which ropes, posts and ironwork do not have; yet it can only skip the ripple loop when
 * it knows that for the whole draw, so these get a rain strength of 0. They still darken and gloss with
 * the shared wetness.
 */
export function withoutRipples<T extends THREE.Material>(material: T): T {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.uRain = NO_RAIN;
  };
  return material;
}

/**
 * Old hemp rope: the rope PBR set, soaking up the weather a little more than wood does. Texture
 * coordinates run along the rope at the strands' helical pitch (see RopeGeometry), so no tiling here.
 * `relief` adds the normal map, worth it only where a rope is more than a few pixels thick.
 */
export function makeRopeMaterial(ctx: RenderContext, relief = true): THREE.MeshStandardMaterial {
  const set = ctx.assets.pbr('rope', 1, 1);
  return withoutRipples(
    makeWetMaterial(
      {
        map: set.map,
        ...(relief ? { normalMap: set.normalMap } : {}),
        roughnessMap: set.roughnessMap,
        color: 0xe2d6c2,
        roughness: 1,
        metalness: 0,
        wet: 1.15,
      },
      ctx.uniforms,
    ),
  );
}
