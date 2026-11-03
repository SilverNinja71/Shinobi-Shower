import * as THREE from 'three';
import type { Game } from '../../core/Game.ts';
import { BRIDGE_LENGTH, DECK_HALF_WIDTH } from '../../scene/SuspensionBridge.ts';
import { laneX } from '../RenderContext.ts';

/**
 * One piece's launch. Callers keep one of these, fill it in and hand it to `DebrisPool.emit`, which
 * copies it; nothing is allocated per piece.
 */
export class DebrisSpec {
  /** Shape variant (see PIECE in debrisShapes.ts). */
  variant = 0;
  /** World position (m) and velocity (m/s). */
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Size along each axis of the unit shape (m). */
  sx = 0.05;
  sy = 0.05;
  sz = 0.05;
  /** Tumble rate (rad/s) about a random axis, and how far it has already turned (rad). */
  spin = 10;
  angle = 0;
  life = 1.2;
  /** Share of the fall speed kept on bouncing off the deck (0 sticks). */
  bounce = 0.3;
  drag = 0.2;
  gravity = 9.8;
  /** Linear albedo. */
  r = 1;
  g = 1;
  b = 1;
  roughness = 0.8;
  /** 0–1: how much icy rim light it gets. */
  ice = 0;
  /** Emissive strength at birth, and how fast it cools (1/s). */
  glow = 0;
  glowRate = 6;
  /** Starting orientation before the tumble (identity unless set). */
  readonly orientation = new THREE.Quaternion();

