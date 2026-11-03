import * as THREE from 'three';

const ASSETS = 'assets/';
const loader = new THREE.TextureLoader();

/** Loads a texture. Until it arrives the surface shows its plain colour, so a slow connection still plays. */
export function texture(path: string, srgb = false, flipY = true): THREE.Texture {
  const t = loader.load(ASSETS + path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.flipY = flipY;
  return t;
}

export interface SurfaceOptions {
  set: string;
  tint: number;
  roughness?: number;
  /** Height range that runs with water: darker, glossier and streaked. */
  wetBand?: [number, number];
  time?: { value: number };
}

/**
 * A PBR surface from one of the Poly Haven sets, with its colour replaced by a tint.
 * The texture's light and dark detail survives, so one mosaic can be glazed in any colour.
 */
export function glazed(opts: SurfaceOptions): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: texture(`world/${opts.set}_d.jpg`, true),
    normalMap: texture(`world/${opts.set}_n.jpg`),
    roughnessMap: texture(`world/${opts.set}_r.jpg`),
    roughness: opts.roughness ?? 0.7,
    envMapIntensity: 1,
  });
  mat.normalScale.set(0.8, 0.8);
  const tint = new THREE.Color(opts.tint);
  const band = opts.wetBand ?? [1e6, -1e6];
  const time = opts.time ?? { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = { value: tint };
    shader.uniforms.uBand = { value: new THREE.Vector2(band[0], band[1]) };
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nuniform vec3 uTint;\nuniform vec2 uBand;\nuniform float uTime;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float glazeLum = dot(sampledDiffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = uTint * (0.35 + glazeLum * 2.1);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (vWorldP.y > uBand.x && vWorldP.y < uBand.y) {
          float lane = floor((vWorldP.x + vWorldP.z) * 2.2);
          float seed = fract(sin(lane * 12.9898) * 43758.5453);
          float run = fract(vWorldP.y * 0.3 + uTime * (0.3 + seed * 0.7) + seed * 7.0);
          diffuseColor.rgb *= vec3(0.34, 0.5, 0.55) + run * run * 0.25;
          roughnessFactor = 0.06 + run * 0.1;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'glazed';
  return mat;
}

/** Box geometry whose UVs come from world position, so tiles stay square and line up across boxes. */
export function worldBox(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }, repeat: number): THREE.BufferGeometry {
  const sx = max.x - min.x;
  const sy = max.y - min.y;
  const sz = max.z - min.z;
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const cz = (min.z + max.z) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const y = pos.getY(i) + cy;
    const z = pos.getZ(i) + cz;
    if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, z / repeat, y / repeat);
    else if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, x / repeat, z / repeat);
    else uv.setXY(i, x / repeat, y / repeat);
  }
  return geo;
}

/**
 * An image-based light of the room: a pale jade box with a blown-out skylight and a strip of window,
 * so chrome, glaze and wet tile all have something real to reflect.
 */
export function bathroomEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const room = new THREE.Scene();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(40, 30, 40),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main() {
          float h = clamp(vP.y / 15.0 * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(vec3(0.03, 0.09, 0.1), vec3(0.42, 0.62, 0.57), h);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  room.add(walls);
  const glow = (color: number, power: number, w: number, d: number, x: number, y: number, z: number, rx: number, ry = 0) => {
    const c = new THREE.Color(color).multiplyScalar(power);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    room.add(m);
  };
  glow(0xfff4dd, 16, 18, 12, 2, 14.5, -2, Math.PI / 2);
  glow(0xcfeaff, 5, 3, 14, -19.5, 6, 6, 0, Math.PI / 2);
  glow(0xffd9a8, 3, 12, 2.5, 8, 4, 19.5, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();
  return env;
}
