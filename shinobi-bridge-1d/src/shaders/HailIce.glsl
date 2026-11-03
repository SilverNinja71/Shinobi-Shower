// Hailstones (see HailStones.ts), spliced into three's MeshPhysicalMaterial. Each "// @@name" section
// goes in at one point of the physical shader:
//   @@vertex-common    after #include <common> (vertex): the variant attributes
//   @@vertex-normal    replaces #include <beginnormal_vertex>: picks this stone's variant normal
//   @@vertex-position  replaces #include <begin_vertex>: picks its variant shape
//   @@fragment-common  after #include <common> (fragment): uniforms and noise
//   @@fragment-ice     before #include <opaque_fragment>: the icy look
// All the variants share one instanced draw: the geometry carries each shape as its own attributes
// and aIce.x (per instance) chooses; aIce.y seeds the stone's inner pattern.
//
// Ice is translucent, but a transmission pass would redraw the whole scene, so the look is faked:
// light scattered inside the stone glows faintly through milky growth shells and white fracture veins,
// the thin silhouette lets the backlight through as a cold rim, and the clearcoat catches the glints.

// @@vertex-common
attribute vec3 position1;
attribute vec3 position2;
attribute vec3 normal1;
attribute vec3 normal2;
attribute vec2 aIce;
varying vec3 vIcePos;
varying float vIceSeed;

// @@vertex-normal
vec3 objectNormal = aIce.x < 0.5 ? normal : (aIce.x < 1.5 ? normal1 : normal2);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif

// @@vertex-position
vec3 transformed = aIce.x < 0.5 ? position : (aIce.x < 1.5 ? position1 : position2);
vIcePos = transformed;
vIceSeed = aIce.y;

// @@fragment-common
uniform float uLightning;
uniform vec3 uIceDeep;
uniform vec3 uIceRim;
varying vec3 vIcePos;
varying float vIceSeed;

float iceHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float iceNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(iceHash(i), iceHash(i + vec3(1, 0, 0)), f.x), mix(iceHash(i + vec3(0, 1, 0)), iceHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(iceHash(i + vec3(0, 0, 1)), iceHash(i + vec3(1, 0, 1)), f.x), mix(iceHash(i + vec3(0, 1, 1)), iceHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// @@fragment-ice
{
  vec3 iceView = normalize(vViewPosition);
  float iceFacing = clamp(dot(normal, iceView), 0.0, 1.0);
  float iceFresnel = pow(1.0 - iceFacing, 2.5);
  vec3 iceP = vIcePos + vIceSeed * 13.7;
  // A milky core: hail freezes in layers, clear outside, cloudy at the heart where it began.
  float iceCore = smoothstep(0.95, 0.35, length(vIcePos));
  float iceShell = 0.5 + 0.5 * sin(length(vIcePos) * 14.0 + iceNoise(iceP * 2.3) * 6.0);
  // Fine fractures: thin bright sheets where the noise crosses its middle.
  float iceVein = 1.0 - smoothstep(0.0, 0.05, abs(iceNoise(iceP * 3.6 + 11.0) - 0.5));
  float iceFlash = 1.0 + uLightning * 3.5;
  // Light scattered through the body, seen most where the eye looks straight in.
  vec3 iceInner = uIceDeep * (0.3 + 0.7 * iceCore * (0.8 + 0.2 * iceShell) + iceVein * 0.25) * (1.0 - 0.7 * iceFresnel);
  outgoingLight += (iceInner + uIceRim * iceFresnel) * iceFlash;
}
