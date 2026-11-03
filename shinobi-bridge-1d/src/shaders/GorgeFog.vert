// Gorge fog. Without WISP: horizontal sheets at fixed depths (aLayer 0 = highest … 1 = deepest).
// With WISP: instanced vertical billboards that rise, drift with the wind and fade in and out.
varying vec3 vWorld;
varying float vLayer;

#ifdef WISP
attribute vec3 aCenter;
attribute vec2 aSize;
attribute float aSeed;
uniform float uTime;
uniform vec2 uDrift;
uniform float uSpan;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
#else
attribute float aLayer;
#endif

void main() {
#ifdef WISP
  vec3 c = aCenter;
  // Drift along x with the wind, wrapping over a span wider than the gorge; the wrap is hidden
  // behind a fade at the span's ends (and behind the cliffs).
  float x = c.x + uDrift.x * (0.5 + aSeed * 0.6);
  c.x = mod(x + uSpan, uSpan * 2.0) - uSpan;
  vFade = (1.0 - smoothstep(uSpan * 0.7, uSpan, abs(c.x)));
  c.y += sin(uTime * 0.07 + aSeed * 6.28) * 3.0;
  // Face the camera around the vertical axis; the camera always looks down −z, so x is "right".
  vec3 world = c + vec3(position.x * aSize.x, position.y * aSize.y, 0.0);
  vUv = position.xy + 0.5;
  vSeed = aSeed;
  vLayer = clamp(-c.y / 90.0, 0.0, 1.0);
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
#else
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vLayer = aLayer;
  gl_Position = projectionMatrix * viewMatrix * world;
#endif
}
