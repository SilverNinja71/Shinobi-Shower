precision highp float;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPosition;
varying vec2 vUv;

uniform float uTime;
uniform float uHeatIntensity; // 0 to 1

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);

  // vUv.x runs from 0 (blade spine / mune) to 1 (cutting edge / ha)
  // vUv.y runs from 0 (tsuba base) to 1 (tip / kissaki)

  // 1. Cold Folded Steel Base
  vec3 steelBase = vec3(0.08, 0.10, 0.14);
  
  // Specular sheen along ridge
  float spec = pow(max(0.0, dot(reflect(-V, N), vec3(0.3, 0.8, 0.5))), 16.0);
  vec3 steelColor = steelBase + vec3(0.6, 0.7, 0.85) * spec * 0.7;

  // 2. Procedural Wavy Hamon (Temper Line)
  // Traditional Gunome/Notare pattern near edge (u ~ 0.65 to 0.75)
  float hamonWave = sin(vUv.y * 35.0) * 0.04 + cos(vUv.y * 70.0) * 0.015;
  float hamonThreshold = 0.68 + hamonWave;
  float hamonEdge = smoothstep(hamonThreshold - 0.02, hamonThreshold + 0.02, vUv.x);
  
  // Frosted pearl-white crystalline martensite along the hamon
  float hamonFrost = smoothstep(hamonThreshold - 0.04, hamonThreshold, vUv.x) * 
                     (1.0 - smoothstep(hamonThreshold, hamonThreshold + 0.06, vUv.x));
  steelColor = mix(steelColor, vec3(0.3, 0.35, 0.42), hamonEdge * 0.5);
  steelColor += vec3(0.8, 0.85, 0.95) * hamonFrost * 0.9;

  // 3. Superheated Incandescent Cutting Edge (Ha)
  // As the blade slices through the quantum droplet at relativistic speed,
  // the edge burns with incandescent heat.
  float edgeDist = smoothstep(0.72, 1.0, vUv.x);
  
  // Multi-tier thermal radiation gradient:
  // Blackbody radiation: Deep red (800K) -> Orange (1400K) -> Yellow (2200K) -> Blinding White (4500K)
  vec3 heatBloom = vec3(0.0);
  if (edgeDist > 0.01) {
    float t = edgeDist;
    vec3 colDeepRed = vec3(0.9, 0.08, 0.02);
    vec3 colOrange  = vec3(1.0, 0.45, 0.05);
    vec3 colYellow  = vec3(1.0, 0.92, 0.35);
    vec3 colWhite   = vec3(1.4, 1.4, 1.3);

    if (t < 0.4) {
      heatBloom = mix(vec3(0.0), colDeepRed, t / 0.4);
    } else if (t < 0.7) {
      heatBloom = mix(colDeepRed, colOrange, (t - 0.4) / 0.3);
    } else if (t < 0.9) {
      heatBloom = mix(colOrange, colYellow, (t - 0.7) / 0.2);
    } else {
      heatBloom = mix(colYellow, colWhite, (t - 0.9) / 0.1);
    }
  }

  // Modulate heat intensity with blade slash phase
  vec3 finalColor = steelColor + heatBloom * (1.2 + uHeatIntensity * 1.8);

  // Subtle Fresnel edge rim
  float fresnel = pow(1.0 - max(0.0, dot(N, V)), 2.5);
  finalColor += vec3(0.4, 0.6, 0.9) * fresnel * 0.6;

  gl_FragColor = vec4(finalColor, 1.0);
}
