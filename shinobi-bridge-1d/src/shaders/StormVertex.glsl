// Vertex helpers for the storm's particles: StormMaterial.ts prepends it (after StormCommon.glsl) to
// every storm vertex shader. Quads are built on screen, so thin things stay at least a pixel or two
// wide and fade by how much of that pixel they really cover instead of shimmering in and out.

uniform vec2 uViewport; // drawing-buffer size in pixels

// GPU-animated fields draw their particles in instanced batches of STORM_BATCH quads (software
// renderers pay per instance): position.z is a quad's place in its batch, aBatch the batch number.
attribute float aBatch;

float stormParticleId() {
  return aBatch * STORM_BATCH + position.z;
}

// Four well-spread values in [0, 1) from a particle id ("hash without sine", Dave Hoskins).
vec4 stormHash4(float p) {
  vec4 p4 = fract(vec4(p) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// True when a streak between clip positions a and b lies wholly outside the view (with a margin), so
// a field can drop it before the costlier work.
bool stormOffscreen(vec4 a, vec4 b) {
  if (a.w < 0.2 || b.w < 0.2) return true;
  vec4 lo = min(a / a.w, b / b.w);
  vec4 hi = max(a / a.w, b / b.w);
  return lo.x > 1.05 || hi.x < -1.05 || lo.y > 1.05 || hi.y < -1.05;
}

// One corner of a streak from head `a` back to tail `b` (clip space), `width` metres across.
// corner.x runs across the streak in half-widths (±1 for a quad; ±2 at the head and 0 at the tail for
// a tapering triangle); corner.y is 0 at the head and 1 at the tail.
// `cover` receives the fraction of the drawn width the streak really fills.
vec4 stormStreakClip(vec4 a, vec4 b, float width, float minPx, vec2 corner, out float cover) {
  cover = 0.0;
  if (a.w < 0.2 || b.w < 0.2) return vec4(0.0, 0.0, 2.0, 1.0);
  vec2 halfPx = 0.5 * uViewport;
  vec2 d = b.xy / b.w * halfPx - a.xy / a.w * halfPx;
  float len = length(d);
  vec2 along = len > 1e-3 ? d / len : vec2(0.0, -1.0);
  vec2 across = vec2(-along.y, along.x);
  vec4 c = mix(a, b, corner.y);
  float px = width * projectionMatrix[1][1] * halfPx.y / c.w;
  float drawn = max(px, minPx);
  cover = px / drawn;
  // Half a width of cap past each end keeps short streaks round instead of square.
  vec2 offset = across * corner.x * drawn * 0.5 + along * (corner.y * 2.0 - 1.0) * drawn * 0.5;
  c.xy += offset / halfPx * c.w;
  return c;
}

// The same from world-space head and tail.
vec4 stormStreak(vec3 head, vec3 tail, float width, float minPx, vec2 corner, out float cover) {
  mat4 viewProj = projectionMatrix * viewMatrix;
  return stormStreakClip(viewProj * vec4(head, 1.0), viewProj * vec4(tail, 1.0), width, minPx, corner, cover);
}

// One corner of a camera-facing quad `size` metres across (x by y), turned by `spin` radians.
// corner is −1..1 on both axes. Sprites smaller than minPx are drawn at minPx and `cover` receives the
// fraction of that area they really fill.
vec4 stormSprite(vec3 centre, vec2 size, float spin, float minPx, vec2 corner, out float cover) {
  vec4 mv = viewMatrix * vec4(centre, 1.0);
  float depth = max(-mv.z, 1e-3);
  float px = max(size.x, size.y) * projectionMatrix[1][1] * 0.5 * uViewport.y / depth;
  float drawn = max(px, minPx);
  float grow = drawn / max(px, 1e-5);
  cover = 1.0 / (grow * grow);
  vec2 off = corner * size * 0.5 * grow;
  float c = cos(spin);
  float s = sin(spin);
  mv.xy += vec2(off.x * c - off.y * s, off.x * s + off.y * c);
  return projectionMatrix * mv;
}
