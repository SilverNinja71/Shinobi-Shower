// The focus cut's streak (FocusStreak.ts): a world-space quad laid across the whole view.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
