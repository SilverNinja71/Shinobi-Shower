// Drifting mist banks (see MistBanks.ts): large soft camera-facing sprites in two layers, long low
// banks hanging behind and below the bridge, and smaller wisps (every FRONT_EVERY-th bank) drifting
// between it and the camera. They ride the wind, wrapped in a box around the camera like the rain
// (exact per speed class, so a bank never jumps), and fade as they near the lens so none is ever cut
// by the near plane. Overlapping translucent sprites are the costliest thing to fill, so the banks are
// few and sized to cover the view about once; the lens fog itself is PostFX's.
//
// StormCommon.glsl and StormVertex.glsl are prepended.

uniform vec3 uBoxMin;   // x follows the camera; y range of the banks
uniform vec3 uBoxSize;
uniform vec2 uFrontZ;
uniform vec2 uBackZ;
uniform float uDrift;   // integrated wind drift (m), wrapped on the CPU
uniform float uTime;
uniform float uStrength;

varying vec2 vUv;
varying float vAlpha;
varying vec2 vScroll;

void main() {
  float id = stormParticleId();
  vec4 seed = stormHash4(id + 0.5);            // xyz: place (0–1); w: size
  vec4 seed2 = stormHash4(id * 1.618 + 271.5); // x: drift class; y: spin and bob; z: opacity
  vUv = position.xy * 0.5 + 0.5;
  if (id >= PARTICLES || uStrength < 0.003) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  float speed = (SPEED_BASE + floor(seed2.x * SPEED_CLASSES)) / SPEED_DIV;
  bool front = mod(id, FRONT_EVERY) < 0.5;
  vec3 p;
  p.x = uBoxMin.x + mod(seed.x * uBoxSize.x + uDrift * speed - uBoxMin.x, uBoxSize.x);
  p.y = uBoxMin.y + seed.y * uBoxSize.y + sin(uTime * 0.07 + seed2.y * 6.283) * 0.5;
  p.z = front ? mix(uFrontZ.x, uFrontZ.y, seed.z) : mix(uBackZ.x, uBackZ.y, seed.z);
  // Mist lies in long, low banks: wide and flat, barely tilting as they roll.
  float size = front ? mix(5.0, 9.0, seed.w) : mix(12.0, 24.0, seed.w);
  float spin = (seed2.y - 0.5) * 0.25 + sin(uTime * 0.03 + seed2.y * 6.283) * 0.05;
  float cover;
  gl_Position = stormSprite(p, vec2(size, size * 0.36), spin, 0.0, position.xy, cover);
  float depth = gl_Position.w;
  float edge = smoothstep(0.0, 8.0, min(p.x - uBoxMin.x, uBoxMin.x + uBoxSize.x - p.x));
  float opacity = mix(0.45, 1.0, seed2.z) * (front ? 0.6 : 1.0);
  vAlpha = uStrength * opacity * edge * smoothstep(4.0, 10.0, depth) * mix(1.0, stormFogFade(depth), 0.6);
  // The noise crawls along the bank as it drifts, so the bank churns.
  vScroll = seed.xy * 5.0 + uTime * vec2(0.012, -0.004);
}
