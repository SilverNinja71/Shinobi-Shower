// Full-screen triangle for the post passes (three's FullScreenQuad): hands the UV to the fragment shader.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
