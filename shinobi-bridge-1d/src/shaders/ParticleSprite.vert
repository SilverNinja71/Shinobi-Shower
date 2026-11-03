// VFX sprites (SpritePool.ts): camera-facing quads animated entirely here from what they were launched
// with, so the CPU writes each particle once. Drag and gravity are integrated exactly: with drag k and
// constant acceleration a, v(t) = a/k + (v0 − a/k)·e^(−kt). Puffs drift with the crosswind; streaks
// stretch along their motion on screen (motion blur) and never get thinner than about a pixel.

attribute vec2 aCorner;
/** Launch velocity (m/s) and birth time (s, on the pool's clock). */
attribute vec4 aVel;
/** Shape (see SpritePool.SHAPE), life (s), start and end half-size (m). */
attribute vec4 aShape;
/** Drag (1/s), gravity (m/s², positive pulls down, negative rises), spin (rad/s), seed (0–1). */
attribute vec4 aMotion;
/** Premultiplied linear colour, and coverage (0 adds light, 1 hides what is behind). */
attribute vec4 aColor;
/** Emissive tint that cools away at rate w (1/s): the heat of a flame, a flash. */
attribute vec4 aGlow;

uniform float uTime;
uniform float uWind;
/** Size of one drawing-buffer pixel at 1 m from the camera, in metres. */
uniform float uPixel;
/** Screen direction toward the moon, for lighting the puffs. */
uniform vec2 uLightDir;

varying vec2 vCorner;
varying vec4 vColor;
varying vec3 vGlow;
/** Shape, age (0–1 of life), seed, brightness kept by sub-pixel sprites. */
varying vec4 vInfo;
/** The moon's direction in the sprite's own (rotated) frame. */
varying vec2 vLight;
varying float vViewZ;

#include <fog_pars_vertex>

/** Exposure time of the streaks (s). */
const float SHUTTER = 0.022;

void main() {
  float age = uTime - aVel.w;
  float t = age / aShape.y;
  if (t < 0.0 || t >= 1.0) {
    // Not born yet, or gone: all four corners land outside the clip volume.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float shape = aShape.x;
  float k = aMotion.x;
  vec3 acc = vec3(shape < 0.5 ? uWind * 0.6 * k : 0.0, -aMotion.y, 0.0);
  vec3 p;
  vec3 v;
  if (k > 0.001) {
    float e = exp(-k * age);
    vec3 drift = acc / k;
    v = drift + (aVel.xyz - drift) * e;
    p = position + drift * age + (aVel.xyz - drift) * (1.0 - e) / k;
  } else {
    v = aVel.xyz + acc * age;
    p = position + (aVel.xyz + 0.5 * acc * age) * age;
  }

  // Grows fast, then slowly: a puff billows out and hangs.
  float grow = 1.0 - (1.0 - t) * (1.0 - t);
  float size = mix(aShape.z, aShape.w, grow);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  // Never thinner than about a pixel and a half; a sprite widened to that keeps some of its light.
  float minSize = uPixel * -mvPosition.z * 0.75;
  float energy = 1.0;
  if (size < minSize) {
    energy = sqrt(size / minSize);
    size = minSize;
  }

  float spin = aMotion.w * 6.2831853 + aMotion.z * age;
  vec2 offset;
  if (abs(shape - 1.0) < 0.5) {
    // Streak: along the motion as the camera sees it, a shutter's worth long.
    vec2 sv = (mat3(modelViewMatrix) * v).xy;
    float speed = length(sv);
    vec2 axis = speed > 1e-4 ? sv / speed : vec2(0.0, 1.0);
    float len = size + speed * SHUTTER;
    offset = axis * aCorner.y * len + vec2(-axis.y, axis.x) * aCorner.x * size;
    vLight = uLightDir;
  } else {
    vec2 c = aCorner;
    // A shard tumbles: its outline narrows and widens as it turns edge-on and back.
    if (abs(shape - 3.0) < 0.5) c.x *= 0.12 + 0.88 * abs(cos(aMotion.z * age * 0.8 + aMotion.w * 9.0));
    float cs = cos(spin);
    float sn = sin(spin);
    offset = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * size;
    vLight = vec2(cs * uLightDir.x + sn * uLightDir.y, -sn * uLightDir.x + cs * uLightDir.y);
  }
  mvPosition.xy += offset;
  vViewZ = mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;

  vCorner = aCorner;
  vColor = aColor;
  vGlow = aGlow.rgb * exp(-aGlow.w * age);
  vInfo = vec4(shape, t, aMotion.w, energy);
  #include <fog_vertex>
}
