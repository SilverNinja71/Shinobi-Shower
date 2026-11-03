// Marks and small effects (see StormMarks.vert). Output is premultiplied: colour adds light, alpha
// darkens what is behind, so a hail mark can both cast its shadow and glow.
// Types (StormMarks.ts keeps the same numbers):
//   0 hail mark on the deck   1 hail warning wall   2 sweet-spot box
//   3 ripple ring             4 rain crown          5 snow puff

uniform float uTime;
uniform float uLightning;
uniform vec3 uWarn;
uniform vec3 uSweet;
uniform vec3 uWater;
uniform vec3 uSnowLit;

varying vec2 vQ;      // −1..1 across the quad
varying vec4 vParams; // x: type; y: progress; z: intensity; w: extra
varying float vFade;

// How fast a warning pulses: lazily while the stone is high, frantically just before it lands.
float warnPulse(float k) {
  return 0.72 + 0.28 * sin(uTime * mix(6.0, 20.0, k * k));
}

// A hailstone's mark on the deck: the stone's shadow deepening under it, and a warning ring closing
// from the edge of the mark onto the stone's footprint (0.42 of the mark) as it falls.
// k runs from 0 when the stone appears to 1 at impact.
vec4 hailMark(vec2 q, float k, float power) {
  float r = length(q);
  float shadow = (1.0 - smoothstep(0.12, 0.5, r)) * mix(0.35, 0.9, k);
  float d = r - mix(0.96, 0.42, k);
  float ring = exp(-d * d * 500.0) + 0.4 * exp(-d * d * 40.0);
  float foot = exp(-(r - 0.42) * (r - 0.42) * 900.0) * 0.5 * k;
  // The ring heats from a dull ember to a white-hot edge as impact nears.
  vec3 hot = mix(uWarn, vec3(1.6, 1.0, 0.6) * length(uWarn) * 0.7, k * k * 0.6);
  vec3 light = hot * (ring * warnPulse(k) + foot) * mix(0.35, 2.6, k * k);
  return vec4(light, shadow) * power;
}

// The same ring seen from the side, where the low camera flattens the mark to a sliver: two short
// posts of warning light rise at its edges, over a glow hugging the deck, and close in with the ring.
// q.y runs from −1 at the deck to 1 at the top of the posts.
vec4 hailWall(vec2 q, float k, float power) {
  float x = abs(q.x);
  float h = q.y * 0.5 + 0.5;
  float posts = exp(-(1.0 - x) * (1.0 - x) * 260.0) * (1.0 - h) * (1.0 - h);
  float ground = exp(-h * h * 90.0) * (0.35 + 0.65 * x * x);
  float light = (posts + ground * 0.7) * warnPulse(k) * mix(0.15, 1.8, k * k);
  return vec4(uWarn * light * power, 0.0);
}

// Where a cut breaks hail: a faint frame with brighter corner brackets that warms and brightens when a
// stone is lined up over it, with a soft glow along the cutting band. aspect is height over width.
vec4 sweetBox(vec2 q, float aligned, float power, float aspect) {
  float ex = 1.0 - abs(q.x);
  float ey = (1.0 - abs(q.y)) * aspect;
  float frame = max(exp(-ex * ex * 500.0), exp(-ey * ey * 500.0));
  float corner = step(ex, 0.5) * step(ey, 0.5);
  float inner = exp(-min(ex, ey) * 10.0) * 0.08 * aligned;
  float glow = frame * mix(0.22, 1.0, corner) * mix(0.55, 1.6, aligned) + inner;
  vec3 col = mix(uSweet, vec3(1.0, 0.9, 0.7) * 1.5, aligned);
  return vec4(col * glow * power, 0.0);
}

// A ring spreading on the wet planks, catching the sky. t runs 0–1 over its life.
vec4 ripple(vec2 q, float t, float power) {
  float r = length(q);
  float d = r - (0.12 + 0.88 * t);
  float fade = (1.0 - t) * (1.0 - t);
  float ring = exp(-d * d * 220.0) * fade;
  float d2 = r - 0.6 * (0.12 + 0.88 * t);
  ring += exp(-d2 * d2 * 400.0) * fade * 0.4 * smoothstep(0.15, 0.4, t);
  return vec4(uWater * ring * power, 0.0);
}

// A crown of droplets thrown up where a raindrop hits, arcing out and falling back. q.y runs from −1 at
// the surface to 1 at the top of the quad.
vec4 crown(vec2 q, float t, float power, float seed) {
  float light = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float side = (fi + 0.5) / 3.0 - 1.0;
    float jitter = fract(sin((fi + 1.0) * 12.9898 + seed * 78.233) * 43758.5453);
    vec2 v = vec2(side * (0.55 + 0.4 * jitter), 1.9 - 0.9 * abs(side) + 0.6 * jitter);
    vec2 p = vec2(v.x * t * 1.7, -1.0 + v.y * t * 1.7 - 3.4 * t * t);
    float rad = mix(0.1, 0.05, t);
    vec2 dp = q - p;
    light += exp(-dot(dp, dp) / (rad * rad)) * (0.6 + 0.4 * jitter);
  }
  // The splash sheet itself, in the first instant.
  float sheet = exp(-(q.y + 0.9) * (q.y + 0.9) * 12.0) * exp(-q.x * q.x * 3.0) * (1.0 - smoothstep(0.0, 0.3, t));
  return vec4(uWater * (light * (1.0 - 0.8 * t) + sheet) * 0.8 * power, 0.0);
}

// Snow landing: a small soft puff that spreads, drifts up a little and settles.
vec4 puff(vec2 q, float t, float power, float seed) {
  vec2 c = vec2(sin(seed * 6.283) * 0.1 * t, -0.55 + 0.35 * t);
  float r = length((q - c) * vec2(1.0, 1.35));
  float size = 0.3 + 0.6 * t;
  float a = (1.0 - smoothstep(size * 0.25, size, r)) * (1.0 - t) * (1.0 - t) * 0.75;
  return vec4(uSnowLit * a, a * 0.55) * power;
}

void main() {
  float type = vParams.x;
  float flash = 1.0 + uLightning * 2.5;
  vec4 c;
  if (type < 0.5) c = hailMark(vQ, vParams.y, vParams.z);
  else if (type < 1.5) c = hailWall(vQ, vParams.y, vParams.z);
  else if (type < 2.5) c = sweetBox(vQ, vParams.y, vParams.z, vParams.w);
  else if (type < 3.5) c = ripple(vQ, vParams.y, vParams.z) * vec4(vec3(flash), 1.0);
  else if (type < 4.5) c = crown(vQ, vParams.y, vParams.z, vParams.w) * vec4(vec3(flash), 1.0);
  else c = puff(vQ, vParams.y, vParams.z, vParams.w) * vec4(vec3(flash), 1.0);
  gl_FragColor = c * vFade;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
