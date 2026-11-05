varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDir;
varying vec3 vLocalPosition;

uniform float uTime;
uniform float uDisplacement;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vLocalPosition = position;

  // Quantum surface oscillation: high-frequency standing wave harmonics
  float wave = sin(position.x * 8.0 + uTime * 5.0) 
             * cos(position.y * 8.0 + uTime * 4.2) 
             * sin(position.z * 8.0 + uTime * 6.1);
  vec3 displaced = position + normal * (wave * uDisplacement);

  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vWorldPosition = worldPos.xyz;
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
