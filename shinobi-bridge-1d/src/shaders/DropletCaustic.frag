precision highp float;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPosition;
varying vec2 vUv;

uniform float uTime;
uniform float uOpacity;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);

  // Delicate water droplet edge refraction (Fresnel)
  float cosTheta = max(0.0, dot(N, V));
  float fresnel = pow(1.0 - cosTheta, 4.0);

  // Subtle caustic shimmer on the droplet skin
  float c1 = sin(vWorldPosition.x * 4.0 + uTime * 2.0);
  float c2 = cos(vWorldPosition.y * 4.0 - uTime * 1.5);
  float caustic = pow(max(0.0, c1 * 0.5 + c2 * 0.5), 4.0);

  // Subtle specular highlight from moonlight
  vec3 lightDir = normalize(vec3(-0.5, 0.8, 0.6));
  float spec = pow(max(0.0, dot(reflect(-lightDir, N), V)), 32.0);

  vec3 rimColor = vec3(0.5, 0.85, 1.0) * fresnel * 1.5;
  vec3 specColor = vec3(1.0, 1.0, 1.0) * spec * 1.8;
  vec3 causticColor = vec3(0.3, 0.7, 1.0) * caustic * 0.5;

  vec3 finalColor = rimColor + specColor + causticColor;
  float alpha = clamp((fresnel * 0.7 + spec * 0.9 + caustic * 0.3) * uOpacity, 0.0, 0.85);

  gl_FragColor = vec4(finalColor, alpha);
}
