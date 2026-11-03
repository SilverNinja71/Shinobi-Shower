// Distant ranges. aRange is 0 (near), 1 (middle) or 2 (far): it sets the snowline and haze.
attribute float aRange;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vRange;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vRange = aRange;
  gl_Position = projectionMatrix * viewMatrix * world;
}
