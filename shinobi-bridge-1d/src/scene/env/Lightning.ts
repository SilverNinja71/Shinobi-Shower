import * as THREE from 'three';
import { Random } from './noise.ts';

const MAX_STROKES = 4;
/** The faint stepped leader that runs before the first return stroke. */
const LEADER = 0.035;

/**
 * A lightning flash as the eye sees it: a faint leader, then 2–4 return strokes over about 0.4 s,
 * each a near-instant spike that dies within tens of milliseconds, while the cloud it lit keeps an
 * afterglow that fades over half a second.
 */
export class LightningFlash {
  /** 0–1: overall brightness right now (what uLightning carries). */
  value = 0;
  /** 0–1: the bolt channel alone, which only glows during strokes. */
  channel = 0;
  power = 0;
  private age = Infinity;
  private strokes = 0;
  private readonly at = new Float32Array(MAX_STROKES);
  private readonly amp = new Float32Array(MAX_STROKES);
  private readonly decay = new Float32Array(MAX_STROKES);
  private readonly rng = new Random(0x5717);

  strike(power: number): void {
    const r = this.rng;
    // A second strike during a flash never dims it.
    this.power = Math.max(power, this.value > 0.05 ? this.power : 0);
    this.age = 0;
    this.strokes = 2 + Math.floor(r.next() * 3);
    let t = LEADER;
    for (let i = 0; i < this.strokes; i++) {
      this.at[i] = t;
      this.amp[i] = i === 0 ? 1 : r.range(0.45, 0.95);
      this.decay[i] = r.range(0.035, 0.07);
      t = Math.min(0.36, t + r.range(0.05, 0.13));
    }
  }

  update(dt: number): void {
    const before = this.age;
    this.age += dt;
    const t = this.age;
    if (!Number.isFinite(t) || t > 1.6) {
      this.value = this.channel = 0;
      return;
    }
    let spike = 0;
    let channel = 0;
    for (let i = 0; i < this.strokes; i++) {
      const at = this.at[i];
      if (t < at) continue;
      // A stroke rises within a millisecond or two. One that struck during this frame shows at its
      // peak, so even at a low frame rate no stroke slips by between two frames unseen.
      const after = at > before ? 0 : t - at;
      spike = Math.max(spike, this.amp[i] * Math.exp(-after / this.decay[i]));
      // The channel lingers on the eye a little longer than the light it throws.
      channel = Math.max(channel, this.amp[i] * Math.exp(-after / 0.09));
    }
    const leader = t < LEADER ? (t / LEADER) * 0.1 : 0;
    const glow = t >= LEADER ? 0.24 * Math.exp(-(t - LEADER) / 0.24) : 0;
    this.value = Math.min(1, this.power * (Math.max(spike, leader) + glow));
    this.channel = Math.min(1, channel);
  }
}

/* ---------------- The visible bolt ---------------- */

const MAIN_LEVELS = 6; // 64 segments
const BRANCH_LEVELS = 4; // 16 segments
const MAX_BRANCHES = 3;
const MAX_SEGMENTS = (1 << MAIN_LEVELS) + MAX_BRANCHES * (1 << BRANCH_LEVELS);

const BOLT_VERT = /* glsl */ `
attribute vec3 aRibbon; // across (-1..1), along (0..1), brightness
varying vec3 vRibbon;
void main() {
  vRibbon = aRibbon;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BOLT_FRAG = /* glsl */ `
