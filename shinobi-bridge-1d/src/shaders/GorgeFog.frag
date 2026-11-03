// Gorge fog: drifting sheets and rising wisps that fill the gorge so it reads as bottomless, lit
// faintly by the moon (brightest looking toward it) and flooded by lightning.
uniform sampler2D uNoise;
uniform float uTime;
uniform float uLightning;
uniform float uMist;
uniform float uRain;
uniform vec2 uDrift;
uniform vec3 uFogColor;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uFlashDir;
uniform vec3 uFlashColor;
uniform float uOpacity;

varying vec3 vWorld;
varying float vLayer;
#ifdef WISP
varying vec2 vUv;
varying float vSeed;
varying float vFade;
#endif

vec3 fogLight(vec3 view, float density) {
  // The moon reaches the upper fog; the depths sink toward black, which is what makes the gorge
  // read as bottomless rather than as a floor of cloud.
  float depthDark = mix(1.2, 0.22, vLayer);
  float toward = max(dot(-view, uMoonDir), 0.0);
  float scatter = 0.25 + 1.4 * pow(toward, 6.0);
  vec3 col = uFogColor * depthDark * (0.75 + 0.5 * density);
  col += uMoonColor * 0.03 * scatter * (1.0 - 0.8 * vLayer);
  // Lightning floods the fog, the upper layers most, brightest toward the strike.
  float lobe = 0.45 + 0.55 * pow(max(dot(-view, uFlashDir), 0.0), 3.0);
  col += uFlashColor * uLightning * lobe * (1.0 - 0.7 * vLayer) * 0.55;
  return col;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 view = toCam / dist;
  float alpha;
  float density;
#ifdef WISP
  // Rising streaks, stretched vertically, inside a soft column.
  vec2 p = vec2(vUv.x * 0.35 + vSeed, vUv.y * 0.18 - uTime * (0.006 + vSeed * 0.006));
  float streak = texture2D(uNoise, p).b;
  float body = texture2D(uNoise, p * 0.5 + vec2(0.3, 0.7)).r;
  float column = (1.0 - smoothstep(0.12, 0.5, abs(vUv.x - 0.5))) * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  density = column * smoothstep(0.3, 0.85, streak * 0.55 + body * 0.6);
  alpha = density * 0.45 * vFade;
#else
  vec2 p = vWorld.xz;
  float layer = vLayer;
  // Each sheet drifts at its own pace; a broad layer warps a finer one into wisps.
  vec2 drift = uDrift * (0.6 + layer * 0.5);
  vec4 broad = texture2D(uNoise, p * 0.0042 + drift * 0.0042 + layer * 0.37);
  vec4 fine = texture2D(uNoise, p * 0.013 + drift * 0.009 + (broad.gb - 0.5) * 0.12 + layer * 0.71);
  float n = broad.r * 0.6 + fine.g * 0.4;
  // Upper sheets are torn into drifting banks with wide gaps; deeper ones close up.
  density = smoothstep(0.56 - layer * 0.34, 0.88 - layer * 0.26, n);
  // A sheet seen edge-on is a long path through fog, so it thickens as the view grazes it, but
  // only so far: past that the far sheet would turn into a flat white floor.
  float graze = 1.0 / max(abs(view.y), 0.12);
  alpha = 1.0 - exp(-density * (0.075 + layer * 0.32) * graze);
  // Fade out well before the far end and near the camera, so no sheet ever shows an edge. Upper
  // sheets stay in the gorge; deeper ones reach further out over the sea.
  alpha *= smoothstep(-330.0, -90.0 - layer * 170.0, vWorld.z) * (1.0 - smoothstep(30.0, 60.0, vWorld.z));
  alpha *= (1.0 - smoothstep(60.0, 95.0, abs(vWorld.x))) * smoothstep(6.0, 26.0, dist);
#endif
  alpha *= uOpacity * (0.75 + 0.35 * uMist + 0.15 * uRain);
  gl_FragColor = vec4(fogLight(view, density), clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
