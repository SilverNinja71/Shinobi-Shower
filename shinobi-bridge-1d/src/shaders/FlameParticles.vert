// Flame licks shed by a burning blade. Each instance is a camera-facing quad born at a point on the
// edge (aSpawn.xyz, at time aSpawn.w) with a velocity (aMotion.xyz) and a lifetime (aMotion.w);
// the GPU moves it: it rises with buoyancy, drifts with the wind, swells and then thins out.
// The particles stay where the blade left them, so a swing leaves a trail of fire behind it.

attribute vec4 aSpawn;
attribute vec4 aMotion;
attribute float aSeed;

uniform float uTime;
uniform float uWind;
uniform float uSize;
uniform float uHeat;

varying vec2 vQuad;
varying float vLife;
varying float vSeed;

#include <common>
#include <fog_pars_vertex>

void main() {
  float age = uTime - aSpawn.w;
  float life = age / aMotion.w;
  vLife = life;
  vSeed = aSeed;
  vQuad = position.xy * 2.0;
  if (life < 0.0 || life > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 p = aSpawn.xyz + aMotion.xyz * age;
  // Hot air rises faster and faster; the crosswind bends the flame over.
  p.y += 1.6 * age * age;
  p.x += uWind * 0.22 * age * age;
  // A smouldering blade sheds small licks; a hot swing throws big ones.
  float size = uSize * (0.45 + 0.85 * uHeat) * (0.55 + 0.9 * sin(PI * min(1.0, life * 1.15))) * (0.8 + 0.4 * aSeed);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  // Taller than wide: flame tongues.
  mvPosition.xy += position.xy * vec2(size, size * 1.6);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