uniform float uChannel;
uniform float uMist;
uniform vec3 uColor;
varying vec3 vRibbon;
void main() {
  float x = vRibbon.x;
  // A white-hot core inside a soft violet-blue sheath of glowing air.
  float core = exp(-x * x * 55.0);
  float sheath = exp(-x * x * 4.0);
  // Channels thin out toward their tips.
  float taper = 1.0 - 0.6 * vRibbon.y;
  float k = vRibbon.z * taper * uChannel * (1.0 - 0.6 * uMist);
  vec3 col = uColor * core * 6.0 + vec3(0.42, 0.45, 1.0) * sheath * 0.35;
  gl_FragColor = vec4(col * k, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * A jagged cloud-to-ground bolt far behind the peaks, built by midpoint displacement into a fixed
 * ribbon buffer when a strong strike lands, and drawn additively. The near ranges hide its foot.
 * The camera always looks down −z at it from hundreds of metres, so the ribbon simply lies in xy.
 */
export class LightningBolt {
  readonly mesh: THREE.Mesh;
  readonly uniforms: { uChannel: { value: number }; uMist: { value: number }; uColor: { value: THREE.Color } };
  private readonly positions = new Float32Array(MAX_SEGMENTS * 6 * 3);
  private readonly ribbon = new Float32Array(MAX_SEGMENTS * 6 * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly rng = new Random(0xb017);
  /** Scratch polylines, reused for every bolt. */
  private readonly main = new Float32Array(((1 << MAIN_LEVELS) + 1) * 3);
  private readonly fork = new Float32Array(((1 << BRANCH_LEVELS) + 1) * 3);
  private readonly sideA = new THREE.Vector2();
  private readonly sideB = new THREE.Vector2();
  private count = 0;

  constructor(mist: { value: number }, color: THREE.Color) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aRibbon', new THREE.BufferAttribute(this.ribbon, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.uniforms = { uChannel: { value: 0 }, uMist: mist, uColor: { value: color } };
    const material = new THREE.ShaderMaterial({
      vertexShader: BOLT_VERT,
      fragmentShader: BOLT_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'env-bolt';
    this.mesh.frustumCulled = false;
    // Before the gorge fog (−20), which lies between the bolt and the camera and veils its foot.
    this.mesh.renderOrder = -30;
  }

  /**
   * Shows or hides the last bolt. Hiding empties the draw range rather than the mesh's visibility,
   * so the program is compiled on the very first frame instead of stalling the first strike.
   */
  show(on: boolean): void {
    this.geometry.setDrawRange(0, on ? this.count : 0);
  }

  /** Builds a new bolt from `top` (the cloud base) down to `bottomY`, with one to three forks. */
  build(top: THREE.Vector3, bottomY: number): void {
    const r = this.rng;
    const p = this.main;
    const n = 1 << MAIN_LEVELS;
    const height = top.y - bottomY;
    p[0] = top.x;
    p[1] = top.y;
    p[2] = top.z;
    p[n * 3] = top.x + r.spread(height * 0.25);
    p[n * 3 + 1] = bottomY;
    p[n * 3 + 2] = top.z + r.spread(40);
    this.displace(p, n, 0.42);
    this.count = 0;
    const width = height * 0.0085;
    this.ribbonFrom(p, n, width, 1);
    // Forks leave the main channel and run downward and outward, dimmer and thinner.
    const forks = 1 + Math.floor(r.next() * MAX_BRANCHES);
    const m = 1 << BRANCH_LEVELS;
    const q = this.fork;
    for (let k = 0; k < forks; k++) {
      const i = Math.floor(r.range(0.15, 0.65) * n);
      const len = height * r.range(0.18, 0.4);
      const dir = r.chance(0.5) ? 1 : -1;
      q[0] = p[i * 3];
      q[1] = p[i * 3 + 1];
      q[2] = p[i * 3 + 2];
      q[m * 3] = q[0] + dir * len * r.range(0.4, 0.9);
      q[m * 3 + 1] = q[1] - len * r.range(0.6, 1.0);
      q[m * 3 + 2] = q[2] + r.spread(20);
      this.displace(q, m, 0.5);
      this.ribbonFrom(q, m, width * 0.6, r.range(0.35, 0.6));
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aRibbon.needsUpdate = true;
  }

  /** Midpoint displacement in place: each midpoint is kicked sideways by a share of its span. */
  private displace(p: Float32Array, n: number, rough: number): void {
    const r = this.rng;
    for (let step = n; step > 1; step >>= 1) {
      const half = step >> 1;
      for (let i = 0; i < n; i += step) {
        const a = i * 3;
        const b = (i + step) * 3;
        const m = (i + half) * 3;
        const span = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
        p[m] = (p[a] + p[b]) * 0.5 + r.spread(span * rough * 0.5);
        p[m + 1] = (p[a + 1] + p[b + 1]) * 0.5 + r.spread(span * rough * 0.12);
        p[m + 2] = (p[a + 2] + p[b + 2]) * 0.5 + r.spread(span * rough * 0.3);
      }
    }
  }

  /**
   * Appends a ribbon along the polyline. Each point's sideways offset is taken across the tangent
   * through its neighbours, so consecutive quads share edges and the joints stay clean.
   */
  private ribbonFrom(p: Float32Array, n: number, width: number, brightness: number): void {
    for (let i = 0; i < n; i++) {
      if (this.count + 6 > this.positions.length / 3) return;
      const t0 = i / n;
      const t1 = (i + 1) / n;
      this.sideAt(p, n, i, width, this.sideA);
      this.sideAt(p, n, i + 1, width, this.sideB);
      // Two triangles: a-, a+, b+ and a-, b+, b-.
      this.vertex(p, i, this.sideA, -1, t0, brightness);
      this.vertex(p, i, this.sideA, 1, t0, brightness);
      this.vertex(p, i + 1, this.sideB, 1, t1, brightness);
      this.vertex(p, i, this.sideA, -1, t0, brightness);
      this.vertex(p, i + 1, this.sideB, 1, t1, brightness);
      this.vertex(p, i + 1, this.sideB, -1, t1, brightness);
    }
  }

  /** Half-width offset in the xy plane, perpendicular to the tangent at point i. */
  private sideAt(p: Float32Array, n: number, i: number, width: number, out: THREE.Vector2): void {
    const i0 = Math.max(0, i - 1) * 3;
    const i1 = Math.min(n, i + 1) * 3;
    out.set(p[i1 + 1] - p[i0 + 1], -(p[i1] - p[i0])).normalize().multiplyScalar(width);
  }

  private vertex(p: Float32Array, i: number, side: THREE.Vector2, across: number, along: number, brightness: number): void {
    const o = this.count * 3;
    this.positions[o] = p[i * 3] + side.x * across;
    this.positions[o + 1] = p[i * 3 + 1] + side.y * across;
    this.positions[o + 2] = p[i * 3 + 2];
    this.ribbon[o] = across;
    this.ribbon[o + 1] = along;
    this.ribbon[o + 2] = brightness;
    this.count++;
  }
}
