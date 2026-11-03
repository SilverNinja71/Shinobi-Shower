// Lays the soft effects layer over the rendered world (see SceneRenderPass.ts). The layer holds
// premultiplied colour with coverage in alpha, so additive sparks (alpha 0) and smoke (alpha > 0)
// share one blend. Everything stays linear HDR for bloom and the lens.
uniform sampler2D tScene;
uniform sampler2D tSoft;
uniform float uSoft;
varying vec2 vUv;

void main() {
  vec3 color = texture2D(tScene, vUv).rgb;
  if (uSoft > 0.5) {
    vec4 soft = texture2D(tSoft, vUv);
    color = color * (1.0 - soft.a) + soft.rgb;
  }
  gl_FragColor = vec4(color, 1.0);
}
