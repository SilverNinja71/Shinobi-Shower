// Crimson lightning, additive, drawn on the camera-facing ribbons of SpiritRibbon.vert: a white-hot
// filament inside a crimson glow, each bolt flickering on its own.

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

void main() {
  float along = vStrip.x;
  float centre = 1.0 - abs(vStrip.y * 2.0 - 1.0);
  float seed = vStrip.z;
  float flick = 0.55 + 0.45 * hash12(vec2(floor(uTime * 40.0), seed));
  float glow = pow(centre, 1.8);
  float core = pow(centre, 9.0);
  float ends = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.88, 1.0, along));
  vec3 c = vec3(1.0, 0.07, 0.18) * glow * 1.3 + vec3(1.0, 0.82, 0.88) * core * 2.2;
  c *= flick * ends * uIntensity;
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
