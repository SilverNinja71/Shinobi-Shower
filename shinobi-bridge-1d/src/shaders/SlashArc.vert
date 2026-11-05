// Slash crescent: one strip per cutting arc, laid out on the GPU so its extent is exactly the
// simulation's cutting box: from just behind the warrior to the arc's reach, and from ARC_LOW to
// ARC_HIGH above the feet. The sweep runs over the warrior's head and down in front of them.
//
// aArc: x = position along the sweep (0 start → 1 end), y = across the band (0 inner → 1 outer),
//       z = which arc (0 the facing side, 1 the back side when three blades cut both ways).

attribute vec3 aArc;

uniform vec3 uOrigin;      // world position of the feet
uniform float uFacing;     // +1 or -1: side of the first arc
uniform float uReach;      // metres in front of the warrior
uniform float uLow;        // band bottom above the feet
uniform float uHigh;       // band top above the feet
uniform float uPivot;      // height of the sweep's centre above the feet
uniform float uDescend;    // 1: overhead → low front; 0: low front → overhead
uniform float uArcs;       // 1 or 2
uniform float uDepth;      // offset toward the camera so the light sits in front of the body
uniform float uAngle;      // aim angle in radians (pitch above/below horizon)

varying vec2 vArc;
varying float vSide;

#include <common>
#include <fog_pars_vertex>

void main() {
  float second = step(0.5, aArc.z);
  float side = mix(uFacing, -uFacing, second);
  float s = mix(1.0 - aArc.x, aArc.x, uDescend);
  // +95° (above, just behind) through 0° (straight ahead) to −95° (at the feet, just behind).
  float a = mix(1.66, -1.66, s);
  float up = a >= 0.0 ? (uHigh - uPivot) : (uPivot - uLow);
  // A crescent: thickest mid-sweep, pointed at both ends.
  float thick = 0.5 * pow(max(sin(PI * aArc.x), 0.0), 0.7) + 0.04;
  float k = mix(1.0 - thick, 1.0, aArc.y);
  float rx = side * uReach * cos(a) * k;
  float ry = up * sin(a) * k;

  // Rotate around pivot by aim angle
  float cosAng = cos(uAngle);
  float sinAng = sin(uAngle);
  float rotX = rx * cosAng - (side * ry) * sinAng;
  float rotY = (side * rx) * sinAng + ry * cosAng;

  vec3 p = uOrigin + vec3(rotX, uPivot + rotY, uDepth);
  // The unused second arc collapses to nothing.
  p = mix(p, uOrigin, second * step(uArcs, 1.5));
  vArc = aArc.xy;
  vSide = second;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
