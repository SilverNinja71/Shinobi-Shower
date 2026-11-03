// The lens pass's soft copy of the frame, which the condensation veil and the water beads show.
//   DOWNSAMPLE: four bilinear taps that average the 4x4 block under each quarter-resolution pixel.
//   otherwise:  one direction of a separable Gaussian, nine taps folded into five bilinear fetches.
uniform sampler2D tInput;
/** 1 / size of tInput. */
uniform vec2 uTexel;
/** Blur direction times tap spacing, in texels of tInput. */
uniform vec2 uDirection;
varying vec2 vUv;

void main() {
#ifdef DOWNSAMPLE
  vec3 c = texture2D(tInput, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tInput, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tInput, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tInput, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
#else
  vec2 step1 = uDirection * uTexel * 1.3846153846;
  vec2 step2 = uDirection * uTexel * 3.2307692308;
  vec3 c = texture2D(tInput, vUv).rgb * 0.2270270270;
  c += (texture2D(tInput, vUv + step1).rgb + texture2D(tInput, vUv - step1).rgb) * 0.3162162162;
  c += (texture2D(tInput, vUv + step2).rgb + texture2D(tInput, vUv - step2).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
#endif
}
