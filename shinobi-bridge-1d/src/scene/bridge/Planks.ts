import * as THREE from 'three';
import type { Game } from '../../core/Game.ts';
import { makeWetMaterial } from '../../render/Assets.ts';
import type { RenderContext } from '../../render/RenderContext.ts';
import { placeOnDeck } from '../../render/RenderContext.ts';
import plankSource from '../../shaders/Plank.glsl';
import { PLANK_COUNT, PLANK_HEALTH } from '../SuspensionBridge.ts';
import { buildBoard, makeRng } from './BoardGeometry.ts';
import { CRACK_EMPTY, CRACK_IMPACT_V, CRACK_TILES, CRACK_VARIANTS, crackAtlas } from './crackAtlas.ts';
import { extendMaterial, glslSections } from './glsl.ts';
import { DECK_HALF_WIDTH, PLANK_THICKNESS, PLANK_WIDTH } from './layout.ts';

/** Seconds a broken plank takes to tumble out of sight into the gorge. */
const FALL_TIME = 2.5;
const GRAVITY = 9.81;
/** Halves that can be falling at once (two per broken plank). */
const MAX_HALVES = 48;
/** Metres of wood per texture repeat. */
const TEX_SCALE = 0.9;
/** By damage 0–3: how far a board sinks, twists about its length, and sags off one lashing (rad). */
const SINK = [0, 0.002, 0.006, 0.012];
const TWIST = [0, 0.004, 0.018, 0.035];
const SAG = [0, 0, 0.018, 0.05];

const PLANK = glslSections(plankSource);

interface PlankState {
  mesh: THREE.InstancedMesh;
  slot: number;
  damage: THREE.InstancedBufferAttribute;
  /** The board's own resting offset on the deck (per-plank jitter plus how far damage has knocked it askew). */
  readonly local: THREE.Matrix4;
  /**
   * Fixed per-plank irregularity: lateral shift, yaw, roll, length and height; which way damage twists
   * it (`tip`), and which end (`end`, +1 the near one) sags off its lashing once it is badly split.
   */
  readonly jitter: { z: number; yaw: number; roll: number; len: number; lift: number; tip: number; end: number };
  /** Which crack pattern the board gets when it is hit (variant and mirroring), and where it was hit. */
  readonly crack: { variant: number; flips: number; z: number };
  readonly uv: [number, number, number, number];
  health: number;
  broken: boolean;
  /** World pose of the board the moment it broke, where its halves start falling from. */
  readonly fallFrom: THREE.Matrix4;
  readonly spin: [number, number, number, number];
}

/**
 * The deck: 120 weathered oak boards as a few instanced variants, each placed on the swaying deck every
 * frame with its own small irregularities and patch of wood. Hail damage shows as cracks from the crack
 * atlas and as boards knocked askew, a split one sagging off its lashing; a broken board snaps in two and
 * both halves tumble into the gorge.
 */
export class Planks {
  readonly material: THREE.MeshStandardMaterial;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly states: PlankState[] = [];
  private readonly halves: THREE.InstancedMesh;
  private readonly halfPlank: THREE.InstancedBufferAttribute;
  private readonly halfDamage: THREE.InstancedBufferAttribute;
  private readonly deck = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly spinQ = new THREE.Quaternion();
  private readonly half = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  private readonly axis = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly hinge = new THREE.Matrix4();
  private readonly turn = new THREE.Matrix4();
  /** A half's geometry runs from its torn end at z = 0; this centres it so it spins about its middle. */
  private readonly shift = new THREE.Matrix4().makeTranslation(0, PLANK_THICKNESS / 2, -DECK_HALF_WIDTH * 0.5);

