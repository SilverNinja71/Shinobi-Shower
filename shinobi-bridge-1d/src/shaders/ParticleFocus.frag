// The focus cut: one stroke across the whole sky. A white-hot hairline races out from the blade, fastest
// ahead of the warrior, with a hot spark at its head; behind it a cold glow and a crimson haze (the
// fifth tier's colour) linger and fade. Drawn additively in linear HDR, so the core blooms.
uniform float uAge;
/** +1 when the cut runs toward +x on screen, −1 toward −x. */
uniform float uDir;
/** Where the blade is along the quad (0–1). */
uniform float uOrigin;
/** Size of the quad in metres (length, height). */
uniform vec2 uSize;
uniform float uFade;
varying vec2 vUv;

/** How fast the line is drawn, in metres per second. */
const float SPEED = 420.0;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  // Metres ahead of the blade along the cut, and metres above or below the line.
  float ahead = (vUv.x - uOrigin) * uSize.x * uDir;
  float d = (vUv.y - 0.5) * uSize.y;
  float ad = abs(d);

  float front = uAge * SPEED;
  float back = -uAge * SPEED * 0.55;
  float drawn = smoothstep(front + 0.6, front - 0.4, ahead) * smoothstep(back - 0.6, back + 0.4, ahead);

  // The hairline thins as it cools; the glows outlast it. Everything dies away before the quad's rim.
  float rim = 1.0 - smoothstep(0.55, 1.0, ad / (0.5 * uSize.y));
  float width = 0.012 + 0.05 * exp(-uAge / 0.06);
  float core = exp(-(d * d) / (width * width)) * (exp(-uAge / 0.12) + 0.1);
  float glow = exp(-ad / 0.09) * exp(-uAge / 0.25);
  float haze = exp(-ad / 0.3) * exp(-uAge / 0.32) * rim;
  // Cut drops along the line catch the flash and wink out at their own moments.
  float cell = floor(ahead * 2.5);
  float fleck = step(0.72, hash11(cell + 17.0)) * exp(-pow((fract(ahead * 2.5) - 0.5) * 6.0, 2.0) - ad * ad * 900.0);
  fleck *= exp(-max(0.0, uAge - 0.12 * hash11(cell)) / 0.08);

  vec3 color = vec3(1.0, 0.97, 0.94) * core * 16.0 + vec3(0.72, 0.8, 1.0) * glow * 2.0 + vec3(1.0, 0.1, 0.2) * haze * 0.8;
  color += vec3(1.0, 0.92, 0.9) * fleck * 4.0;
  color *= drawn;

  // A spark rides the head of the line, and a burst marks where the blade left it.
  vec2 head = vec2(ahead - front, d * 3.0);
  color += vec3(1.0, 0.95, 0.9) * exp(-dot(head, head) / 0.5) * 6.0 * step(uAge, 0.12);
  vec2 hilt = vec2(ahead, d * 2.2);
  color += vec3(1.0, 0.45, 0.45) * exp(-length(hilt) / 0.35) * 2.5 * exp(-uAge / 0.12);

  gl_FragColor = vec4(color * uFade, 1.0);
}
