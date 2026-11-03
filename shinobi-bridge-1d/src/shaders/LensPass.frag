// The camera's lens, after bloom and before tone mapping (OutputPass), on the linear HDR frame.
//   - Condensation (uFog, from the mist): a milky veil that softens, lifts and greys the picture, with
//     halos round the lights. It starts at the rim of the glass, spreads inward and drifts, and is wiped
//     clear in streaks where drops have run down through it.
//   - Water on the glass in heavy rain (uDrops): beads that each show a small inverted view of the
//     scene, and bigger drops that run down in fits and starts, leaving wet trails and strings of beads.
//   - Chromatic aberration toward the edges, a vignette and film grain.
//   - Lightning's exposure punch, a red pulse at the edges when the warrior is hit (heavier for hail),
//     colour draining out as the robe soaks through, and the focus cut splitting the frame for an instant.
// LENS_LOW (phones) keeps one layer of each kind of drop and a cheaper veil.

uniform sampler2D tDiffuse;
/** Quarter-resolution blurred frame (PostBlur.frag); black when nothing on the lens needs it. */
uniform sampler2D tBlur;
/** The bloom's widest blur of the bright parts: big halos in the fog. */
uniform sampler2D tGlow;
uniform vec2 uResolution;
uniform float uTime;
uniform float uFog;
uniform vec2 uFogDrift;
uniform float uDrops;
uniform float uRuns;
uniform float uLightning;
uniform float uPunch;
uniform float uDamage;
uniform float uHeavy;
uniform float uDesat;
uniform float uSlash;
uniform float uSlashY;
uniform float uSlashDir;
uniform float uCA;
uniform float uGrain;
uniform float uVignette;
varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
/** How far a drop bends the view through it, in drop radii: beads show a small, inverted picture. */
const float REFRACT = 5.5;

#ifdef LENS_LOW
  #define FOG_OCTAVES 3
#else
  #define FOG_OCTAVES 4
#endif

// Hashes without trigonometry, so they stay stable at large inputs on every GPU.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < FOG_OCTAVES; i++) {
    s += a * vnoise(p);
    p = p * 2.07 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return s;
}

// One grid layer of beads. Each cell holds at most one bead with its own size, place and clock: it lands
// at full size and slowly shrinks as it evaporates, while a new one lands elsewhere in the cell; the
// bigger ones gather enough water to creep down the glass. `amount` is the share of cells holding a
// bead. p is in screen heights. Returns the pixel's offset from the bead's centre in radii (xy, scaled
// by coverage), the coverage (z) and the radius in screen heights (w).
vec4 beadLayer(vec2 p, float cells, float t, float amount, float seed) {
  vec2 q = p * cells + seed;
  vec2 id = floor(q);
  vec3 h = hash32(id);
  float period = 3.0 + 7.0 * h.z;
  float age = t / period + h.x * 11.0;
  float life = fract(age);
  vec3 g = hash32(id + floor(age) * 7.31 + seed);
  if (g.z > amount) return vec4(0.0);
  float rMax = 0.12 + 0.22 * g.x;
  float r = rMax * (1.0 - 0.45 * life) * smoothstep(0.0, 0.02, life);
  // The centre keeps the whole bead inside its cell, so no neighbour needs checking.
  vec2 c = (g.xy - 0.5) * (1.0 - 2.0 * rMax);
  float slide = (c.y + 0.5 - rMax) * smoothstep(0.24, 0.32, rMax) * smoothstep(0.1, 0.9, life);
  vec2 d = fract(q) - 0.5 - c + vec2(0.0, slide);
  // A creeping bead stretches a little along its path.
  d.y *= 1.0 - 0.15 * step(0.24, rMax);
  float m = smoothstep(r, r * 0.55, length(d)) * smoothstep(1.0, 0.85, life);
  return vec4(d / max(r, 1e-3) * m, m, r / cells);
}

