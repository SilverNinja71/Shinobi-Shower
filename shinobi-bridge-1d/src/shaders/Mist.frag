// A mist bank (see Mist.vert): tiling noise, two octaves packed in one texel (MistBanks.ts), shaped by
// a soft falloff into a ragged, feathered band. Moonlit mist glows faintly and veils a little of what
// is behind it; lightning floods it.

uniform sampler2D uNoise;
uniform vec3 uColor;
uniform float uLightning;

varying vec2 vUv;
varying float vAlpha;
varying vec2 vScroll;

void main() {
  vec2 q = vUv * 2.0 - 1.0;
  // Feathered on every side, softest top and bottom.
  float falloff = (1.0 - q.x * q.x) * (1.0 - smoothstep(0.1, 1.0, abs(q.y)));
  vec2 n = texture2D(uNoise, vUv * vec2(1.2, 0.5) + vScroll).rg;
  float density = smoothstep(0.18, 1.0, n.r * 0.75 + n.g * 0.4) * falloff;
  float a = density * vAlpha;
  // Much of each sprite is thin air between wisps: skip blending it.
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * (1.0 + uLightning * 4.0) * a, a * 0.45);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
