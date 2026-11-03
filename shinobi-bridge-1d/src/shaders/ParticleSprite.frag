// VFX sprites (SpritePool.ts), drawn into the soft layer with premultiplied "over" blending: colour is
// premultiplied by coverage, and coverage 0 simply adds light, so steam, sparks and flashes share one
// draw. Every sprite fades out where it meets the scene behind it (softDepthFade, from SoftLayer.ts,
// prepended to this file) and into the fog.
//   PUFF    steam, mist, dust, snow powder: a lumpy billow from the atlas, lit by the moon through its
//           own thickness (thin edges glow, the dense core shades), plus any heat glow it was born with
//   STREAK  a droplet, a spark or a glint, motion-blurred along its flight, brightest at the head
//   GLOW    a round burst of light
//   SHARD   a tumbling splinter of spirit light, brightest along its edges
//   RING    a shock front spreading out
//   FLARE   a star of light with long horizontal rays

uniform sampler2D tPuff;
uniform float uLightning;
/** Moonlight reaching a puff from behind (linear colour × strength). */
uniform vec3 uMoon;
/** Skylight filling a puff from every side. */
uniform vec3 uSky;

varying vec2 vCorner;
varying vec4 vColor;
varying vec3 vGlow;
varying vec4 vInfo;
varying vec2 vLight;
varying float vViewZ;

#include <fog_pars_fragment>

void main() {
  float shape = vInfo.x;
  float t = vInfo.y;
  float seed = vInfo.z;
  vec2 c = vCorner;
  float r2 = dot(c, c);
  vec3 color;
  float cover = 0.0;
  float softness;

  if (shape < 0.5) {
    // One of the four puffs in the atlas, picked by the seed.
    vec2 cell = floor(fract(vec2(seed * 7.0, seed * 13.0)) * 2.0) * 0.5;
    vec2 uv = cell + (c * 0.5 + 0.5) * 0.5;
    float d = texture2D(tPuff, uv).r;
    // How much vapour lies between this point and the moon: little at the edges facing it.
    float toward = texture2D(tPuff, uv + vLight * 0.05).r;
    float fade = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.4, 1.0, t));
    cover = d * vColor.a * fade;
    vec3 light = uSky + uMoon * (0.2 + exp(-toward * 2.8)) * (1.0 + 2.5 * uLightning);
    color = vColor.rgb * light * cover + vGlow * d * fade;
    softness = 0.6;
  } else if (shape < 1.5) {
    float across = 1.0 - smoothstep(0.0, 1.0, abs(c.x));
    float along = (1.0 - smoothstep(0.5, 1.0, abs(c.y))) * mix(0.3, 1.0, c.y * 0.5 + 0.5);
    float fade = 1.0 - smoothstep(0.5, 1.0, t);
    float m = across * across * along * fade * vInfo.w;
    color = (vColor.rgb * (1.0 + 1.5 * uLightning) + vGlow) * m;
    cover = vColor.a * m;
    softness = 0.08;
  } else if (shape < 2.5) {
    // The wide term would still be ~8% bright where the quad ends; window it to zero inside the quad,
    // or bright HDR glows (and the bloom on them) show the quad as a square.
    float g = (exp(-r2 * 5.0) + 0.35 * exp(-r2 * 1.6)) * (1.0 - smoothstep(0.45, 1.0, r2));
    float fade = 1.0 - t;
    color = (vColor.rgb + vGlow) * g * fade * fade * vInfo.w;
    softness = 0.3;
  } else if (shape < 3.5) {
    // Triangle with corners (0, 1), (−0.87, −0.5), (0.87, −0.5): distance inside its nearest edge.
    float e = min(0.5 + c.y, min(0.5 - dot(c, vec2(0.866, 0.5)), 0.5 - dot(c, vec2(-0.866, 0.5))));
    if (e < 0.0) discard;
    float edge = exp(-e / 0.06);
    float fade = 1.0 - smoothstep(0.35, 1.0, t);
    color = (vColor.rgb * (0.3 + edge * 1.6) + vGlow) * fade * vInfo.w;
    cover = vColor.a * fade;
    softness = 0.15;
  } else if (shape < 4.5) {
    float r = sqrt(r2);
    float bandX = (r - 0.8) / 0.1;
    float band = exp(-bandX * bandX);
    float fade = 1.0 - t;
    color = (vColor.rgb + vGlow) * band * fade * fade;
    cover = vColor.a * band * fade;
    softness = 0.3;
  } else {
    float core = exp(-r2 * 22.0);
    float rays = exp(-abs(c.y) * 70.0) * (1.0 - abs(c.x)) + exp(-abs(c.x) * 70.0) * (1.0 - abs(c.y)) * 0.35;
    float halo = exp(-r2 * 3.5) * 0.2;
    float fade = 1.0 - smoothstep(0.0, 1.0, t);
    color = (vColor.rgb + vGlow) * (core * 2.0 + rays + halo) * fade * fade;
    softness = 0.2;
  }

  float visible = softDepthFade(vViewZ, softness);
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  color = mix(color, fogColor * cover, fogFactor);
#endif
  gl_FragColor = vec4(color * visible, cover * visible);
}
