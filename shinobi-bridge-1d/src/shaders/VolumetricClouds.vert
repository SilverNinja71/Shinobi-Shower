varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDir;
varying vec2 vUv;

uniform float uTime;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  
  // Subtle billow pulsation
  vec3 pos = position;
  float swell = sin(pos.x * 0.4 + uTime * 0.5) * cos(pos.z * 0.4 + uTime * 0.4) * 0.35;
  pos += normal * swell;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPosition = worldPos.xyz;
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
