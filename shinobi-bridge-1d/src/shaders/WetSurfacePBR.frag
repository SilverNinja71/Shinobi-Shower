// Wet-surface extension for three's MeshStandardMaterial, spliced in by makeWetMaterial (src/render/Assets.ts).
// Each "// @@name" section is inserted at one point of the standard shader:
//   @@common     after #include <common>              (uniforms, varyings, helpers)
//   @@albedo     after #include <map_fragment>        (triplanar albedo, darkening of soaked surfaces)
//   @@roughness  after #include <roughnessmap_fragment> (gloss of the water film, puddles, rivulets)
//   @@normal     after #include <normal_fragment_maps>  (triplanar normals, rain ripples in puddles)
// World position and normal come from the vertex patch in Assets.ts.

// @@common
uniform float uWetness;
uniform float uWetLocal;
uniform float uTime;
uniform float uRain;
varying vec3 vWetPos;
varying vec3 vWetNormal;
#ifdef WET_TRIPLANAR
uniform sampler2D uTriMap;
uniform sampler2D uTriNormal;
uniform sampler2D uTriRough;
uniform sampler2D uTriAO;
uniform float uTriScale;
uniform vec3 uTriTint;
#endif

float wetHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float wetNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wetHash(i), wetHash(i + vec2(1.0, 0.0)), u.x), mix(wetHash(i + vec2(0.0, 1.0)), wetHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float wetFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * wetNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

// Rain ripples: rings expanding from points in a grid of cells, each cell on its own clock.
// Returns the slope of the water surface (d/dx, d/dz).
vec2 wetRipples(vec2 p, float t) {
  vec2 grad = vec2(0.0);
  for (int layer = 0; layer < 2; layer++) {
    vec2 q = p * (layer == 0 ? 3.0 : 4.7) + float(layer) * 17.0;
    vec2 cell = floor(q);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float h = wetHash(c);
        vec2 centre = c + vec2(wetHash(c + 3.1), wetHash(c + 7.7));
        float phase = fract(t * (0.9 + h * 0.5) + h);
        vec2 d = q - centre;
        float r = length(d);
        float ring = r - phase * 1.2;
        float wave = sin(ring * 30.0) * exp(-ring * ring * 60.0) * (1.0 - phase);
        grad += (r > 1e-4 ? d / r : vec2(0.0)) * wave;
      }
    }
  }
  return grad * 0.5;
}

#ifdef WET_TRIPLANAR
vec3 triWeights(vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  return w / (w.x + w.y + w.z);
}

vec4 triSample(sampler2D tex, vec3 p, vec3 w) {
  return texture2D(tex, p.zy) * w.x + texture2D(tex, p.xz) * w.y + texture2D(tex, p.xy) * w.z;
}

// Whiteout-blended triplanar normal mapping; the result is a world-space normal.
vec3 triNormal(vec3 p, vec3 n, vec3 w) {
  vec3 tx = texture2D(uTriNormal, p.zy).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(uTriNormal, p.xz).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(uTriNormal, p.xy).xyz * 2.0 - 1.0;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
#endif

// @@albedo
vec3 wetN = normalize(vWetNormal);
#ifdef WET_TRIPLANAR
  vec3 triP = vWetPos * uTriScale;
  vec3 triW = triWeights(wetN);
  diffuseColor.rgb *= triSample(uTriMap, triP, triW).rgb * uTriTint;
  diffuseColor.rgb *= mix(1.0, triSample(uTriAO, triP, triW).r, 0.7);
#endif
float wet = clamp(uWetness * uWetLocal, 0.0, 1.0);
float wetUp = smoothstep(0.55, 0.95, wetN.y);
// Standing water gathers in low spots on upward faces.
float puddle = wet * wetUp * smoothstep(0.5, 0.72, wetFbm(vWetPos.xz * 0.9 + 3.0));
// Water runs down steep faces in streaks that crawl downward.
float rivulet = wet * (1.0 - abs(wetN.y)) * smoothstep(0.58, 0.86, wetNoise(vec2((vWetPos.x + vWetPos.z) * 6.0, vWetPos.y * 0.35 + uTime * 0.6)));
// Soaked porous surfaces darken; standing water darkens more.
diffuseColor.rgb *= mix(1.0, 0.55, wet) * mix(1.0, 0.72, puddle);

// @@roughness
#ifdef WET_TRIPLANAR
  roughnessFactor *= triSample(uTriRough, triP, triW).g;
#endif
roughnessFactor = mix(roughnessFactor, 0.24, wet * 0.75);
roughnessFactor = mix(roughnessFactor, 0.04, max(puddle, rivulet * 0.8));

// @@normal
#ifdef WET_TRIPLANAR
  normal = normalize((viewMatrix * vec4(triNormal(triP, wetN, triW), 0.0)).xyz);
#endif
if (puddle > 0.01 && uRain > 0.01) {
  vec2 rip = wetRipples(vWetPos.xz, uTime) * puddle * uRain;
  normal = normalize(normal + (viewMatrix * vec4(rip.x, 0.0, rip.y, 0.0)).xyz * 0.6);
}
