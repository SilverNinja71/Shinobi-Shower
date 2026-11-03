// Camera-facing ribbon (see RibbonStrip.ts). Positions arrive in world space, already spread across
// the line; aStrip = (along 0 → 1, across 0 / 1, line seed, half width). Shared by the spirit
// ribbons, the spirit blade's mist sheath and the crimson lightning.

attribute vec4 aStrip;
varying vec4 vStrip;

#include <common>
#include <fog_pars_vertex>

void main() {
  vStrip = aStrip;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