  constructor(ctx: RenderContext, parent: THREE.Object3D) {
    const low = ctx.quality === 'low';
    const set = ctx.assets.pbr('plank', 1, 1);
    this.material = makeWetMaterial(
      {
        map: set.map,
        normalMap: set.normalMap,
        normalScale: new THREE.Vector2(1.3, 1.3),
        roughnessMap: set.roughnessMap,
        color: 0xf4ebe0,
        roughness: 1,
        metalness: 0,
      },
      ctx.uniforms,
    );
    this.material.defines = {
      ...(this.material.defines ?? {}),
      PLANK_WIDTH: PLANK_WIDTH.toFixed(3),
      PLANK_LENGTH: (DECK_HALF_WIDTH * 2).toFixed(3),
      CRACK_TILES: CRACK_TILES.toFixed(1),
    };
    extendMaterial(
      this.material,
      'wet-plank',
      { uCrackAtlas: { value: crackAtlas(ctx.assets.maxAnisotropy) } },
      [
        { anchor: '#include <common>', code: PLANK['vertex-common'] },
        { anchor: '#include <uv_vertex>', code: PLANK.uv },
        { anchor: '#include <beginnormal_vertex>', code: PLANK['normal-vertex'] },
        { anchor: '#include <begin_vertex>', code: PLANK.vertex },
      ],
      [
        { anchor: '#include <packing>', code: PLANK['fragment-common'] },
        { anchor: '#include <color_fragment>', code: PLANK.albedo },
        { anchor: '#include <metalnessmap_fragment>', code: PLANK.roughness },
        { anchor: '#include <clearcoat_normal_fragment_begin>', code: PLANK.normal, before: true },
      ],
    );

    // A few board shapes; every plank picks one, then gets its own jitter, texture patch and cracks.
    const variants = low ? 2 : 3;
    const rng = makeRng(0x9a11);
    const board = (seed: number) =>
      buildBoard({
        width: PLANK_WIDTH,
        thickness: PLANK_THICKNESS,
        length: DECK_HALF_WIDTH * 2,
        stations: 3,
        bevel: low ? 0 : 0.012,
        bevelSegments: 1,
        topSegments: 1,
        rng: makeRng(seed),
        chips: 0.012,
        ragged: 0.014,
        warp: 0.007,
        texScale: TEX_SCALE,
      });
    const owner = Array.from({ length: PLANK_COUNT }, () => Math.floor(rng() * variants));
    for (let v = 0; v < variants; v++) {
      const count = owner.filter((o) => o === v).length;
      const geometry = board(0x51ab + v * 977);
      const plank = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
      const damage = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
      damage.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aPlank', plank);
      geometry.setAttribute('aDamage', damage);
      const mesh = new THREE.InstancedMesh(geometry, this.material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Instanced bounds are computed once and these instances move: never cull them.
      mesh.frustumCulled = false;
      // The deck's own shadow would only fall into the gorge; it still catches the warrior's and the ropes'.
      mesh.receiveShadow = true;
      mesh.name = `planks-${v}`;
      this.meshes.push(mesh);
      parent.add(mesh);
    }

    const slots = new Array(variants).fill(0);
    for (let i = 0; i < PLANK_COUNT; i++) {
      const mesh = this.meshes[owner[i]];
      const slot = slots[owner[i]]++;
      const uv: [number, number, number, number] = [rng(), rng(), rng() < 0.5 ? -1 : 1, rng()];
      (mesh.geometry.getAttribute('aPlank') as THREE.InstancedBufferAttribute).setXYZW(slot, ...uv);
      const state: PlankState = {
        mesh,
        slot,
        damage: mesh.geometry.getAttribute('aDamage') as THREE.InstancedBufferAttribute,
        local: new THREE.Matrix4(),
        jitter: {
          z: (rng() - 0.5) * 0.03,
          yaw: (rng() - 0.5) * 0.07,
          roll: (rng() - 0.5) * 0.012,
          len: 0.97 + rng() * 0.05,
          lift: (rng() - 0.5) * 0.004,
          tip: rng() < 0.5 ? -1 : 1,
          // Mostly the end toward the camera, so a failing board reads from the side-on view.
          end: rng() < 0.75 ? 1 : -1,
        },
        crack: Planks.crackOf(rng),
        uv,
        health: -1,
        broken: false,
        fallFrom: new THREE.Matrix4(),
        spin: [rng(), rng(), rng(), rng()],
      };
      this.states.push(state);
    }

    // The two halves of a snapped board: a half-length board with a freshly torn end at z = 0.
    const halfGeometry = buildBoard({
      width: PLANK_WIDTH,
      thickness: PLANK_THICKNESS,
      length: DECK_HALF_WIDTH,
      z0: 0,
      stations: 3,
      bevel: low ? 0 : 0.012,
      bevelSegments: 1,
      topSegments: 1,
      rng: makeRng(0x4a1f),
      chips: 0.01,
      ragged: 0.012,
      brokenStart: true,
      warp: 0.004,
      texScale: TEX_SCALE,
    });
    this.halfPlank = new THREE.InstancedBufferAttribute(new Float32Array(MAX_HALVES * 4), 4);
    this.halfDamage = new THREE.InstancedBufferAttribute(new Float32Array(MAX_HALVES * 4), 4);
    this.halfPlank.setUsage(THREE.DynamicDrawUsage);
    this.halfDamage.setUsage(THREE.DynamicDrawUsage);
    halfGeometry.setAttribute('aPlank', this.halfPlank);
    halfGeometry.setAttribute('aDamage', this.halfDamage);
    this.halves = new THREE.InstancedMesh(halfGeometry, this.material, MAX_HALVES);
    this.halves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halves.frustumCulled = false;
    this.halves.count = 0;
    this.halves.visible = false;
    this.halves.name = 'plank-halves';
    parent.add(this.halves);
  }

  /** A board's crack pattern: one of the atlas variants, mirrored either way, and where the stone hit it. */
  private static crackOf(rng: () => number): PlankState['crack'] {
    const variant = Math.floor(rng() * CRACK_VARIANTS);
    const flips = Math.floor(rng() * 4);
    const flipV = flips < 2 ? 1 : -1;
    return { variant, flips, z: flipV * (CRACK_IMPACT_V[variant] - 0.5) * DECK_HALF_WIDTH * 2 };
  }

  /** Damage 0 (intact) to 3 (split end to end) from the simulation's health 4..1. */
  private static damageOf(health: number): number {
    return THREE.MathUtils.clamp(PLANK_HEALTH - health, 0, 3);
  }

  /**
   * The board's resting pose relative to the deck: its jitter, and how far damage has knocked it. A
   * cracked board twists and settles; a split one sags off its lashing at one end, hinged on the other.
   */
  private settle(s: PlankState, health: number): void {
    const d = Planks.damageOf(health);
    const j = s.jitter;
    const twist = TWIST[d] * j.tip;
    const sag = SAG[d] * j.end;
    this.euler.set(j.roll, j.yaw + twist * 0.8, twist);
    this.quat.setFromEuler(this.euler);
    this.pos.set(0, j.lift - SINK[d], j.z);
    this.scale.set(1, 1, j.len);
    s.local.compose(this.pos, this.quat, this.scale);
    if (sag !== 0) {
      // Rotate about the lane axis through the end that still holds.
      const pivot = -j.end * DECK_HALF_WIDTH;
      this.hinge.makeTranslation(0, 0, pivot).multiply(this.turn.makeRotationX(sag)).multiply(this.m.makeTranslation(0, 0, -pivot));
      s.local.premultiply(this.hinge);
    }
    const tile = d > 0 ? (d - 1) * CRACK_VARIANTS + s.crack.variant : CRACK_EMPTY;
    s.damage.setXYZW(s.slot, d, s.crack.z, tile, s.crack.flips);
    s.damage.needsUpdate = true;
  }

  update(game: Game): void {
    const planks = game.bridge.planks;
    let halves = 0;
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i];
      const p = planks[i];
      if (p.health !== s.health) {
        if (p.health > 0) this.settle(s, p.health);
        s.health = p.health;
      }
      placeOnDeck(this.deck, game, p.x);
      this.deck.updateMatrix();
      this.m.multiplyMatrices(this.deck.matrix, s.local);
      if (p.broken && !s.broken) s.fallFrom.copy(this.m);
      s.broken = p.broken;
      s.mesh.setMatrixAt(s.slot, p.broken ? this.hidden : this.m);
      if (p.broken && p.brokenAge < FALL_TIME && halves + 2 <= MAX_HALVES) {
        halves = this.fall(s, p.brokenAge, game.storm.wind, halves);
      }
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    this.halves.count = halves;
    this.halves.visible = halves > 0;
    if (halves > 0) {
      this.halves.instanceMatrix.needsUpdate = true;
      this.halfPlank.needsUpdate = true;
      this.halfDamage.needsUpdate = true;
    }
  }

