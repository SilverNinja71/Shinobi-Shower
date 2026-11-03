// Plank extension for the wet-surface MeshStandardMaterial (see Planks.ts). Each "// @@name" section is
// spliced into three's standard shader next to the include named in Planks.ts.
//
// Per instance: aPlank = (uv offset u, uv offset v, ±1 texture mirror, tone seed), so no two boards
// show the same patch of wood; aDamage = (damage 0–3, impact z, crack tile, flips 0–3), from the
// simulation's plank health (4 = intact). The cracks come from a tile of the crack atlas (crackAtlas.ts),
// mapped in the board's own space so they ride along with it, run through its top, sides and end grain
// like real splits, and stay put as the deck sways.

// @@vertex-common
attribute vec4 aPlank;
attribute vec4 aDamage;
varying vec3 vPlankPos;
varying vec4 vPlankDmg;
varying vec2 vPlankTone;

// A split board sags where the stone struck it.
float plankDroop(float damage) {
  return damage < 1.5 ? 0.0 : (damage < 2.5 ? 0.014 : 0.042);
}

// @@uv
#ifdef USE_MAP
  vMapUv = vec2(vMapUv.x * aPlank.z, vMapUv.y) + aPlank.xy;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = vec2(vNormalMapUv.x * aPlank.z, vNormalMapUv.y) + aPlank.xy;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = vec2(vRoughnessMapUv.x * aPlank.z, vRoughnessMapUv.y) + aPlank.xy;
#endif

// @@normal-vertex
{
  float droop = plankDroop(aDamage.x);
  float dz = position.z - aDamage.y;
  if (droop > 0.0 && abs(dz) < 0.75) objectNormal.z -= objectNormal.y * sign(dz) * droop / 0.75;
}

// @@vertex
transformed.y -= plankDroop(aDamage.x) * max(0.0, 1.0 - abs(transformed.z - aDamage.y) / 0.75);
vPlankPos = transformed;
// Damage, crack tile, and the tile's mirroring across and along the board.
vPlankDmg = vec4(aDamage.x, aDamage.z, mod(aDamage.w, 2.0) < 0.5 ? 1.0 : -1.0, aDamage.w < 1.5 ? 1.0 : -1.0);
// The end faces are end grain.
vPlankTone = vec2(aPlank.w, smoothstep(0.55, 0.85, abs(normal.z)));

// @@fragment-common
uniform sampler2D uCrackAtlas;
varying vec3 vPlankPos;
varying vec4 vPlankDmg;
varying vec2 vPlankTone;

// Bump mapping from a height field via screen-space derivatives (as three's bumpmap does), so the
// crack walls catch the light without any extra varyings.
vec3 plankBump(vec3 surfPos, vec3 surfNorm, float h) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * surfNorm - grad);
}

// @@albedo
// The board's crack tile, read in its own space (one read, in uniform control flow for the mipmaps).
vec2 plankCrackUv = vec2(
  clamp(vPlankPos.x * vPlankDmg.z / PLANK_WIDTH + 0.5, 0.03, 0.97),
  clamp(vPlankPos.z * vPlankDmg.w / PLANK_LENGTH + 0.5, 0.0, 1.0)
);
vec3 plankCrack = texture2D(uCrackAtlas, vec2((vPlankDmg.y + plankCrackUv.x) / CRACK_TILES, plankCrackUv.y)).rgb * step(0.5, vPlankDmg.x);
float plankGap = plankCrack.r;
float plankRim = plankCrack.g * (1.0 - plankCrack.r);
float plankCrush = plankCrack.b;
// End grain drinks the rain and greys darker.
diffuseColor.rgb *= mix(1.0, 0.62, vPlankTone.y);
// Every board weathered on its own; about one in fifteen is a newer replacement.
vec3 plankTint = mix(vec3(0.8, 0.83, 0.88), vec3(1.08, 1.02, 0.95), fract(vPlankTone.x * 3.7));
diffuseColor.rgb *= mix(plankTint, vec3(1.32, 1.12, 0.86), step(0.935, vPlankTone.x));
// Torn fibres along a crack are pale raw wood (darker when soaked); the gaps themselves are black.
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.25, 0.15) * (0.7 + 0.3 * plankCrack.g) * mix(1.0, 0.6, wet), plankRim * 0.8);
diffuseColor.rgb *= mix(1.0, 0.55, plankCrush);
diffuseColor.rgb *= 1.0 - 0.94 * plankGap;

// @@roughness
roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.25), plankRim);
roughnessFactor = mix(roughnessFactor, 0.95, max(plankGap, plankCrush * 0.6));

// @@normal
// The crack walls slope into the gap; crushed wood is dented.
normal = plankBump(-vViewPosition, normal, -0.004 * plankGap - 0.0015 * plankRim * plankRim - 0.002 * plankCrush);
