// Snowflakes (Snowflake.vert for the cosmetic fall, SnowflakeSprite.vert for gameplay flakes, which
// define FLUFFY). Snow is lit, not glowing: the flake adds its moonlit white and hides part of what is
// behind it (uOpacity), so gameplay flakes read as solid tufts against the night.

uniform vec3 uColor;
uniform float uOpacity;

varying vec2 vUv; // −1..1 across the sprite
varying float vAlpha;
varying float vSeed;

void main() {
  float r = length(vUv);
#ifdef FLUFFY
  // A wet clot of flakes: a dense core inside a ragged, feathered edge, different for every flake.
  float a = atan(vUv.y, vUv.x);
  float s = vSeed * 6.283;
  float edge = 0.66 + 0.1 * sin(3.0 * a + s) + 0.07 * sin(5.0 * a + s * 2.3) + 0.05 * sin(9.0 * a + s * 4.1);
  float shape = 1.0 - smoothstep(edge * 0.2, edge, r);
  shape *= shape;
  float heart = exp(-r * r * 7.0) * 0.45;
#else
  float shape = 1.0 - smoothstep(0.1, 1.0, r);
  shape *= shape;
  float heart = 0.0;
#endif
  float alpha = shape * vAlpha;
  // The soft corners of each sprite add nothing visible: skip their blending.
  if (alpha + heart * vAlpha < 0.004) discard;
  gl_FragColor = vec4(uColor * (alpha + heart * vAlpha), alpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
