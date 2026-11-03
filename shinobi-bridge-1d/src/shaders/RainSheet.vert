// Cosmetic rain, animated entirely on the GPU (see RainField.ts). Each particle is one streak: a thin
// triangle from the drop's head (x ±2) tapering back along its velocity to a point (x 0), a shutter's
// worth of motion blur long. Particles are drawn in instanced batches; each hashes its own seeds from
// its id.
//
// Steady-fall drops fill a box around the camera and keep their place in the world: each sits at its
// hashed seed plus the wind-driven displacement the CPU integrates (uDisp), wrapped into the box. Every
// drop falls at one of a few speed classes, (SPEED_BASE + k) / SPEED_DIV of the wind's velocity, so the
// CPU can wrap uDisp at a period that moves every class by whole boxes: no drop ever jumps.
//
// Curtain riders (the first RIDERS particles) ride one of the simulation's sweeping curtains instead:
// a slanted band whose footprint on the deck is the curtain's, packed densely, so a sheet can be seen
// coming. The band pours in from the clouds when the curtain forms and its tail falls away after it
// ends. One rider in VEIL_EVERY is a veil: a long, soft, faint smear that gives the sheet the grey body
// of water too dense to see through.
//
// Streaks nearer than the focus are drawn wider and fainter (out of focus, same light), and drops
// seen against the moon glow brighter, as rain does when backlit.
//
// Thousands of vertices run this, so work is skipped as early as possible: padding, sheets that are
// not falling and streaks out of view are dropped before the costlier steps.
//
// StormCommon.glsl and StormVertex.glsl are prepended.

uniform mat4 uViewProj; // this frame's projection × view
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec2 uDisp;
uniform vec2 uVel;
uniform float uStrength;
uniform float uLightning;
uniform float uFlashGain;
uniform float uShutter;
uniform float uWidth;
uniform float uMinPixels;
uniform float uFocus;   // view depth in focus (m)
uniform float uDefocus; // extra pixels of width per metre nearer than the focus
uniform vec3 uMoonDir;  // toward the moon
#if CURTAIN_SLOTS > 0
uniform vec4 uCurtain[CURTAIN_SLOTS];     // x: footprint centre (world x); y: width; z: sweep speed; w: strength
uniform vec4 uCurtainTime[CURTAIN_SLOTS]; // x: age; y: life (s), counted as the simulation counts them
uniform vec2 uCurtainZ;                    // depth range the sheets fill
uniform float uSpawnY;
uniform float uCurtainGain;
#endif

varying vec2 vUv;
varying float vAlpha;
varying float vVeil;

#if CURTAIN_SLOTS > 0
// The simulation's swell: a curtain thickens over its first 0.6 s and thins over its last.
float curtainSwell(float age, float life) {
  return smoothstep(0.0, 0.6, age) * smoothstep(0.0, 0.6, life - age);
}
#endif

void collapse() {
  // Nothing to draw: put the quad outside the clip volume.
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  vAlpha = 0.0;
}

void main() {
  float id = stormParticleId();
  vUv = vec2(position.x * 0.5, position.y);
  vVeil = 0.0;
  if (id >= PARTICLES) {
    collapse();
    return;
  }
#if CURTAIN_SLOTS > 0
  bool rider = id < RIDERS;
  int slot = int(mod(id, float(CURTAIN_SLOTS)));
  vec4 band = uCurtain[slot];
  if (rider ? band.w <= 0.0 : uStrength < 0.003) {
    collapse();
    return;
  }
#else
  if (uStrength < 0.003) {
    collapse();
    return;
  }
#endif
  vec4 seed = stormHash4(id + 0.5);              // xyz: place in the box; w: streak length and brightness
  vec4 seed2 = stormHash4(id * 1.618 + 4321.5); // x: speed class; y: brightness; z: spread across a band
  float speed = (SPEED_BASE + floor(seed2.x * SPEED_CLASSES)) / SPEED_DIV;
  vec2 travel = uDisp * speed;
  vec3 p;
  p.y = uBoxMin.y + mod(seed.y * uBoxSize.y + travel.y, uBoxSize.y);
  float alpha = uStrength;
  float width = uWidth;
  float len = (0.6 + 0.8 * seed.w) * uShutter;
#if CURTAIN_SLOTS > 0
  if (rider) {
    bool veil = mod(floor(id / float(CURTAIN_SLOTS)), VEIL_EVERY) < 0.5;
    vec4 time = uCurtainTime[slot];
    float fall = max(-uVel.y, 1.0);
    // Drops at this height left the clouds a moment ago, when the band stood further back on its sweep.
    float ago = (uSpawnY - p.y) / fall;
    float u = (seed.x + seed2.z - 1.0) * (veil ? 0.6 : 0.8);
    p.x = band.x - band.z * ago + u * band.y - uVel.x / fall * p.y;
    p.z = mix(uCurtainZ.x, uCurtainZ.y, seed.z);
    alpha = band.w * uCurtainGain * curtainSwell(time.x - ago, time.y) * (1.0 - smoothstep(0.3, 0.8, abs(u)));
    if (veil) {
      // Long, broad, soft and faint: no single veil shows, only streaky haze where they overlap.
      width = 1.2 + seed.w * 1.0;
      len *= 9.0;
      alpha *= 0.05;
      vVeil = 1.0;
    }
  } else
#endif
  {
    p.x = uBoxMin.x + mod(seed.x * uBoxSize.x + travel.x - uBoxMin.x, uBoxSize.x);
    p.z = uBoxMin.z + seed.z * uBoxSize.z;
    alpha *= smoothstep(0.0, 4.0, min(p.x - uBoxMin.x, uBoxMin.x + uBoxSize.x - p.x));
  }
  alpha *= smoothstep(0.0, 3.0, p.y - uBoxMin.y) * smoothstep(0.0, 3.0, uBoxMin.y + uBoxSize.y - p.y);
  vec2 vel = uVel * speed;
  float v = length(vel);
  vec3 tail = p - vec3(vel / max(v, 1e-3), 0.0) * v * len;
  vec4 a = uViewProj * vec4(p, 1.0);
  vec4 b = uViewProj * vec4(tail, 1.0);
  if (alpha < 0.002 || stormOffscreen(a, b)) {
    collapse();
    return;
  }
  // For a perspective camera, clip w is the view depth.
  float blur = min(2.0, max(0.0, uFocus - a.w) * uDefocus);
  float cover;
  gl_Position = stormStreakClip(a, b, width, uMinPixels + blur, position.xy, cover);
  // Rain scatters light forward: drops between the eye and the moon light up.
  float toward = max(dot(normalize(p - cameraPosition), uMoonDir), 0.0);
  float toward2 = toward * toward;
  float light = (0.35 + 1.3 * seed2.y * seed2.y) * (0.8 + 1.2 * toward2 * toward2 * toward2);
  // A flash lights every drop; the haze of a sheet brightens less, so it stays a wall, not a lamp.
  float flash = 1.0 + uLightning * uFlashGain * (1.0 - 0.7 * vVeil);
  vAlpha = alpha * cover * light * stormFogFade(a.w) * flash;
}