  /** Sets the albedo in one call. */
  color(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  /** Sets the size in one call. */
  size(x: number, y = x, z = x): this {
    this.sx = x;
    this.sy = y;
    this.sz = z;
    return this;
  }
}

/** Floats of CPU state per piece (see the layout in `emit`). */
const STATE = 27;
/** Below this height a piece is lost in the gorge. */
const GORGE = -45;

/**
 * Lit, solid debris (ice shards, splinters, snow chunks, the halves of a cut hailstone): one
 * InstancedMesh in the main scene, so the pieces catch the moon, the lanterns and the lightning and
 * hide behind what stands in front. Each piece flies, tumbles and drags on the CPU, bounces off the
 * swaying deck (or the snow on it) and slides, falls through holes and off the edges into the gorge,
 * and shrinks away at the end of its life. Live pieces stay packed at the front of the buffers.
 * One draw call while anything is alive.
 */
export class DebrisPool {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private readonly state: Float32Array;
  private readonly extra: THREE.InstancedBufferAttribute;
  private readonly colors: THREE.InstancedBufferAttribute;
  /** Everything uploaded each frame. */
  private readonly buffers: THREE.BufferAttribute[];
  private readonly rng: () => number;
  private count = 0;
  private readonly q = new THREE.Quaternion();
  private readonly tumble = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, rng: () => number) {
    this.capacity = capacity;
    this.rng = rng;
    this.state = new Float32Array(capacity * STATE);
    this.extra = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aDebris', this.extra);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colors;
    this.buffers = [this.mesh.instanceMatrix, this.extra, this.colors];
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  get alive(): boolean {
    return this.count > 0;
  }

  /** Adds a piece; when the pool is full it replaces the piece closest to the end of its life. */
  emit(s: DebrisSpec): void {
    let i = this.count;
    if (i >= this.capacity) {
      let best = 0;
      let left = Infinity;
      for (let k = 0; k < this.capacity; k++) {
        const o = k * STATE;
        const remaining = this.state[o + 16] - this.state[o + 15];
        if (remaining < left) {
          left = remaining;
          best = k;
        }
      }
      i = best;
    } else {
      this.count++;
    }
    // A random tumble axis.
    const z = this.rng() * 2 - 1;
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const st = this.state;
    const o = i * STATE;
    st[o] = s.x;
    st[o + 1] = s.y;
    st[o + 2] = s.z;
    st[o + 3] = s.vx;
    st[o + 4] = s.vy;
    st[o + 5] = s.vz;
    st[o + 6] = Math.cos(a) * r;
    st[o + 7] = Math.sin(a) * r;
    st[o + 8] = z;
    st[o + 9] = s.angle;
    st[o + 10] = s.spin;
    st[o + 11] = s.sx;
    st[o + 12] = s.sy;
    st[o + 13] = s.sz;
    st[o + 14] = s.bounce;
    st[o + 15] = 0;
    st[o + 16] = s.life;
    st[o + 17] = s.drag;
    st[o + 18] = s.gravity;
    st[o + 19] = s.variant;
    st[o + 20] = s.roughness;
    st[o + 21] = s.ice;
    st[o + 22] = s.glow;
    st[o + 23] = s.glowRate;
    st[o + 24] = s.orientation.x;
    st[o + 25] = s.orientation.y;
    st[o + 26] = s.orientation.z;
    // The fourth quaternion component is recovered from the other three (unit length, w ≥ 0).
    if (s.orientation.w < 0) {
      st[o + 24] = -s.orientation.x;
      st[o + 25] = -s.orientation.y;
      st[o + 26] = -s.orientation.z;
    }
    this.colors.setXYZ(i, s.r, s.g, s.b);
  }

  /** Copies piece `from` over piece `to` (packing the live pieces after one dies). */
  private move(from: number, to: number): void {
    this.state.copyWithin(to * STATE, from * STATE, from * STATE + STATE);
    this.colors.setXYZ(to, this.colors.getX(from), this.colors.getY(from), this.colors.getZ(from));
  }

  update(dt: number, game: Game): void {
    const st = this.state;
    const bridge = game.bridge;
    const snow = game.snow;
    const matrices = this.mesh.instanceMatrix.array as Float32Array;
    const extra = this.extra.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      const o = i * STATE;
      st[o + 15] += dt;
      const age = st[o + 15];
      const life = st[o + 16];
      if (age >= life || st[o + 1] < GORGE) {
        this.count--;
        if (i < this.count) this.move(this.count, i);
        continue;
      }
      // Flight: gravity and air drag.
      const keep = Math.exp(-st[o + 17] * dt);
      st[o + 3] *= keep;
      st[o + 4] = st[o + 4] * keep - st[o + 18] * dt;
      st[o + 5] *= keep;
      const prevY = st[o + 1];
      st[o] += st[o + 3] * dt;
      st[o + 1] += st[o + 4] * dt;
      st[o + 2] += st[o + 5] * dt;

      // The deck (and any snow on it) where it is whole; holes and the edges let pieces through.
      const x = laneX(st[o]);
      const sx = st[o + 11];
      const sy = st[o + 12];
      const sz = st[o + 13];
      const radius = (sx + sy + sz) * 0.2;
      if (x >= 0 && x < BRIDGE_LENGTH && !bridge.isOpen(x) && Math.abs(st[o + 2] - bridge.lateral(x)) < DECK_HALF_WIDTH) {
        const top = bridge.deckY(x) + snow.depthAt(x) + radius;
        if (st[o + 1] < top && prevY > top - 0.25 && st[o + 4] < 0) {
          st[o + 1] = top;
          const bounce = st[o + 14];
          st[o + 4] = -st[o + 4] * bounce;
          if (st[o + 4] < 0.35) st[o + 4] = 0;
          // Friction on landing, and the tumble slows.
          st[o + 3] *= 0.55;
          st[o + 5] *= 0.55;
          st[o + 10] *= 0.6;
        }
      }
      st[o + 9] += st[o + 10] * dt;

      // Shrink away over the last fifth of life.
      const left = 1 - age / life;
      const fade = left < 0.2 ? left / 0.2 : 1;
      this.axis.set(st[o + 6], st[o + 7], st[o + 8]);
      this.tumble.setFromAxisAngle(this.axis, st[o + 9]);
      const qx = st[o + 24];
      const qy = st[o + 25];
      const qz = st[o + 26];
      this.q.set(qx, qy, qz, Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz)));
      this.q.premultiply(this.tumble);
      this.pos.set(st[o], st[o + 1], st[o + 2]);
      this.scale.set(sx * fade, sy * fade, sz * fade);
      this.m.compose(this.pos, this.q, this.scale);
      this.m.toArray(matrices, i * 16);
      extra[i * 4] = st[o + 19];
      extra[i * 4 + 1] = st[o + 20];
      extra[i * 4 + 2] = st[o + 21];
      extra[i * 4 + 3] = st[o + 22] * Math.exp(-st[o + 23] * age);
      i++;
    }
    const n = this.count;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      for (const a of this.buffers) {
        a.updateRange.offset = 0;
        a.updateRange.count = n * a.itemSize;
        a.needsUpdate = true;
      }
    }
  }
}
