// Snow lying on the deck (see DeckSnow.ts), spliced into three's standard shader. The mesh is a flat grid:
// position.x is the lane x and position.z runs −1..1 across the deck. Heights come from the simulation's
// snow height map (uSnowDepth per 0.15 m cell: depth, open flag, distance to the nearest hole; re-uploaded
// only when it changes); the deck frame comes from the deck samples, so the drift rides the bridge's sway.

// @@vertex-common
uniform sampler2D uSnowDepth;
varying float vSnowH;
varying float vSnowLane;
varying vec3 vSnowWorld;
varying vec3 vSnowNormal;

vec4 snowCellAt(float i) {
  return texture2D(uSnowDepth, vec2((clamp(i, 0.0, SNOW_CELLS - 1.0) + 0.5) / SNOW_CELLS, 0.5));
}

// Depth along the lane (x) and its slope (y), through the cell centres: a Catmull-Rom curve passes
// through the simulation's depths but rounds the crests straight lines would leave as ridges. Near a
// missing plank the drift slumps into the hole over a lip about as long as it is deep, instead of
// standing as a sheer wall.
vec2 snowDepth(float x) {
  float f = x / SNOW_CELL - 0.5;
  float i = floor(f);
  float t = f - i;
  vec4 a = snowCellAt(i - 1.0);
  vec4 b = snowCellAt(i);
  vec4 c = snowCellAt(i + 1.0);
  vec4 d = snowCellAt(i + 2.0);
  float k1 = c.r - a.r;
  float k2 = 2.0 * a.r - 5.0 * b.r + 4.0 * c.r - d.r;
  float k3 = 3.0 * b.r - a.r - 3.0 * c.r + d.r;
  float depth = 0.5 * (2.0 * b.r + t * (k1 + t * (k2 + t * k3)));
  float slope = 0.5 * (k1 + t * (2.0 * k2 + 3.0 * t * k3)) / SNOW_CELL;
  float top = max(b.r, c.r);
  if (depth <= 0.0 || depth >= top) slope = 0.0;
  depth = clamp(depth, 0.0, top);
  float span = SNOW_LIP + depth * 0.8;
  float u = clamp(mix(b.b, c.b, t) / span, 0.0, 1.0);
  float lip = u * u * (3.0 - 2.0 * u);
  float lipSlope = 6.0 * u * (1.0 - u) / span * (c.b - b.b) / SNOW_CELL;
  return vec2(depth * lip, slope * lip + depth * lipSlope);
}

float snowHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float snowNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(snowHash(i), snowHash(i + vec2(1.0, 0.0)), u.x), mix(snowHash(i + vec2(0.0, 1.0)), snowHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// @@normal-vertex
// The drift's height above the deck: the lane's depth, shaped across the deck into a rounded mound,
// thickest down the middle where the warrior wades, with wind-packed lumps; its slope gives the normal.
vec4 snowDeck = deckAt(position.x);
vec2 snowD = snowDepth(position.x);
float snowU = min(abs(position.z), 1.0);
float snowProfile = sqrt(max(0.0, 1.0 - pow(snowU, 2.5)));
float snowFlank = -1.25 * pow(snowU, 1.5) / max(snowProfile, 0.2) * sign(position.z);
float snowLumps = 1.0 + 0.18 * (snowNoise(vec2(position.x * 2.3, position.z * 1.7)) - 0.5) + 0.08 * (snowNoise(vec2(position.x * 7.1, position.z * 4.3 + 3.0)) - 0.5);
float snowH = snowD.x * snowProfile * snowLumps;
vec3 snowPos = deckPoint(snowDeck, position.x, snowH + SNOW_LIFT, position.z * DECK_HALF_WIDTH);
{
  float hx = snowD.y * snowProfile * snowLumps;
  float hz = snowD.x * snowFlank * snowLumps / DECK_HALF_WIDTH;
  objectNormal = deckRotate(snowDeck, normalize(vec3(-(snowDeck.w + hx), 1.0, -hz)));
}
vSnowH = snowH;
vSnowLane = position.x;
vSnowWorld = snowPos;
vSnowNormal = objectNormal;

// @@position
transformed = snowPos;

// @@fragment-common
uniform sampler2D uSnowDepth;
uniform float uTime;
uniform float uRain;
varying float vSnowH;
varying float vSnowLane;
varying vec3 vSnowWorld;
varying vec3 vSnowNormal;

float snowHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

// @@clip
// Nothing where the drift has thinned away, and nothing over a missing plank.
if (vSnowH < 0.004) discard;
if (texture2D(uSnowDepth, vec2((floor(vSnowLane / SNOW_CELL) + 0.5) / SNOW_CELLS, 0.5)).g > 0.5) discard;

// @@albedo
#ifdef USE_MAP
  // The grid's UVs lie flat; on the steep face of a drift cut off by a hole, take the texture side-on
  // instead so it does not smear into streaks. Soften the texture's dark flecks a little too.
  float snowSteep = smoothstep(0.55, 0.85, abs(normalize(vSnowNormal).x));
  vec4 snowSide = texture2D(map, vec2(vSnowWorld.x, vSnowWorld.y) / SNOW_TEX_SCALE);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * snowSide.rgb, snowSteep);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * 0.92, 0.3);
#endif
// Rain soaks the snow into grey slush.
diffuseColor.rgb *= mix(1.0, 0.8, uRain * 0.75);
// Thin snow lets the dark planks show through.
diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.004, 0.03, vSnowH));

// @@roughness
roughnessFactor = mix(roughnessFactor, 0.45, uRain * 0.6);

// @@sparkle
// Ice crystals glint: about one centimetre-sized facet in a hundred and fifty catches the light, and
// which ones depends on where they are seen from, so they twinkle as the camera moves.
{
  vec3 sp = vSnowWorld * 90.0;
  vec3 cell = floor(sp);
  vec3 view = normalize(cameraPosition - vSnowWorld);
  float facet = snowHash3(cell + floor(view * 7.0) * 13.0 + floor(uTime * 0.8));
  float glint = step(0.993, snowHash3(cell)) * step(0.5, facet) * (1.0 - smoothstep(0.12, 0.45, length(fract(sp) - 0.5)));
  totalEmissiveRadiance += vec3(0.78, 0.87, 1.0) * glint * 2.2 * (1.0 - uRain * 0.8);
}
