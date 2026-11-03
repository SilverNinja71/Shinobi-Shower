// Lit VFX debris (DebrisPool.ts), spliced into three's MeshStandardMaterial. Each "// @@name" section
// goes in at one point of the standard shader:
//   @@vertex-common    after #include <common> (vertex): the shape variants and per-piece surface
//   @@vertex-normal    replaces #include <beginnormal_vertex>: this piece's variant normal
//   @@vertex-position  replaces #include <begin_vertex>: its variant shape
//   @@fragment-common  after #include <common> (fragment)
//   @@fragment-rough   replaces #include <roughnessmap_fragment>: per-piece roughness
//   @@fragment-final   before #include <opaque_fragment>: icy rim, the cut face of a split hailstone, heat
// One draw holds every piece: the geometry carries each shape as its own attributes, aDebris.x
// (per instance) chooses, aDebris.y is the roughness, aDebris.z how icy it is, aDebris.w a glow.
// With HAIL_HALF the mesh is half a hailstone and aCut marks the faces of the clean cut through it.

// @@vertex-common
#ifdef HAIL_HALF
attribute float aCut;
varying float vCut;
#else
attribute vec3 position1;
attribute vec3 position2;
attribute vec3 position3;
attribute vec3 normal1;
attribute vec3 normal2;
attribute vec3 normal3;
#endif
attribute vec4 aDebris;
varying vec4 vDebris;
varying vec3 vPiecePos;

// @@vertex-normal
#ifdef HAIL_HALF
vec3 objectNormal = normal;
#else
vec3 objectNormal = aDebris.x < 0.5 ? normal : aDebris.x < 1.5 ? normal1 : aDebris.x < 2.5 ? normal2 : normal3;
#endif
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif

// @@vertex-position
#ifdef HAIL_HALF
vec3 transformed = position;
vCut = aCut;
#else
vec3 transformed = aDebris.x < 0.5 ? position : aDebris.x < 1.5 ? position1 : aDebris.x < 2.5 ? position2 : position3;
#endif
vDebris = aDebris;
vPiecePos = transformed;

// @@fragment-common
uniform float uLightning;
varying vec4 vDebris;
varying vec3 vPiecePos;
#ifdef HAIL_HALF
varying float vCut;
#endif

float debrisHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// @@fragment-rough
float roughnessFactor = vDebris.y;
#ifdef HAIL_HALF
// The cut face is frosted where the blade crazed it.
roughnessFactor = mix(roughnessFactor, 0.55, vCut);
#endif

// @@fragment-final
{
  vec3 viewDir = normalize(vViewPosition);
  float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, 3.0);
  float flash = 1.0 + 3.0 * uLightning;
  // Ice: a cold rim where the backlight comes through the thin edges, and a faint glow inside.
  vec3 ice = vec3(0.32, 0.5, 0.78) * fresnel * 0.9 + vec3(0.03, 0.06, 0.1) * (1.0 - fresnel);
  outgoingLight += ice * vDebris.z * flash;
#ifdef HAIL_HALF
  // The clean cut through the stone: milky growth rings round a cloudy core, lit up by the stroke.
  float r = length(vPiecePos.xz);
  float rings = 0.5 + 0.5 * sin(r * 26.0 + debrisHash(floor(vPiecePos * 9.0)) * 1.5);
  vec3 cut = vec3(0.16, 0.22, 0.3) * (0.55 + 0.45 * rings) * (1.2 - r) * flash;
  outgoingLight = mix(outgoingLight, outgoingLight * 0.5 + cut, vCut);
  // Just after the stroke the cut face burns white, and the edge of the stone flashes with it.
  outgoingLight += vec3(0.75, 0.88, 1.0) * vDebris.w * (vCut * 4.0 + fresnel * 1.5);
#else
  // Heat or a flash carried by the piece.
  outgoingLight += diffuseColor.rgb * vDebris.w * 6.0;
#endif
}
