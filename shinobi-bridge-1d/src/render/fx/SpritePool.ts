import * as THREE from 'three';
import fragmentSource from '../../shaders/ParticleSprite.frag';
import vertexShader from '../../shaders/ParticleSprite.vert';
import { makePuffAtlas } from './puffAtlas.ts';
import type { SoftLayer } from './SoftLayer.ts';
import { SOFT_DEPTH_GLSL } from './SoftLayer.ts';

/** What a sprite looks like (see ParticleSprite.frag). */
export const SHAPE = { PUFF: 0, STREAK: 1, GLOW: 2, SHARD: 3, RING: 4, FLARE: 5 } as const;

/**
 * One sprite's launch: where, how it moves, how it looks. Callers keep one of these, fill it in and
 * hand it to `SpritePool.emit`, which copies it; nothing is allocated per particle.
 */
export class SpriteSpec {
  shape: number = SHAPE.PUFF;
  /** World position (m) and velocity (m/s). */
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Seconds it lives, and seconds before it appears. */
  life = 1;
  delay = 0;
  /** Half-size (m) at birth and at death. */
  size0 = 0.1;
  size1 = 0.1;
  /** Air drag (1/s); gravity (m/s², positive pulls down, negative rises); spin (rad/s); random 0–1. */
  drag = 0;
  gravity = 0;
  spin = 0;
  seed = 0;
  /** Linear colour, already multiplied by coverage; coverage 0 adds light, 1 hides what is behind. */
  r = 1;
  g = 1;
  b = 1;
  a = 0;
  /** An emissive tint that cools away at `glowRate` (1/s). */
  gr = 0;
  gg = 0;
  gb = 0;
  glowRate = 4;

  /** Sets the colour and coverage in one call. */
  color(r: number, g: number, b: number, a = 0): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  /** Sets the cooling glow in one call. */
  glow(r: number, g: number, b: number, rate = 4): this {
    this.gr = r;
    this.gg = g;
    this.gb = b;
    this.glowRate = rate;
    return this;
  }
}

/** Fallback when the scene has no moon: up and to the left of the frame, behind the bridge. */
const DEFAULT_LIGHT_DIR = new THREE.Vector2(-0.55, 0.83);

/**
 * The VFX sprites: a ring buffer of camera-facing quads in ONE draw call, living in the soft layer.
 * Each particle is written once when it is emitted (four vertices carrying its launch) and animated
 * entirely in ParticleSprite.vert, so a frame only uploads the slots written since the last one.
 * The quads are plain (not instanced) geometry: software WebGL pays per instance, not per vertex.
 * When every particle has died the mesh hides, the soft layer switches off, and the clock restarts.
 */
export class SpritePool {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly attributes: THREE.BufferAttribute[] = [];
  private readonly position: Float32Array;
  private readonly vel: Float32Array;
  private readonly shape: Float32Array;
  private readonly motion: Float32Array;
  private readonly tint: Float32Array;
  private readonly glow: Float32Array;
  private readonly uniforms: {
    uTime: { value: number };
    uWind: { value: number };
    uLightning: { value: number };
    uPixel: { value: number };
    uLightDir: { value: THREE.Vector2 };
    uMoon: { value: THREE.Color };
    uSky: { value: THREE.Color };
    tPuff: { value: THREE.Texture };
  };
  private readonly layer: SoftLayer;
  private head = 0;
  /** Slots in use since the clock last restarted: the draw range. */
  private used = 0;
  private time = 0;
  /** When the last particle written so far dies, on the pool's clock. */
  private deadline = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  private readonly moonDir = new THREE.Vector3();

