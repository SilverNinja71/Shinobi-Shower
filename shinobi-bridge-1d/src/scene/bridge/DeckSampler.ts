import * as THREE from 'three';
import type { SuspensionBridge } from '../SuspensionBridge.ts';
import { BRIDGE_LENGTH } from './layout.ts';

/** Lane spacing of the deck samples. The modes are smooth, so linear interpolation is exact to ~0.1 mm. */
export const DECK_STEP = 0.25;
export const DECK_SAMPLES = Math.round(BRIDGE_LENGTH / DECK_STEP) + 1;

/**
 * The bridge's shape this frame as a tiny float texture: one texel per DECK_STEP of lane holding
 * (deck height, lateral offset, roll, slope), read straight from the simulation's public API. Every
 * GPU-deformed part (ropes, snow) reads it, so they all follow sag, the three vertical modes, the
 * lateral swing and the roll exactly as the planks and the warrior do, without rebuilding geometry.
 */
export class DeckSampler {
  readonly uniform: { value: THREE.DataTexture };
  private readonly data = new Float32Array(DECK_SAMPLES * 4);
  private readonly texture: THREE.DataTexture;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, DECK_SAMPLES, 1, THREE.RGBAFormat, THREE.FloatType);
    // Float textures are not filterable everywhere; the shader interpolates by hand instead.
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniform = { value: this.texture };
  }

  update(bridge: SuspensionBridge): void {
    const d = this.data;
    for (let i = 0; i < DECK_SAMPLES; i++) {
      const x = i * DECK_STEP;
      d[i * 4] = bridge.deckY(x);
      d[i * 4 + 1] = bridge.lateral(x);
      d[i * 4 + 2] = bridge.rollAt(x);
      d[i * 4 + 3] = bridge.slope(x);
    }
    this.texture.needsUpdate = true;
  }
}

/**
 * GLSL for the deck frame (vertex shaders). `deckAt(x)` interpolates the samples at lane x;
 * `deckPoint` maps a point h above the deck and z across it to world space with the deck's roll,
 * matching placeOnDeck (pitch is left out: along a continuous rope it only reparametrizes the lane).
 */
export const DECK_GLSL = /* glsl */ `
uniform sampler2D uDeck;
#define DECK_SAMPLES ${DECK_SAMPLES.toFixed(1)}
#define DECK_STEP ${DECK_STEP}

vec4 deckAt(float x) {
  float f = clamp(x / DECK_STEP, 0.0, DECK_SAMPLES - 1.0);
  float i = min(floor(f), DECK_SAMPLES - 2.0);
  vec4 a = texture2D(uDeck, vec2((i + 0.5) / DECK_SAMPLES, 0.5));
  vec4 b = texture2D(uDeck, vec2((i + 1.5) / DECK_SAMPLES, 0.5));
  return mix(a, b, f - i);
}

vec3 deckPoint(vec4 d, float x, float h, float z) {
  float c = cos(d.z);
  float s = sin(d.z);
  return vec3(x - LANE_HALF, d.x + h * c - z * s, d.y + h * s + z * c);
}

vec3 deckRotate(vec4 d, vec3 v) {
  float c = cos(d.z);
  float s = sin(d.z);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}
`;
