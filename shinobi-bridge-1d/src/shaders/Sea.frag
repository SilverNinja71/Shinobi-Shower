// Storm sea far below: dark water heaving in long wind-driven swells broken by chop, reflecting the
// storm sky with a moonlit glitter path, flashing silver when lightning lights the cloud deck, and
// fading into the same haze as the sky's horizon.

uniform sampler2D uNoise;
uniform float uTime;
uniform float uLightning;
uniform float uMist;
uniform float uRain;
uniform float uWind;
uniform vec2 uDrift;
uniform float uSeaLevel;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uFlashDir;
uniform vec3 uFlashColor;
uniform vec3 uHaze;
uniform vec3 uZenith;
uniform vec3 uHorizon;

varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  if (d.y > -0.0005) discard;
  float t = (uSeaLevel - cameraPosition.y) / d.y;
  vec3 hit = cameraPosition + d * t;

  // Wave slopes straight from drifting noise: heavy swell, chop across it, and wind ripples too
  // fine to resolve this far out, which break the glitter path into sparkles. Noise rather than
  // sines, so the far water never stripes into regular bands. The drift is integrated from the
  // wind, so the pattern runs with it and never jumps when it turns.
  vec2 drift = uDrift * vec2(2.0, 1.6);
  vec4 swell = texture2D(uNoise, (hit.xz + drift) * 0.004);
  vec4 chop = texture2D(uNoise, (hit.xz - drift * 0.6) * 0.011 + 0.3);
  vec2 ripple = texture2D(uNoise, hit.xz * 0.06 + drift * 0.035 + uTime * vec2(0.013, 0.021)).ba - 0.5;
  vec2 slope = (swell.rg - 0.5) * 0.35 + (chop.gr - 0.5) * 0.3 + ripple * 0.5;
  vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(2500.0, 14000.0, t)));
  float h0 = (swell.b - 0.5) * 6.0 + (chop.a - 0.5) * 2.4;

  // Water reflects the sky (Schlick, F0 = 0.02); what it does not reflect is near-black depth.
  vec3 v = -d;
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(d, n);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, sqrt(max(r.y, 0.0))));
  float toMoon = max(dot(r, uMoonDir), 0.0);
  vec3 moon = uMoonColor * (pow(toMoon, 600.0) * 4.5 + pow(toMoon, 60.0) * 0.22) * (1.0 - 0.85 * uMist);
  float toFlash = max(dot(r, uFlashDir), 0.0);
  vec3 flash = uFlashColor * uLightning * (0.35 + pow(toFlash, 14.0) * 3.0);
  vec3 col = mix(vec3(0.0035, 0.005, 0.007), sky + moon + flash, fresnel);

  // Whitecaps on the crests in a strong wind, seen mostly when lightning catches them.
  float caps = smoothstep(1.6, 3.2, h0) * clamp(abs(uWind) / 7.0, 0.2, 1.0);
  col += vec3(0.6, 0.65, 0.72) * caps * (0.03 + uLightning * 0.5);

  // Haze, matched to the sky's horizon: the sea melts into it toward the horizon.
  float haze = 1.0 - exp(-t * (0.00026 + 0.003 * uMist + 0.00035 * uRain));
  col = mix(col, uHaze * (1.0 + uLightning * 2.0), haze);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
