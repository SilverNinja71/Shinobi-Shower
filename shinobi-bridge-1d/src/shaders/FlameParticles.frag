// A flame lick, additive: white-yellow when newborn, orange, then deep red as it cools and thins.
// Its outline is torn by noise that scrolls upward, so a cluster of them reads as moving fire.

uniform float uTime;
uniform float uHeat;

varying vec2 vQuad;
varying float vLife;
varying float vSeed;

#include <common>
#include <fog_pars_fragment>

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  // Teardrop: round at the bottom, drawn to a point at the top.
  vec2 q = vQuad;
  q.x *= 1.0 + max(0.0, q.y) * 0.9;
  float r = length(q);
  float torn = noise2(vec2(q.x * 3.0 + vSeed * 9.0, q.y * 2.5 - uTime * 6.0 - vSeed * 4.0));
  float shape = (1.0 - smoothstep(0.25, 1.0, r + (torn - 0.5) * 0.6));
  if (shape <= 0.0) discard;
  float t = vLife;
  vec3 hot = vec3(1.0, 0.92, 0.62);
  vec3 orange = vec3(1.0, 0.45, 0.1);
  vec3 red = vec3(0.65, 0.08, 0.02);
  vec3 c = mix(hot, orange, smoothstep(0.0, 0.35, t));
  c = mix(c, red, smoothstep(0.35, 0.8, t));
  float fade = (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(0.0, 0.08, t);
  c *= shape * shape * fade * (0.45 + 0.9 * uHeat) * 1.6;
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  c *= 1.0 - fogFactor;
#endif
  gl_FragColor = vec4(c, 1.0);
}