  /**
   * Poses the two halves of a broken board `t` seconds after it snapped: they drop away from the
   * break, inner ends first, spread apart, drift on the wind and tumble end over end.
   */
  private fall(s: PlankState, t: number, wind: number, n: number): number {
    const a = s.spin[0];
    const b = s.spin[1];
    const c = s.spin[2];
    const d = s.spin[3];
    for (let side = 1; side >= -1; side -= 2) {
      // Start: the half's centre in the board's frame, then into the world.
      this.start.set(0, -PLANK_THICKNESS / 2, side * DECK_HALF_WIDTH * 0.5).applyMatrix4(s.fallFrom);
      const vx = (a - 0.5) * 0.6 + wind * 0.04 * t;
      const vz = side * (0.3 + 0.35 * b);
      this.pos.set(
        this.start.x + vx * t,
        this.start.y - (0.8 + 0.6 * c) * t - 0.5 * GRAVITY * t * t,
        this.start.z + vz * t,
      );
      // Orientation: the board's, flipped for the far half, then tumbling about a wobbling axis.
      this.quat.setFromRotationMatrix(s.fallFrom);
      if (side < 0) this.quat.multiply(this.half);
      this.axis.set(1, (c - 0.5) * 0.8, (d - 0.5) * 0.8).normalize();
      this.spinQ.setFromAxisAngle(this.axis, -(2.2 + 3.5 * (side > 0 ? b : d)) * t - 1.1 * Math.min(t, 0.4));
      this.quat.multiply(this.spinQ);
      this.scale.set(1, 1, 1);
      // The half's geometry runs from its torn end at z = 0: shift so it spins about its middle.
      this.m.compose(this.pos, this.quat, this.scale);
      this.m.multiply(this.shift);
      this.halves.setMatrixAt(n, this.m);
      this.halfPlank.setXYZW(n, s.uv[0] + (side > 0 ? 0 : 0.5), s.uv[1], s.uv[2], s.uv[3]);
      this.halfDamage.setXYZW(n, 3, 0.02, 2 * CRACK_VARIANTS + s.crack.variant, s.crack.flips);
      n++;
    }
    return n;
  }
}
