// Gameplay streaks (see StormStreak.vert). Each kind has its own profile: rain is a hard bright core
// with a bead of light at its head, so the eye reads the drop and its direction at once; a mist glint is
// a short spark; a hail trail is a soft, cold smear that fades upward behind the stone.

uniform vec3 uRainColor;
uniform vec3 uGlintColor;
uniform vec3 uTrailColor;

varying vec2 vUv; // x: −1..1 across; y: 0 at the head, 1 at the tail
varying float vAlpha;
varying float vKind;

void main() {
  float x = vUv.x;
  float y = vUv.y;
  vec3 light;
  if (vKind < 0.5) {
    // Pure radiant white blade-target rain: completely white core and blazing head bead, no colored tint
    float core = exp(-x * x * 20.0);
    float halo = exp(-x * x * 3.5) * 0.4;
    float along = smoothstep(0.0, 0.04, y) * (1.0 - smoothstep(0.35, 1.0, y)) * (1.0 - 0.4 * y);
    float bead = exp(-y * y * 180.0) * exp(-x * x * 6.0);
    light = uRainColor * (core * along * 3.5 + bead * 4.8 + halo * along * 1.2);
  } else if (vKind < 1.5) {
    float spark = exp(-x * x * 8.0) * (1.0 - smoothstep(0.0, 1.0, y)) * smoothstep(-0.05, 0.15, y);
    light = uGlintColor * (spark * 3.2 + exp(-x * x * 2.0) * 0.4 * (1.0 - y));
  } else {
    float smear = (1.0 - x * x) * smoothstep(0.0, 0.2, y) * (1.0 - y) * (1.0 - y);
    light = uTrailColor * smear;
  }
  gl_FragColor = vec4(light * vAlpha, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
