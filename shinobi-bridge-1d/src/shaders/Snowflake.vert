// Cosmetic snowfall, animated entirely on the GPU (see SnowFall.ts). Flakes fill a box around the
// camera and keep their place in the world: a hashed seed plus the wind drift and fall the CPU
// integrates (uDisp, wrapped exactly per speed class as in RainSheet.vert), plus each flake's own lazy
// sway. Flakes nearer than the focus blur into soft discs. Drawn in instanced batches like the rain.
//
// StormCommon.glsl and StormVertex.glsl are prepended.

uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec2 uDisp;
uniform float uTime;
uniform float uStrength;
uniform float uLightning;
uniform float uMinPixels;
uniform float uFocus; // view depth in focus (m)

varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

void main() {
  float id = stormParticleId();
  vec4 seed = stormHash4(id + 0.5);            // xyz: place in the box; w: size
  vec4 seed2 = stormHash4(id * 1.618 + 977.5); // x: speed class; y: sway rate; z: sway phase; w: brightness
  vUv = position.xy;
  vSeed = seed.w;
  float speed = (SPEED_BASE + floor(seed2.x * SPEED_CLASSES)) / SPEED_DIV;
  float rate = 0.5 + seed2.y * 1.1;
  float phase = seed2.z * 6.283;
  vec3 p;
  p.x = uBoxMin.x + mod(seed.x * uBoxSize.x + uDisp.x * speed + sin(uTime * rate + phase) * 0.45 - uBoxMin.x, uBoxSize.x);
  p.y = uBoxMin.y + mod(seed.y * uBoxSize.y + uDisp.y * speed, uBoxSize.y);
  p.z = uBoxMin.z + seed.z * uBoxSize.z + cos(uTime * rate * 0.7 + phase) * 0.35;
  float edge = min(p.x - uBoxMin.x, uBoxMin.x + uBoxSize.x - p.x);
  float alpha = uStrength * smoothstep(0.0, 3.0, edge) * smoothstep(0.0, 2.0, p.y - uBoxMin.y) * smoothstep(0.0, 2.0, uBoxMin.y + uBoxSize.y - p.y);
  if (alpha < 0.002 || id >= PARTICLES) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  float size = mix(0.05, 0.14, seed.w * seed.w);
  float depth = -(viewMatrix * vec4(p, 1.0)).z;
  size *= 1.0 + max(0.0, uFocus - depth) * 0.12;
  float cover;
  gl_Position = stormSprite(p, vec2(size), phase, uMinPixels, position.xy, cover);
  vAlpha = alpha * min(1.0, cover * 1.3) * (0.4 + 0.6 * seed2.w) * stormFogFade(depth) * (1.0 + uLightning * 2.5);
}