// Drops running down the glass, one per column on its own clock, in fits and starts. Each leaves a wet
// trail that fogs over again with distance behind it, with a string of tiny beads along it.
// Returns the offset from the drop's centre in radii (xy), coverage (z) and trail clearance (w);
// `radius` receives the drop's radius in screen heights.
vec4 runLayer(vec2 p, float cols, float t, float speed, float seed, out float radius) {
  float col = floor(p.x * cols + seed);
  vec3 h = hash32(vec2(col, seed * 3.7 + 1.0));
  float period = (3.5 + 5.0 * h.x) / speed;
  float age = t / period + h.y * 17.0;
  float tl = fract(age);
  float k = 3.0 + floor(h.z * 4.0);
  // Stick-slip: the sine cancels the drift k times per run, so the drop pauses, then lurches on.
  float s = tl - sin(6.2831853 * k * tl) / (6.2831853 * k);
  float y = 1.12 - 1.9 * s;
  vec3 g = hash32(vec2(col, floor(age) + seed * 5.1));
  float x = (col + 0.5 + (g.x - 0.5) * 0.45 - seed) / cols;
  // The path meanders as the drop finds its way between the beads.
  x += 0.006 * sin(p.y * 21.0 + g.y * 6.28) + 0.0025 * sin(p.y * 57.0 + g.z * 6.28);
  float r = 0.009 + 0.008 * g.y;
  radius = r;
  vec2 d = vec2(p.x - x, (p.y - y) * 0.8);
  float m = smoothstep(r, r * 0.7, length(d));
  float above = p.y - y;
  float trailW = r * 0.62;
  float trail = smoothstep(trailW, trailW * 0.35, abs(d.x)) * smoothstep(-r * 0.3, r, above) * smoothstep(0.55, 0.0, above);
  // Tiny beads strung along the trail, about every 2% of the screen, not all of them.
  float by = above * 48.0 + g.z * 3.0;
  float cell = floor(by);
  vec2 bd = vec2(d.x, (fract(by) - 0.5) / 48.0);
  float br = trailW * (0.35 + 0.4 * hash12(vec2(col, cell)));
  float bead = smoothstep(br, br * 0.6, length(bd)) * step(0.45, hash12(vec2(cell, col + 3.0)))
    * smoothstep(r * 1.5, r * 3.0, above) * smoothstep(0.4, 0.08, above);
  vec2 off = d / r * m + bd / max(br, 1e-4) * bead;
  return vec4(off, max(m, bead), trail);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  // The focus cut: for an instant the frame slips along the line of the cut.
  if (uSlash > 0.0) uv.x -= sign(uv.y - uSlashY) * uSlashDir * uSlash * 0.007;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 centered = uv - 0.5;
  // 0 at the centre, 1 at the middle of the side edges, about 1.15 in the corners.
  float rim = length(centered * vec2(aspect, 1.0)) / (0.5 * aspect);

  // ---- Water on the glass ----
  vec2 slope = vec2(0.0);
  vec2 bend = vec2(0.0);
  float wet = 0.0;
  float clear = 0.0;
  if (uDrops > 0.002 || uRuns > 0.002) {
    float rr;
    vec4 run = runLayer(p, 6.0, uTime, 1.0, 0.0, rr) * step(0.002, uRuns);
    run.z *= min(1.0, uRuns * 2.0);
    vec4 best = vec4(run.xy, run.z, rr);
    clear = run.w * min(1.0, uRuns * 2.0);
#ifndef LENS_LOW
    float rr2;
    vec4 run2 = runLayer(p, 9.0, uTime, 0.7, 0.37, rr2) * step(0.002, uRuns);
    run2.z *= min(1.0, uRuns * 1.5);
    if (run2.z > best.z) best = vec4(run2.xy, run2.z, rr2);
    clear = max(clear, run2.w * min(1.0, uRuns * 1.5));
#endif
    if (uDrops > 0.002) {
#ifdef LENS_LOW
      vec4 b1 = beadLayer(p, 12.0, uTime, uDrops * 0.4, 0.0);
      if (b1.z > best.z) best = b1;
#else
      vec4 b1 = beadLayer(p, 8.0, uTime, uDrops * 0.32, 0.0);
      if (b1.z > best.z) best = b1;
      vec4 b2 = beadLayer(p, 19.0, uTime * 1.2, uDrops * 0.42, 41.0);
      if (b2.z > best.z) best = b2;
#endif
    }
    slope = best.xy;
    wet = best.z;
    bend = slope * best.w * REFRACT;
  }
  // A bead turns the view inside it upside down.
  vec2 uvR = uv - vec2(bend.x / aspect, bend.y);

  // ---- The sharp image, with chromatic aberration growing toward the edges ----
  vec2 ca = centered * dot(centered, centered) * uCA;
  vec3 color;
  color.r = texture2D(tDiffuse, uvR + ca).r;
  color.g = texture2D(tDiffuse, uvR).g;
  color.b = texture2D(tDiffuse, uvR - ca).b;

  // ---- Condensation ----
  vec3 soft = vec3(0.0);
  if (uFog > 0.002 || wet > 0.0) soft = texture2D(tBlur, uvR).rgb;
  if (uFog > 0.002) {
    float cover = fbm(p * 1.7 + uFogDrift) + rim * 0.55 - 0.25;
    float thr = 0.95 - uFog * 1.15;
    float fog = smoothstep(thr - 0.15, thr + 0.3, cover) * (0.5 + 0.5 * uFog);
    // Micro-droplets give the veil a fine, uneven grain.
    fog *= 0.8 + 0.2 * vnoise(p * 220.0);
    // Drops and the trails they leave wipe the glass clear (never quite: a film of water stays).
    fog *= 1.0 - 0.75 * max(clear, wet);
    // Scattered light: a softened, slightly greyed picture lifted by a cold milky haze, and the
    // lights blooming into wide halos.
    vec3 milk = mix(soft, vec3(dot(soft, LUMA)), 0.3) * 1.15 + vec3(0.006, 0.0075, 0.0105) * (1.0 + 6.0 * uLightning);
    color = mix(color, milk, fog) + texture2D(tGlow, uv).rgb * fog * 1.4;
  }

  // ---- The drops themselves: out of focus, a thin dark rim where light bends away, a bright
  //      crescent at the bottom where the light above is focused, and a faint glint ----
  if (wet > 0.0) {
    float edge = smoothstep(0.7, 1.0, length(slope));
    color = mix(color, soft, 0.6 * wet);
    color *= 1.0 - 0.3 * edge * wet;
    float crescent = smoothstep(0.35, 0.85, -slope.y) * smoothstep(1.0, 0.75, length(slope)) * wet;
    color += crescent * (soft * 0.5 + vec3(0.004, 0.005, 0.007));
    float glint = smoothstep(0.22, 0.0, length(slope - vec2(-0.35, 0.45))) * wet;
    color += glint * (vec3(0.012, 0.015, 0.02) + soft * 0.35) * (1.0 + 4.0 * uLightning);
  }

  // ---- Exposure, colour and damage ----
  color *= (1.0 + uLightning * 0.3 + uPunch) * mix(vec3(1.0), vec3(0.94, 0.98, 1.06), uLightning);
  color = mix(color, vec3(dot(color, LUMA)), uDesat);
  float hurt = uDamage * smoothstep(0.62 - 0.32 * uHeavy, 1.25, rim);
  color = mix(color, color * vec3(1.0, 0.2, 0.16) + vec3(0.035, 0.0, 0.002) * (1.0 + uHeavy), hurt);
  color *= 1.0 - uVignette * smoothstep(0.45, 1.4, rim);

  // ---- Grain, added in a roughly perceptual space so it shows in the mid-tones, not the blacks ----
  float grain = hash12(floor(gl_FragCoord.xy) + fract(uTime * 7.31) * 913.0) - 0.5;
  color = sqrt(max(color, vec3(0.0))) + grain * uGrain;
  color = max(color, vec3(0.0));
  gl_FragColor = vec4(color * color, 1.0);
}
