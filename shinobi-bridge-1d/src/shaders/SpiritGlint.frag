// Four-pointed star glint, additive: a hot core, long thin rays and short diagonal spikes.

uniform vec3 uColor;
uniform float uIntensity;
uniform float uSpin;
varying vec2 vQuad;

#include <common>
#include <fog_pars_fragment>

void main() {
  float s = sin(uSpin);
  float co = cos(uSpin);
  vec2 q = mat2(co, -s, s, co) * vQuad;
  float r = length(q);
  float core = exp(-r * 10.0);
  float rays = exp(-abs(q.y) * 46.0) * exp(-abs(q.x) * 2.4) + exp(-abs(q.x) * 46.0) * exp(-abs(q.y) * 2.4);
  float diag = (exp(-abs(q.x - q.y) * 60.0) + exp(-abs(q.x + q.y) * 60.0)) * exp(-r * 5.5) * 0.5;
  vec3 c = uColor * (rays + diag + core * 1.5) + vec3(1.0) * core * 1.2;
  c *= uIntensity * (1.0 - smoothstep(0.85, 1.0, r));
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
