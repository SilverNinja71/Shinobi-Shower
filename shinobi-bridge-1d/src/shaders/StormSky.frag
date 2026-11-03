// Storm sky: a blue-black gradient under a deck of layered storm cloud that drifts with the wind,
// a moon glowing through thin cloud (upper left, behind the bridge), and lightning that lights the
// cloud from inside around the last strike. Output is linear scene radiance, tone-mapped like the
// rest of the scene. Cloud shapes come from the baked noise texture (fbm in R and G, billows in
// B): a few fetches instead of many octaves of noise per pixel.

uniform sampler2D uNoise;
uniform float uLightning;
uniform float uMist;
uniform float uRain;
uniform float uSnow;
uniform vec2 uCloudShift;
uniform vec3 uMoonDir;
uniform vec3 uFlashDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uCloud;
uniform vec3 uCloudLit;
uniform vec3 uMoonColor;
uniform vec3 uFlashColor;

varying vec3 vDir;

// Cloud cover at a point on the deck: broad masses broken by a faster, finer layer of billows.
float cloudCover(vec2 p) {
  vec4 masses = texture2D(uNoise, p * 0.1 + uCloudShift * 0.18);
  vec4 billows = texture2D(uNoise, p * 0.31 + uCloudShift * 0.31 + vec2(0.37, 0.71));
  return smoothstep(0.36, 0.7, masses.r * 0.66 + billows.g * 0.3 + billows.b * 0.1);
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);

  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.75, sqrt(h)));

  // The cloud deck as a plane overhead: its coordinates stretch toward the horizon, which gives
  // the clouds perspective and makes them bunch up into a dark bank low in the sky.
  vec2 cp = d.xz / (h + 0.07);
  // The deck thins out into the haze bank at the horizon rather than smearing below it.
  float deck = smoothstep(-0.01, 0.06, d.y);
  float cover = cloudCover(cp) * deck;
  // Lit from the moon's side: thinner cloud toward the moon lets light into this patch's edge.
  vec2 toMoon = normalize(uMoonDir.xz) * 0.22;
  float coverToMoon = cloudCover(cp + toMoon) * deck;
  float edgeLit = clamp(0.5 + (cover - coverToMoon) * 2.5, 0.0, 1.0);

  float moonCos = dot(d, uMoonDir);
  float moonAngle = acos(clamp(moonCos, -1.0, 1.0));
  // The cloud is backlit: dark bodies, edges silvered by the moon (strongly near it, faintly
  // elsewhere), the thin parts letting its light through.
  float nearMoon = exp(-moonAngle * 2.6);
  vec3 cloudCol = uCloud + uCloudLit * edgeLit * (0.12 + 1.6 * nearMoon) * (1.0 - 0.55 * cover);
  // The bank low over the horizon is further off and hazier.
  cloudCol = mix(cloudCol, uHaze * 0.85, exp(-h * 9.0) * 0.55);
  col = mix(col, cloudCol, cover * 0.95);

  // The moon behind thin cloud: a veiled disc, a tight halo and a broad glow.
  float veil = exp(-cover * 3.4);
  float disc = smoothstep(0.0175, 0.0145, moonAngle);
  float halo = exp(-moonAngle * 26.0) * 0.55 + exp(-moonAngle * 6.5) * 0.09;
  col += uMoonColor * (disc * 1.6 * veil + halo * (0.25 + 0.75 * veil)) * (1.0 - 0.7 * uMist);

  // Lightning lights the cloud from inside: brightest around the strike and in the thickest
  // cloud, so the deck's structure shows in the flash instead of washing out.
  float flashCos = max(dot(d, uFlashDir), 0.0);
  float lobe = pow(flashCos, 6.0) * 0.3 + pow(flashCos, 36.0) * 0.9;
  float inside = 0.15 + cover * cover * 1.4;
  vec3 flash = uFlashColor * uLightning * (0.012 + lobe * inside * deck);
  col += flash;

  // Rain and snow veil the sky into a flatter grey; mist swallows it almost entirely.
  vec3 haze = uHaze * (1.0 + uLightning * 2.0);
  float veilNear = exp(-h * 3.0);
  col = mix(col, haze, clamp(uRain * 0.22 * veilNear + uSnow * 0.25 + uMist * 0.6, 0.0, 0.85));

  // Below the horizon there is only haze (the sea and the far ranges fade into exactly this).
  col = mix(col, haze, smoothstep(0.0, -0.04, d.y));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
