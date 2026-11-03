// Cosmetic rain streak (see RainSheet.vert). Pure added light: at night rain is seen only by what it
// catches, the moon behind the storm and the lightning, so the streak adds colour and hides nothing.
// Each streak is one triangle tapering from its head to a point at its tail.

uniform vec3 uColor;

varying vec2 vUv; // x: −1..1 across the head, narrowing to 0 at the tail; y: 0 at the head, 1 at the tail
varying float vAlpha;
varying float vVeil;

void main() {
  // Across the streak at this point along it, −1..1 whatever the taper.
  float u = vUv.x / max(1.0 - vUv.y, 0.02);
  float across = max(0.0, 1.0 - u * u);
  // Brightest just behind the head, fading out toward the tail like a drop's motion blur.
  float along = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  // A veil has no edges or ends to see: a soft ellipse inside the triangle, long along the fall.
  vec2 e = vec2(vUv.x / 0.5, (vUv.y - 0.4) / 0.4);
  float veil = max(0.0, 1.0 - dot(e, e));
  float light = mix(across * along, veil * veil, vVeil) * vAlpha;
  // Most of a thin streak's pixels are its faint edges and tail: skip their blending.
  if (light < 0.004) discard;
  gl_FragColor = vec4(uColor * light, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
