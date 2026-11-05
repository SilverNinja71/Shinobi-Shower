precision highp float;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPosition;
varying vec2 vUv;

uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);

  // Rim glow
  float fresnel = pow(1.0 - abs(dot(N, V)), 2.0);

  // Traveling quantum probability waves
  float wave1 = sin(vUv.x * 24.0 - uTime * 9.0);
  float wave2 = cos(vUv.x * 48.0 + uTime * 14.0);
  float waveInterference = (wave1 + wave2) * 0.25 + 0.5;

  // Color gradient
  vec3 col = mix(uColorA, uColorB, waveInterference);
  col += vec3(1.0, 1.0, 1.0) * pow(fresnel, 3.0) * 0.8;

  float alpha = clamp((fresnel * 0.7 + waveInterference * 0.3) * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}