  constructor(layer: SoftLayer, capacity: number, shared: { uWind: { value: number }; uLightning: { value: number } }) {
    this.layer = layer;
    this.capacity = capacity;
    const verts = capacity * 4;
    const corner = new Float32Array(verts * 2);
    const index = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      corner.set([-1, -1, 1, -1, -1, 1, 1, 1], i * 8);
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    const g = this.geometry;
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    const dynamic = (name: string, size: number) => {
      const a = new THREE.BufferAttribute(new Float32Array(verts * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.attributes.push(a);
      return a.array as Float32Array;
    };
    this.position = dynamic('position', 3);
    this.vel = dynamic('aVel', 4);
    this.shape = dynamic('aShape', 4);
    this.motion = dynamic('aMotion', 4);
    this.tint = dynamic('aColor', 4);
    this.glow = dynamic('aGlow', 4);
    g.setDrawRange(0, 0);

    this.uniforms = {
      uTime: { value: 0 },
      uWind: shared.uWind,
      uLightning: shared.uLightning,
      uPixel: { value: 0.001 },
      uLightDir: { value: DEFAULT_LIGHT_DIR.clone() },
      uMoon: { value: new THREE.Color(0.42, 0.46, 0.56) },
      uSky: { value: new THREE.Color(0.035, 0.042, 0.058) },
      tPuff: { value: makePuffAtlas() },
    };
    const material = new THREE.ShaderMaterial({
      name: 'VFX.sprites',
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...layer.uniforms, ...this.uniforms },
      vertexShader,
      fragmentShader: `${SOFT_DEPTH_GLSL}\n${fragmentSource}`,
      fog: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'vfx-sprites';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    layer.scene.add(this.mesh);
  }

  /** True while any particle may still be on screen. */
  get alive(): boolean {
    return this.time < this.deadline;
  }

  /** Writes one particle into the next slot (the oldest is overwritten when the ring is full). */
  emit(s: SpriteSpec): void {
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    this.used = Math.max(this.used, i + 1);
    this.dirtyMin = Math.min(this.dirtyMin, i);
    this.dirtyMax = Math.max(this.dirtyMax, i);
    const born = this.time + s.delay;
    this.deadline = Math.max(this.deadline, born + s.life);
    for (let v = i * 4; v < i * 4 + 4; v++) {
      this.position[v * 3] = s.x;
      this.position[v * 3 + 1] = s.y;
      this.position[v * 3 + 2] = s.z;
      const o = v * 4;
      this.vel[o] = s.vx;
      this.vel[o + 1] = s.vy;
      this.vel[o + 2] = s.vz;
      this.vel[o + 3] = born;
      this.shape[o] = s.shape;
      this.shape[o + 1] = s.life;
      this.shape[o + 2] = s.size0;
      this.shape[o + 3] = s.size1;
      this.motion[o] = s.drag;
      this.motion[o + 1] = s.gravity;
      this.motion[o + 2] = s.spin;
      this.motion[o + 3] = s.seed;
      this.tint[o] = s.r;
      this.tint[o + 1] = s.g;
      this.tint[o + 2] = s.b;
      this.tint[o + 3] = s.a;
      this.glow[o] = s.gr;
      this.glow[o + 1] = s.gg;
      this.glow[o + 2] = s.gb;
      this.glow[o + 3] = s.glowRate;
    }
  }

  /**
   * Advances the clock, uploads what was emitted, and aims the puffs' lighting at the moon (the
   * scene's shadow-casting light, when there is one).
   */
  update(dt: number, camera: THREE.PerspectiveCamera, moon: THREE.DirectionalLight | null): void {
    this.time += dt;
    if (this.dirtyMax >= 0) {
      const from = this.dirtyMin * 4;
      const count = (this.dirtyMax - this.dirtyMin + 1) * 4;
      for (const a of this.attributes) {
        a.updateRange.offset = from * a.itemSize;
        a.updateRange.count = count * a.itemSize;
        a.needsUpdate = true;
      }
      this.dirtyMin = Infinity;
      this.dirtyMax = -1;
    }
    const alive = this.alive;
    if (!alive && this.used > 0) {
      // Everything has died: restart the clock and the ring, so times stay small and exact.
      this.time = 0;
      this.deadline = 0;
      this.head = 0;
      this.used = 0;
    }
    this.geometry.setDrawRange(0, this.used * 6);
    this.mesh.visible = alive;
    this.layer.active = alive;
    if (!alive) return;

    const u = this.uniforms;
    u.uTime.value = this.time;
    // One soft-layer pixel at 1 m, so sprites never shrink below about a pixel.
    u.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * this.layer.uniforms.uSoftInvSize.value.y;
    if (moon) {
      this.moonDir.subVectors(moon.position, moon.target.position).normalize().transformDirection(camera.matrixWorldInverse);
      const len = Math.hypot(this.moonDir.x, this.moonDir.y);
      if (len > 1e-3) u.uLightDir.value.set(this.moonDir.x / len, this.moonDir.y / len);
      u.uMoon.value.copy(moon.color).multiplyScalar(0.2 * moon.intensity);
    }
  }
}
