// Storm sky dome. The dome is centred on the camera, so a vertex's local position is its view
// direction. It is pinned to the far plane, so it is drawn only where nothing else has been.
varying vec3 vDir;

void main() {
  vDir = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}
