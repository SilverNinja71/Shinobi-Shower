import * as THREE from 'three';
import type { Box } from '../core/Level.ts';

export const KIND = { tile: 0, chrome: 1, soap: 2, curtain: 3, bottle: 4 } as const;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normal;
    vLocal = position;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uKind;
  uniform float uTime;
  uniform vec2 uBand;
  uniform vec3 uSize;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vLocal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Reflected room: a bright skylight overhead, shading to deep bottle green below.
  vec3 room(vec3 d) {
    vec3 c = mix(vec3(0.22, 0.42, 0.42), vec3(0.90, 0.98, 0.93), smoothstep(-0.6, 0.6, d.y));
    float sky = smoothstep(0.82, 0.92, d.y);
    return c + vec3(1.0, 0.98, 0.9) * sky * 0.7;
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 view = normalize(cameraPosition - vWorld);
    vec2 uv = abs(n.x) > 0.5 ? vWorld.zy : abs(n.z) > 0.5 ? vWorld.xy : vWorld.xz;

    if (uKind > 0.5 && uKind < 1.5) {
      vec3 refl = reflect(-view, n);
      vec3 c = room(refl);
      float band = 0.5 + 0.5 * sin(refl.y * 9.0 + refl.x * 4.0);
      gl_FragColor = vec4(mix(c * 0.55, c * 1.15 + 0.08, band), 1.0);
      return;
    }
    if (uKind > 1.5 && uKind < 2.5) {
      float swirl = sin(uv.x * 2.7 + sin(uv.y * 3.1 + uTime * 0.4) * 1.5);
      vec3 pearl = mix(vec3(0.82, 0.74, 0.95), vec3(0.98, 0.90, 0.96), 0.5 + 0.5 * swirl);
      vec3 refl = reflect(-view, n);
      pearl = mix(pearl, room(refl), 0.22);
      gl_FragColor = vec4(pearl * (0.8 + 0.2 * max(n.y, 0.0)), 1.0);
      return;
    }
    if (uKind > 2.5 && uKind < 3.5) {
      float folds = sin(uv.x * 2.6 + sin(uTime * 0.7 + uv.y * 0.3) * 1.2);
      vec3 c = mix(vec3(0.72, 0.80, 0.86), vec3(0.95, 0.97, 0.97), 0.5 + 0.5 * folds);
      float stripe = step(0.72, fract(uv.x * 0.25));
      c = mix(c, vec3(0.20, 0.32, 0.50), stripe * 0.55);
      gl_FragColor = vec4(c, 1.0);
      return;
    }
    if (uKind > 3.5) {
      vec3 c = mix(vec3(0.85, 0.42, 0.34), vec3(0.97, 0.63, 0.46), 0.5 + 0.5 * n.x);
      gl_FragColor = vec4(c, 1.0);
      return;
    }

    float size = 1.5;
    vec2 q = uv / size;
    vec2 cell = floor(q);
    vec2 f = q - cell;
    vec2 e = min(f, 1.0 - f);
    float grout = 1.0 - smoothstep(0.008, 0.016, min(e.x, e.y));

    vec3 shade = mix(vec3(0.62, 0.86, 0.76), vec3(0.72, 0.91, 0.82), hash(cell));
    float wet = 0.0;
    if (vWorld.y > uBand.x && vWorld.y < uBand.y) {
      wet = 1.0;
      float streak = hash(vec2(floor(uv.x * 2.5), 7.0));
      float run = fract(uv.y * 0.35 + uTime * (0.25 + streak * 0.7) + streak * 8.0);
      shade = mix(vec3(0.15, 0.42, 0.45), vec3(0.28, 0.58, 0.60), run * run);
    }

    vec3 tilted = n;
    if (abs(n.y) > 0.5) tilted.xz += sign(f - 0.5) * smoothstep(0.12, 0.02, e) * 0.2;
    else tilted += vec3(sign(f.x - 0.5), sign(f.y - 0.5), 0.0).xzy * smoothstep(0.12, 0.02, e.x) * 0.1;
    tilted = normalize(tilted);
    vec3 refl = reflect(-view, tilted);
    float fresnel = pow(1.0 - max(dot(tilted, view), 0.0), 3.0);
    float gloss = mix(0.14, 0.48, wet) + fresnel * 0.42;
    vec3 c = shade * (0.74 + 0.26 * max(n.y, 0.0) + 0.1 * abs(n.x));
    c = mix(c, room(refl), clamp(gloss, 0.0, 0.8));
    c = mix(c, vec3(0.24, 0.42, 0.42), grout);

    // The basin sits in shadow, and it gets lighter as you climb.
    c *= 0.8 + 0.2 * smoothstep(0.0, 40.0, vWorld.y);

    // Cream edging on every ledge top shows where a jump can land.
    if (n.y > 0.5 && uSize.x < 40.0) {
      vec2 edge = 0.5 * uSize.xz - abs(vLocal.xz) * uSize.xz;
      float rim = 1.0 - smoothstep(0.1, 0.16, min(edge.x, edge.y));
      c = mix(c, vec3(0.99, 0.95, 0.84), rim);
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** Each box gets its own uniforms. They share one compiled program. */
export function tileMaterial(box: Box, kind: number, time: { value: number }): THREE.ShaderMaterial {
  const band = box.wetBands[0] ?? [1e6, -1e6];
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uKind: { value: kind },
      uTime: time,
      uBand: { value: new THREE.Vector2(band[0], band[1]) },
      uSize: {
        value: new THREE.Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z),
      },
    },
  });
}

export const waterMaterial = (time: { value: number }) =>
  new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      float wave(vec2 p, float t) {
        return sin(p.x * 1.3 + t) * 0.5 + sin(p.y * 1.7 - t * 1.2) * 0.5 + sin((p.x + p.y) * 2.3 + t * 0.7) * 0.3;
      }
      void main() {
        vec2 p = vWorld.xz;
        float r = length(p);
        float a = atan(p.y, p.x);
        // The whirlpool: everything in the basin winds down to the central drain.
        float spiral = sin(a * 4.0 + log(r + 0.5) * 7.0 + uTime * 2.4);
        float h = wave(p * 0.7, uTime * 1.3) + spiral * smoothstep(26.0, 4.0, r) * 0.8;
        vec3 deep = vec3(0.04, 0.17, 0.25);
        vec3 lit = vec3(0.14, 0.50, 0.56);
        vec3 c = mix(deep, lit, smoothstep(-0.9, 1.3, h));
        c += vec3(0.8, 0.95, 0.92) * smoothstep(1.05, 1.4, h) * 0.3;
        c = mix(c, vec3(0.01, 0.03, 0.05), smoothstep(5.0, 1.2, r));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    uniforms: { uTime: time },
  });
