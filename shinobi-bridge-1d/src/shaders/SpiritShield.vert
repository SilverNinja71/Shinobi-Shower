// Spirit shield bubble around the warrior: an ellipsoid shell. Passes the view-space normal and view
// vector for the fresnel, and the object-space position for the honeycomb.

uniform float uSwell;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;

#include <common>
#include <fog_pars_vertex>

void main() {
  vLocal = position;
  vec3 p = position * uSwell;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
