import * as THREE from 'three';
import { MOON_DIR } from './palette.ts';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A simplified storm sky in linear radiance: a dim gradient, mottled cloud, a black gorge below the
// horizon and the moon as a small hot spot, so glossy wet surfaces catch a glint from it.
const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uMoonDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zenith = vec3(0.010, 0.013, 0.020);
  vec3 horizon = vec3(0.034, 0.042, 0.060);
  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.7, max(h, 0.0)));
  vec2 cp = d.xz / (max(h, 0.0) + 0.1);
  col *= 0.7 + 0.6 * texture2D(uNoise, cp * 0.1).r;
  col = mix(col, vec3(0.006, 0.007, 0.009), (1.0 - smoothstep(-0.25, 0.02, h)));
  float a = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  col += vec3(0.78, 0.84, 1.0) * (exp(-a * 38.0) * 5.0 + exp(-a * 7.0) * 0.12);
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Bakes the storm sky into a prefiltered environment map for wet reflections. The radiance is kept
 * at night levels at the source (r158 has no scene-wide environment intensity), so reflections
 * stay dim everywhere except the moon's glint.
 */
export function bakeEnvironment(renderer: THREE.WebGLRenderer, noise: THREE.Texture): THREE.Texture {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uNoise: { value: noise }, uMoonDir: { value: MOON_DIR } },
    side: THREE.BackSide,
    depthWrite: false,
  });
  const geometry = new THREE.SphereGeometry(10, 48, 24);
  scene.add(new THREE.Mesh(geometry, material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 50);
  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  return target.texture;
}
