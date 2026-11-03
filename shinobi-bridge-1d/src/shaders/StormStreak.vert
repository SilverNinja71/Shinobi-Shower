// Gameplay drops drawn as streaks (see DropStreaks.ts): rain, the glints of mist, and the icy smear
// behind each falling hailstone. Sharper, wider and brighter than the cosmetic sheets so every threat
// reads. Positions come from the simulation each frame: the instance matrix carries the head.
//
// StormCommon.glsl and StormVertex.glsl are prepended.

attribute vec4 aVel;  // xyz: velocity (m/s); w: kind (0 rain, 1 mist glint, 2 hail trail)
attribute vec4 aLook; // x: width (m); y: length (m); z: brightness; w: phase

uniform float uTime;
uniform float uLightning;

varying vec2 vUv;
varying float vAlpha;
varying float vKind;

void main() {
  vec3 head = instanceMatrix[3].xyz;
  float speed = length(aVel.xyz);
  vec3 dir = speed > 1e-3 ? aVel.xyz / speed : vec3(0.0, -1.0, 0.0);
  float kind = aVel.w;
  // Never narrower than this many pixels: room for a crisp core inside a soft halo, so the threats
  // hold up at any distance and resolution. Unlike the cosmetic rain they do not fade when thin.
  float minPx = kind < 0.5 ? 4.5 : (kind < 1.5 ? 3.5 : 3.0);
  float cover;
  gl_Position = stormStreak(head, head - dir * aLook.y, aLook.x, minPx, position.xy, cover);
  // Mist glints twinkle as the droplets tumble.
  float twinkle = kind > 0.5 && kind < 1.5 ? 0.55 + 0.45 * sin(uTime * 9.0 + aLook.w * 6.283) : 1.0;
  vAlpha = aLook.z * twinkle * stormFogFade(gl_Position.w) * (1.0 + uLightning * 2.5);
  vUv = position.xy;
  vKind = kind;
}
