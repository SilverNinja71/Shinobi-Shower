// Flat marks and small effects (see StormMarks.ts): hail warnings on the deck, the sweet-spot box, and
// the splashes and puffs of landing drops. Every instance is a quad the CPU has already oriented:
// along the swaying deck for marks lying on it, facing the camera for the rest.
//
// StormCommon.glsl and StormVertex.glsl are prepended.

attribute vec3 aCenter;
attribute vec3 aU;      // half-extent along the quad's x
attribute vec3 aV;      // half-extent along the quad's y
attribute vec4 aParams; // x: type; y: progress (0–1); z: intensity; w: per-type extra

varying vec2 vQ;
varying vec4 vParams;
varying float vFade;

void main() {
  vec3 p = aCenter + aU * position.x + aV * position.y;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vQ = position.xy;
  vParams = aParams;
  vFade = stormFogFade(-mv.z);
}
