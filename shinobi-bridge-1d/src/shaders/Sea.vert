// Storm sea. Drawn on a dome centred on the camera, like the sky: the water plane itself is found per
// pixel by intersecting the view ray with y = uSeaLevel, so it runs all the way to the true horizon
// regardless of the camera's far plane.
varying vec3 vDir;

void main() {
  vDir = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}
