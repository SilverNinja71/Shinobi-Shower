import * as THREE from 'three';
import { MOON_DIR } from './palette.ts';

/**
 * Uniforms only the environment's own shaders share (the game-wide ones live in
 * ctx.uniforms). Held by reference, like those, so one write reaches every material.
 */
export interface EnvUniforms {
  /** How far the cloud deck has drifted, integrated from the wind so it never jumps. */
  uCloudShift: { value: THREE.Vector2 };
  /** Unit vector toward the moon. */
  uMoonDir: { value: THREE.Vector3 };
  /** Unit vector toward the last lightning strike (from the bridge). */
  uFlashDir: { value: THREE.Vector3 };
  /** World position of the last strike's channel, for lighting the far ranges and the sea. */
  uFlashPos: { value: THREE.Vector3 };
  /** 0–1: old snow lying on the cliff tops; grows while it snows, melts slowly after. */
  uSnowCover: { value: number };
  /**
   * How far the air has carried things (m): fog, wisps, the sea's surface. Integrated from the wind
   * rather than computed from time × wind, so a change of wind never makes anything jump.
   */
  uWindDrift: { value: THREE.Vector2 };
}

export function makeEnvUniforms(): EnvUniforms {
  return {
    uCloudShift: { value: new THREE.Vector2() },
    uMoonDir: { value: MOON_DIR.clone() },
    uFlashDir: { value: new THREE.Vector3(0.3, 0.45, -0.84).normalize() },
    uFlashPos: { value: new THREE.Vector3(200, 220, -700) },
    uSnowCover: { value: 0.12 },
    uWindDrift: { value: new THREE.Vector2() },
  };
}
