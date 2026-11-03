// Slash crescent, additive. The leading edge follows the blade through the active frames; behind it
// the cut hangs in the air and dissolves through the wake (which still cuts light water).
// One of four looks by define: STEEL (steel-water blue), SPIRIT (purple refractive mist),
// FLAME (fire), CRIMSON (crimson lightning).

uniform float uTime;
uniform float uSweep;     // 0 → 1 through the active frames
uniform float uWake;      // 0 → 1 through the wake
uniform float uStrength;  // overall brightness (fades in at startup)

varying vec2 vArc;
varying float vSide;

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

float fbm(vec2 p) {
  float v = 0.5 * noise2(p);
  v += 0.25 * noise2(p * 2.03 + 7.1);
  v += 0.125 * noise2(p * 4.01 + 3.7);
  return v / 0.875;
}

void main() {
  float s = vArc.x;
  float r = vArc.y;
  float seed = vSide * 17.0;
  // Where the blade is now, and how far behind it this fragment lies along the sweep.
  float lead = uSweep * 1.06;
  float behind = lead - s;
  if (behind < -0.015) discard;
  float head = smoothstep(-0.015, 0.02, behind);
  // Fresh light right behind the blade, a longer fading wake further back; the wake thins it all.
  float trail = exp(-max(behind, 0.0) * mix(2.4, 1.2, uWake));
  float life = (1.0 - uWake) * (1.0 - uWake * 0.35);
  // Across the band: a hot edge where the blade passed, a soft body toward the inside.
  float body = smoothstep(0.0, 0.85, r);
  float edge = smoothstep(0.82, 1.0, r) * (1.0 - smoothstep(0.985, 1.0, r) * 0.6);
  float tips = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.92, 1.0, s));
  vec3 color = vec3(0.0);

#if defined(STEEL)
  // Water flung off the steel: streaks along the sweep, beads of spray at the edge.
  float streak = 0.6 + 0.4 * sin(r * 46.0 + fbm(vec2(s * 9.0, r * 3.0 + seed)) * 5.0);
  float spray = step(0.985, hash12(floor(vec2(s * 140.0, r * 22.0 + uTime * 3.0) + seed))) * smoothstep(0.55, 0.95, r);
  color = vec3(0.16, 0.42, 0.85) * body * streak * 0.7 + vec3(0.75, 0.9, 1.0) * edge * 1.9 + vec3(0.8, 0.92, 1.0) * spray * 1.4;
#elif defined(SPIRIT)
  // Purple mist that bends the light: drifting folds with prismatic fringes.
  vec2 q = vec2(s * 6.0 - uTime * 0.6, r * 3.0 + seed);
  float mist = fbm(q + vec2(fbm(q * 1.7 + uTime * 0.4), 0.0) * 1.6);
  float folds = smoothstep(0.35, 0.85, mist);
  float shimmer = 0.5 + 0.5 * sin((mist + r) * 18.0 - uTime * 6.0);
  vec3 prism = mix(vec3(0.35, 0.55, 1.0), vec3(1.0, 0.45, 0.95), shimmer);
  color = vec3(0.42, 0.2, 0.85) * body * (0.35 + folds * 0.9) + prism * edge * 0.9 + vec3(0.9, 0.78, 1.0) * edge * folds * 1.3;
#elif defined(FLAME)
  // Fire peeling off the blade's path: tongues lick outward and upward from the edge.
  float lick = fbm(vec2(s * 18.0 - uTime * 2.0, r * 4.0 - uTime * 5.0 + seed));
  float tongue = smoothstep(0.25, 0.9, r + (lick - 0.5) * 0.7);
  float heat = clamp(tongue * (0.6 + lick), 0.0, 1.6);
  vec3 fire = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.4, 1.0, heat));
  fire = mix(fire, vec3(1.0, 0.92, 0.6), smoothstep(1.0, 1.5, heat));
  float ember = step(0.992, hash12(floor(vec2(s * 120.0, r * 30.0 - uTime * 9.0) + seed))) * body;
  color = fire * heat * 1.5 + vec3(1.0, 0.8, 0.45) * edge * 1.2 + vec3(1.0, 0.6, 0.2) * ember * 2.0;
#elif defined(CRIMSON)
  // Crimson lightning crawling through a dark-red cut: jagged filaments that re-strike constantly.
  float flick = floor(uTime * 24.0);
  float bolts = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float path = 0.55 + 0.4 * fi / 2.0 + (noise2(vec2(s * 26.0, flick * 1.3 + fi * 7.0 + seed)) - 0.5) * 0.22;
    float d = abs(r - path);
    bolts += exp(-d * 90.0) * (0.6 + 0.4 * hash12(vec2(flick, fi + seed)));
  }
  float flash = 0.7 + 0.3 * hash12(vec2(flick, seed + 3.0));
  color = vec3(0.32, 0.0, 0.03) * body * 0.9 + vec3(1.0, 0.1, 0.22) * bolts * 1.8 * flash + vec3(1.0, 0.75, 0.8) * pow(bolts, 3.0) * 0.8 + vec3(1.0, 0.2, 0.3) * edge * 1.1;
#endif

  float a = head * trail * life * tips * uStrength;
  color *= a;
#ifdef USE_FOG
  // Additive light fades out with distance rather than tinting toward the fog colour.
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  color *= 1.0 - fogFactor;
#endif
  gl_FragColor = vec4(color, 1.0);
}
