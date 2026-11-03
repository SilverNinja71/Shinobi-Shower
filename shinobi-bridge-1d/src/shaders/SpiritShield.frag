// The spirit shield, additive and faint: a purple fresnel rim, a honeycomb that only shows toward the
// rim, and slow currents rising through it. `uCrack` (0 → 1) splits it into bright fracture lines
// as a hailstone breaks it.

uniform float uTime;
uniform float uIntensity;
uniform float uCrack;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;

#include <common>
#include <fog_pars_fragment>

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** Distance to the nearest hexagon edge (0 on the edge) and that cell's id. */
vec3 hexGrid(vec2 uv) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 ag = abs(g);
  float d = 0.5 - max(dot(ag, normalize(r)), ag.x);
  return vec3(d, uv - g);
}

void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float fres = pow(1.0 - facing, 2.6);
  // Honeycomb wrapped around the bubble.
  vec2 uv = vec2(atan(vLocal.z, vLocal.x) * 2.4, vLocal.y * 4.2);
  vec3 hx = hexGrid(uv);
  float edge = smoothstep(0.06, 0.0, hx.x);
  float cell = hash12(floor(hx.yz * 10.0));
  float current = 0.5 + 0.5 * sin(vLocal.y * 9.0 - uTime * 2.2 + cell * 6.0);
  vec3 violet = vec3(0.62, 0.42, 1.0);
  vec3 c = violet * (fres * 0.85 + 0.012) + violet * edge * (0.03 + fres * 0.5) * current;
  // Fracture: cell edges flare white-violet and cells drop out.
  float crack = uCrack * (edge * 2.0 + step(cell, uCrack) * 0.3);
  c += vec3(0.9, 0.8, 1.0) * crack;
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
