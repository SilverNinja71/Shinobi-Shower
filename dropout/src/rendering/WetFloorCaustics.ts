import * as THREE from 'three';
import { GRID_SIZE, STALL_HALF } from '../player/FloorInteraction.ts';
import type { TileGrid } from '../player/FloorInteraction.ts';

const BEAD_RES = 128;
export const MAX_RIPPLES = 8;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  #define TAU 6.28318530718
  uniform sampler2D tTiles;
  uniform sampler2D tBeads;
  uniform float uTime;
  uniform float uHalf;
  uniform float uDrainPull;
  uniform vec3 uPlayer;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  varying vec3 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  // Iterated domain warp: bright filaments where light paths bunch up, as under moving water.
  float caustic(vec2 uv, float t) {
    vec2 p = mod(uv * TAU, TAU) - 250.0;
    vec2 i = p;
    float c = 1.0;
    const float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - 3.5 / float(n + 1));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 8.0);
  }

  // What the glazed tile mirrors: a pale ceiling, a bright frosted window, the stall's pink walls.
  vec3 room(vec3 pos, vec3 dir) {
    float up = max(dir.y, 0.02);
    vec2 hit = pos.xz + dir.xz * ((8.0 - pos.y) / up);
    vec3 ceiling = mix(vec3(0.42, 0.30, 0.34), vec3(0.98, 0.93, 0.90), smoothstep(14.0, 2.0, length(hit)));
    vec2 w = abs(hit - vec2(1.5, -2.5)) - vec2(3.2, 2.0);
    float window = 1.0 - smoothstep(0.0, 0.5, max(w.x, w.y));
    float bars = smoothstep(0.03, 0.07, abs(fract(hit.x * 0.31) - 0.5));
    return ceiling + vec3(1.0, 0.98, 0.92) * window * bars * 0.62;
  }

  void main() {
    vec2 xz = vWorld.xz;
    vec2 p = xz + uHalf;
    vec2 cell = floor(p);
    vec2 f = p - cell;
    vec4 tile = texture2D(tTiles, (cell + 0.5) / (uHalf * 2.0));
    float wet = tile.r;
    float soap = smoothstep(0.42, 0.58, tile.g);
    float wetK = smoothstep(0.2, 0.3, wet);

    vec2 e = min(f, 1.0 - f);
    float edge = min(e.x, e.y);
    float grout = 1.0 - smoothstep(0.025, 0.045, edge);

    vec3 n = vec3(0.0, 1.0, 0.0);
    n.xz += sign(f - 0.5) * smoothstep(0.14, 0.03, e) * 0.22;

    float shade = hash(cell);
    vec3 pink = mix(vec3(0.925, 0.580, 0.635), vec3(0.965, 0.655, 0.675), shade);
    vec3 dryPink = pink * 0.55 + vec3(0.47, 0.43, 0.42);
    vec3 wetPink = pink * vec3(0.88, 0.76, 0.80);
    vec3 col = mix(dryPink, wetPink, wetK);

    // Soap reads as a pearly swirl, the one tile state with colour shift.
    float swirl = noise(xz * 3.1 + vec2(uTime * 0.12, -uTime * 0.09) + noise(xz * 1.7) * 3.0);
    vec3 pearl = vec3(0.70, 0.62, 0.95) + 0.13 * cos(TAU * (swirl * 1.6 + vec3(0.0, 0.33, 0.67)));
    col = mix(col, pearl * (0.84 + swirl * 0.26), soap);

    // Ripples tilt the surface where the ring passes.
    float rippleLight = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRipples[i];
      if (r.w <= 0.0) continue;
      vec2 d = xz - r.xy;
      float dist = length(d) + 0.0001;
      float ring = exp(-pow((dist - r.z) * 4.5, 2.0)) * r.w;
      n.xz += (d / dist) * ring * 0.55;
      rippleLight += ring;
    }

    // Standing water drawn from a blurred field, so nearby beads visibly merge into one puddle.
    vec2 bUv = p / (uHalf * 2.0);
    float texel = 1.0 / ${BEAD_RES}.0;
    float h = texture2D(tBeads, bUv).r;
    float hx = texture2D(tBeads, bUv + vec2(texel, 0.0)).r;
    float hz = texture2D(tBeads, bUv + vec2(0.0, texel)).r;
    float bead = smoothstep(0.34, 0.44, h);
    n.xz -= vec2(hx - h, hz - h) * bead * 7.0;
    col = mix(col, col * vec3(0.84, 0.74, 0.80), bead);

    n = normalize(n);
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 refl = reflect(-view, n);
    float fresnel = pow(1.0 - max(dot(n, view), 0.0), 3.0);
    float gloss = mix(0.03, mix(0.26, 0.10, soap), wetK) + bead * 0.28;
    col = mix(col, room(vWorld, refl), clamp(gloss + fresnel * wetK * 0.5, 0.0, 0.85));

    float c = caustic(xz * 0.13 + vec2(0.11, 0.07) * sin(uTime * 0.2), uTime * 0.55);
    col += vec3(0.95, 1.0, 0.98) * min(c, 1.2) * 0.42 * wetK * (1.0 - soap * 0.6);
    col += vec3(0.8, 0.95, 1.0) * rippleLight * 0.16;

    col = mix(col, vec3(0.34, 0.23, 0.27), grout * (1.0 - bead * 0.6));

    // The drain: water spiralling in, then a chrome collar and a dark throat.
    float r = length(xz);
    float angle = atan(xz.y, xz.x);
    float reach = 2.2 + uDrainPull * 0.34;
    float inflow = smoothstep(reach, 0.7, r);
    float spiral = sin(angle * 5.0 + log(r + 0.2) * 9.0 + uTime * (2.5 + uDrainPull));
    col *= 1.0 - inflow * 0.34;
    col += vec3(0.75, 0.95, 1.0) * max(spiral, 0.0) * inflow * 0.17;
    float collar = smoothstep(0.86, 0.82, r);
    vec3 chrome = mix(vec3(0.34, 0.37, 0.42), vec3(0.97, 0.98, 1.0), 0.5 + 0.5 * cos(angle * 2.0 - 0.9));
    col = mix(col, chrome, collar);
    float throat = smoothstep(0.64, 0.6, r);
    float slots = smoothstep(0.12, 0.2, abs(sin(angle * 4.0 + uTime * (0.5 + uDrainPull * 0.25))));
    vec3 hole = mix(vec3(0.05, 0.03, 0.07), vec3(0.45, 0.47, 0.52), slots * smoothstep(0.08, 0.2, r) * 0.65);
    col = mix(col, hole, throat);

    // Contact shadow for the player, tightening as they land.
    vec2 toPlayer = xz - uPlayer.xy;
    float blur = 0.42 + uPlayer.z * 0.3;
    float shadow = smoothstep(blur + 0.28, blur * 0.3, length(toPlayer * vec2(0.82, 1.0)));
    col *= 1.0 - shadow * 0.5 / (1.0 + uPlayer.z);

    // Corners and wall bases sit in shade.
    vec2 wall = uHalf - abs(xz);
    float ao = smoothstep(0.0, 1.5, min(wall.x, wall.y));
    col *= 0.68 + 0.32 * ao;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Floor material: reads the collision grid directly, so what you see is the friction you get. */
