// Snow clumps (see SnowClumps.ts), spliced into three's standard material after its common chunk;
// clumpRim() is added to the outgoing light just before the final colour is written. Packed snow
// scatters light through its surface: a soft cold rim where the clump turns away from the camera, and
// a faint lift of its shadowed side, keep it white against the night when the moon is behind it.
// Lightning floods it.

uniform float uLightning;
uniform vec3 uRimColor;

vec3 clumpRim(vec3 n, vec3 viewPos, vec3 albedo) {
  float facing = clamp(dot(n, normalize(viewPos)), 0.0, 1.0);
  float rim = pow(1.0 - facing, 2.0);
  return (uRimColor * rim + albedo * 0.32) * (1.0 + uLightning * 3.0);
}
