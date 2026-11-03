// Spirit light, additive. Default: a glowing ribbon trailing from the armour, a hot core with pulses
// running down to its tail. AURA: the shimmering mist sheath around a spirit blade, wisps streaming
// toward the point with prismatic fringes, like air bent by heat.

uniform float uTime;
uniform float uIntensity;
varying vec4 vStrip;

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
  float along = vStrip.x;
  float across = vStrip.y;
  float seed = vStrip.z;
  float centre = 1.0 - abs(across * 2.0 - 1.0);
  vec3 c;
#ifdef AURA
  vec2 q = vec2(along * 7.0 - uTime * 1.8, across * 2.2 + seed);
  float n = noise2(q) * 0.6 + noise2(q * 2.1 + vec2(uTime * 0.7, 0.0)) * 0.4;
  float wisp = smoothstep(0.3, 0.85, n) * pow(centre, 1.4);
  float shimmer = 0.5 + 0.5 * sin((n + across) * 19.0 - uTime * 7.0);
  c = mix(vec3(0.35, 0.3, 1.0), vec3(0.95, 0.5, 1.0), shimmer) * wisp * 0.9;
  c += vec3(0.55, 0.45, 1.0) * pow(centre, 5.0) * 0.45;
  c *= smoothstep(0.0, 0.1, along) * smoothstep(1.0, 0.86, along);
#else
  float pulse = 0.55 + 0.45 * sin(along * 13.0 - uTime * 5.5 + seed * 2.3);
  float glow = smoothstep(0.0, 0.7, centre);
  float core = pow(centre, 3.5);
  float frayed = smoothstep(0.15, 0.6, noise2(vec2(along * 18.0 - uTime * 2.0, seed * 5.0)) + (1.0 - along));
  c = vec3(0.5, 0.26, 1.0) * glow * (0.55 + 0.45 * pulse) + vec3(0.92, 0.82, 1.0) * core * pulse * 0.9;
  c *= (1.0 - along * 0.7) * frayed * smoothstep(0.0, 0.05, along + 0.02);
#endif
  c *= uIntensity;
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
