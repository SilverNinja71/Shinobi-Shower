// Distant snow-capped ranges: near-black rock and snow, lit from behind by the moon (so only the
// crests catch it) and laid back into the haze with distance. Lightning reveals them: the faces
// turned toward the strike light up, and the snow fields catch the flash of the whole cloud deck.
// Raggedness comes from the baked noise texture (fbm in R, G; fine grain in A).

uniform sampler2D uNoise;
uniform float uLightning;
uniform float uMist;
uniform float uRain;
uniform float uSnow;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uFlashPos;
uniform vec3 uFlashColor;
uniform vec3 uHaze;
uniform vec3 uRock;
uniform vec3 uSnowColor;
uniform float uSeaLevel;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vRange;

void main() {
  // The sea (drawn behind everything) shows wherever the islands dip under it.
  if (vWorld.y < uSeaLevel) discard;
  vec3 n = normalize(vNormal);

  // Snow lies above a ragged snowline that climbs with each range, and only where it can cling.
  vec4 grain = texture2D(uNoise, vWorld.xz * (0.0016 - vRange * 0.0004) + vRange * 0.37);
  float snowLine = 4.0 + vRange * 20.0 + vRange * vRange * 6.0;
  float ragged = (grain.r - 0.5) * (40.0 + vRange * 30.0);
  float snow = smoothstep(snowLine - 14.0, snowLine + 10.0, vWorld.y + ragged);
  snow *= smoothstep(0.2, 0.55, n.y + (grain.a - 0.5) * 0.35);
  vec3 albedo = mix(uRock, uSnowColor, snow);

  // The moon is behind the ranges: only crests and back-tilted snow catch it.
  float moon = max(dot(n, uMoonDir), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 light = uMoonColor * moon * 0.55 + vec3(0.05, 0.06, 0.085) * sky;

  // Lightning: the channel lights what faces it (falling off over kilometres), and the lit cloud
  // deck overhead lights every upward face, which is what makes the snowfields flare.
  vec3 toFlash = uFlashPos - vWorld;
  float flashDist = length(toFlash);
  float facing = max(dot(n, toFlash / flashDist), 0.0);
  float reach = 1.0 / (1.0 + flashDist * flashDist * 2.5e-6);
  light += uFlashColor * uLightning * (facing * reach * 5.0 + sky * sky * 1.1);

  vec3 col = albedo * light;

  // Aerial perspective toward the sky's own horizon colour; mist and falling weather thicken it.
  vec3 hazeCol = uHaze * (1.0 + uLightning * 2.0);
  float d = length(vWorld - cameraPosition);
  float density = 0.0005 + 0.0042 * uMist + 0.0007 * uRain + 0.0016 * uSnow;
  col = mix(col, hazeCol, 1.0 - exp(-d * density));
  // The valleys are full of cloud: the ranges rise out of a pale, moonlit sea of mist.
  float valley = smoothstep(5.0, -150.0, vWorld.y + (grain.g - 0.5) * 60.0);
  col = mix(col, hazeCol * 1.3, valley * 0.85);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
