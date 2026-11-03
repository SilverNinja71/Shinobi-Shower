// Rope deformation for the bridge's ropes (see Ropes.ts), spliced into three's standard and depth shaders.
// The geometry is built once, straight; every vertex carries which rope it belongs to and where along it
// (aRope). Each frame the rope's centreline is rebuilt here from the deck samples (DeckSampler), so the
// ropes sag, sway, swing and roll with the bridge without touching a single buffer on the CPU.
//
// aRope = (path, s, suspender lane x, flutter). Paths: 0/1 hand rope front/back, 2/3 deck-edge rope
// front/back (s = lane x), 4/5 suspender front/back (s = 0 at the deck edge to 1 at the hand rope).
//
// With ROPE_RIBBON (the ropes themselves) a vertex is (radius, side −1..1, 0): a strip across the rope,
// turned to face whoever renders it (the camera, or the moon for the shadow), shaded with the normals of
// a round rope. Ropes a few pixels thick then cost two triangles per segment instead of a tube's ten.
// Without it (the frayed fibre cards) position and normal are offsets in the rope's moving frame.

// @@common
attribute vec4 aRope;
uniform float uTime;
uniform float uWind;
#ifdef ROPE_RIBBON
  varying float vRopeSide;
  varying vec3 vRopeAcross;
#endif

float ropeHash(float k) {
  return fract(sin(k * 12.9898 + 4.1) * 43758.5453);
}

// Between two suspenders a hand rope hangs in a shallow dip, deeper on some spans than others.
// Returns the dip (x) and its slope along the lane (y).
vec2 handSag(float x) {
  float k = floor(x / SUSPENDER_STEP);
  float t = clamp(x / SUSPENDER_STEP - k, 0.0, 1.0);
  float a = mix(HAND_SAG_MIN, HAND_SAG_MAX, ropeHash(k));
  return vec2(a * 4.0 * t * (1.0 - t), a * 4.0 * (1.0 - 2.0 * t) / SUSPENDER_STEP);
}

// Near the anchors the ropes splay out to the posts they are tied to.
float splayZ(float x, float z) {
  return mix(TIE_Z, z, smoothstep(0.0, SPLAY, min(x, LANE_LENGTH - x)));
}

// Centre and moving frame (tangent, normal, binormal) of the rope at this vertex, from a single deck
// sample: along a rope the tangent follows from the deck's slope and the rope's own dip and splay (the
// slow change of roll and swing along the lane is too small to see).
void ropeFrame(out vec3 c, out vec3 t, out vec3 n, out vec3 b) {
  float id = aRope.x;
  float side = mod(id, 2.0) < 0.5 ? 1.0 : -1.0;
  vec3 ref = vec3(0.0, 1.0, 0.0);
  if (id < 3.5) {
    float x = aRope.y;
    vec4 d = deckAt(x);
    vec2 sag = id < 1.5 ? handSag(x) : vec2(0.0);
    float base = id < 1.5 ? HAND_HEIGHT : EDGE_Y;
    float z0 = id < 1.5 ? HAND_Z : EDGE_Z;
    float h = base - sag.x;
    float z = side * splayZ(x, z0);
    float dz = side * (splayZ(x + 0.02, z0) - splayZ(x - 0.02, z0)) / 0.04;
    c = deckPoint(d, x, h, z);
    float cr = cos(d.z);
    float sr = sin(d.z);
    t = normalize(vec3(1.0, d.w - sag.y * cr - dz * sr, -sag.y * sr + dz * cr));
  } else {
    vec4 d = deckAt(aRope.z);
    vec3 bottom = deckPoint(d, aRope.z, EDGE_Y, side * SUSPENDER_Z_BOTTOM);
    vec3 top = deckPoint(d, aRope.z, HAND_HEIGHT, side * HAND_Z);
    c = mix(bottom, top, aRope.y);
    t = normalize(top - bottom);
    ref = vec3(1.0, 0.0, 0.0);
  }
  n = normalize(ref - dot(ref, t) * t);
  b = cross(t, n);
}

// The ribbon's edge `side` (−1..1) of a rope of this radius, the strip turned square to the viewer.
// `across` is the strip's sideways direction and `facing` the rope's surface normal at its middle.
vec3 ropeRibbon(vec3 c, vec3 t, vec3 n, float radius, float side, out vec3 across, out vec3 facing) {
  vec3 toViewer = normalize(cameraPosition - c);
  across = cross(t, toViewer);
  float l = length(across);
  across = l > 1e-4 ? across / l : n;
  facing = cross(across, t);
  return c + across * radius * side;
}

// Loose fibres stir in the wind.
vec3 ropeFlutter() {
  float ph = aRope.y * 7.3 + aRope.z * 3.1 + position.x * 40.0;
  return aRope.w * vec3(
    uWind * 0.0015 + sin(uTime * 9.0 + ph) * 0.006,
    sin(uTime * 7.1 + ph * 1.3) * 0.004,
    cos(uTime * 8.3 + ph * 0.7) * 0.006
  );
}

// @@normal-vertex
vec3 rc, rt, rn, rb;
ropeFrame(rc, rt, rn, rb);
#ifdef ROPE_RIBBON
  vec3 ropeAcross, ropeFacing;
  vec3 ropePos = ropeRibbon(rc, rt, rn, position.x, position.y, ropeAcross, ropeFacing);
  objectNormal = ropeFacing;
  vRopeSide = position.y;
  vRopeAcross = normalize(normalMatrix * ropeAcross);
#else
  vec3 ropePos = rc + rt * position.x + rn * position.y + rb * position.z + ropeFlutter();
  objectNormal = normalize(rt * normal.x + rn * normal.y + rb * normal.z);
#endif

// @@position
transformed = ropePos;

// @@depth-position
vec3 rc, rt, rn, rb;
ropeFrame(rc, rt, rn, rb);
#ifdef ROPE_RIBBON
  vec3 ropeAcross, ropeFacing;
  transformed = ropeRibbon(rc, rt, rn, position.x, position.y, ropeAcross, ropeFacing);
#else
  transformed = rc + rt * position.x + rn * position.y + rb * position.z;
#endif

// @@fragment-common
varying float vRopeSide;
varying vec3 vRopeAcross;

// @@fragment-normal
// Round the flat strip: across it the normal turns from facing the viewer to facing sideways, as on a
// tube, so light, wetness and reflections wrap the rope.
{
  float side = clamp(vRopeSide, -1.0, 1.0);
  vec3 toward = normalize(vViewPosition);
  vec3 across = normalize(vRopeAcross - toward * dot(vRopeAcross, toward));
  normal = normalize(across * side + toward * sqrt(max(0.0, 1.0 - side * side)));
}
