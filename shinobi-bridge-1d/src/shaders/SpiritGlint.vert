// A star glint billboarded at its object's origin (an eye, the chest), pulled a little toward the
// camera so the face it sits on never hides it.

uniform float uSize;
varying vec2 vQuad;

#include <common>
#include <fog_pars_vertex>

void main() {
  vQuad = position.xy * 2.0;
  vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.z += 0.12;
  mvPosition.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
