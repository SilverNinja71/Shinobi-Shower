// Gameplay snowflakes (see DropFlakes.ts): soft camera-facing tufts placed from the simulation each
// frame, wider than tall like the flake's hit box (1.5 r by 0.8 r), so what you see is what hits.
//
// StormCommon.glsl and StormVertex.glsl are prepended.

attribute vec4 aPos;  // xyz: centre; w: radius (m)
attribute vec4 aLook; // x: spin; y: brightness; z: seed

uniform float uLightning;

varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

void main() {
  float cover;
  gl_Position = stormSprite(aPos.xyz, vec2(3.4, 2.2) * aPos.w, aLook.x, 4.0, position.xy, cover);
  vUv = position.xy;
  vSeed = aLook.z;
  vAlpha = aLook.y * min(1.0, cover * 1.5) * stormFogFade(gl_Position.w) * (1.0 + uLightning * 2.0);
}