export class WetFloorCaustics {
  readonly material: THREE.ShaderMaterial;
  private readonly tileData = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
  private readonly tileTexture: THREE.DataTexture;
  private readonly beadField = new Float32Array(BEAD_RES * BEAD_RES);
  private readonly beadData = new Uint8Array(BEAD_RES * BEAD_RES);
  private readonly beadTexture: THREE.DataTexture;

  constructor() {
    this.tileTexture = new THREE.DataTexture(this.tileData, GRID_SIZE, GRID_SIZE, THREE.RGBAFormat);
    this.tileTexture.magFilter = this.tileTexture.minFilter = THREE.NearestFilter;

    this.beadTexture = new THREE.DataTexture(this.beadData, BEAD_RES, BEAD_RES, THREE.RedFormat);
    this.beadTexture.magFilter = this.beadTexture.minFilter = THREE.LinearFilter;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tTiles: { value: this.tileTexture },
        tBeads: { value: this.beadTexture },
        uTime: { value: 0 },
        uHalf: { value: STALL_HALF },
        uDrainPull: { value: 1 },
        uPlayer: { value: new THREE.Vector3(0, 0, 0) },
        uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4()) },
      },
    });
  }

  /** Adds a soft blob to the water field. Overlapping blobs cross the shader's threshold together and merge. */
  stampBead(x: number, z: number, radius: number, amount: number): void {
    const scale = BEAD_RES / (STALL_HALF * 2);
    const cx = (x + STALL_HALF) * scale;
    const cz = (z + STALL_HALF) * scale;
    const rad = radius * scale;
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(BEAD_RES - 1, Math.ceil(cx + rad));
    const z0 = Math.max(0, Math.floor(cz - rad));
    const z1 = Math.min(BEAD_RES - 1, Math.ceil(cz + rad));
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i - cx, j - cz) / rad;
        if (d >= 1) continue;
        const falloff = 1 - d * d;
        const idx = j * BEAD_RES + i;
        this.beadField[idx] = Math.min(1, this.beadField[idx] + amount * falloff * falloff);
      }
    }
  }

  update(dt: number, time: number, grid: TileGrid, drainPull: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uDrainPull.value = drainPull;

    for (let i = 0; i < grid.wet.length; i++) {
      this.tileData[i * 4] = grid.wet[i] * 255;
      this.tileData[i * 4 + 1] = grid.soap[i] * 255;
    }
    this.tileTexture.needsUpdate = true;

    // Evaporation keeps the field from saturating under constant spray.
    const keep = Math.exp(-0.32 * dt);
    for (let i = 0; i < this.beadField.length; i++) {
      this.beadField[i] *= keep;
      this.beadData[i] = this.beadField[i] * 255;
    }
    this.beadTexture.needsUpdate = true;
  }

  setPlayer(x: number, z: number, y: number): void {
    (this.material.uniforms.uPlayer.value as THREE.Vector3).set(x, z, y);
  }

  setRipple(index: number, x: number, z: number, r: number, amp: number): void {
    (this.material.uniforms.uRipples.value as THREE.Vector4[])[index].set(x, z, r, amp);
  }
}
