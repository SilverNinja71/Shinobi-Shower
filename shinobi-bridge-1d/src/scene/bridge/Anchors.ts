import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../core/Game.ts';
import { makeWetMaterial } from '../../render/Assets.ts';
import type { RenderContext } from '../../render/RenderContext.ts';
import { buildBoard, makeRng } from './BoardGeometry.ts';
import type { BoardOptions } from './BoardGeometry.ts';
import {
  BRIDGE_LENGTH,
  EDGE_Y,
  HAND_HEIGHT,
  LANTERN_ARM_REACH,
  LANTERN_ARM_Y,
  POST_BOTTOM,
  POST_HALF,
  POST_TOP,
  POST_Z,
} from './layout.ts';
import { makeRopeMaterial, withoutRipples } from './materials.ts';
import { fixedRope } from './RopeGeometry.ts';
import { paperTexture } from './textures.ts';

/** The lanterns are the only warm light in the scene (art direction). */
const LANTERN_COLOR = 0xff9a4a;
/** Candela at full flame, and the distance at which the light is cut off. */
const LANTERN_CANDELA = 7;
const LANTERN_RANGE = 14;
/** Brightness of the lit paper (linear, before tone mapping), tinted toward the flame. */
const GLOW = 2.6;
/** The lantern's heart hangs this far below its hook, and swings like a pendulum this long. */
const LIGHT_DROP = 0.33;
const PENDULUM = Math.sqrt(9.81 / 0.36);
/** Section of the lantern arm. */
const ARM = 0.085;

/** Moves a geometry to a position with a rotation. */
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, q = new THREE.Quaternion()): THREE.BufferGeometry {
  return g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
}

/**
 * Rope lashed round a square post (or stake) of half-width `half` from y0 to y1, as a rounded band whose
 * texture reads as tight turns of rope, at a fraction of the triangles of a real coil
 * (whose sub-pixel tube would cost far more than it shows from the camera's distance). `r` is the
 * radius of the rope wound on.
 */
function lashing(cx: number, cz: number, half: number, y0: number, y1: number, r: number, phase: number, low: boolean): THREE.BufferGeometry {
  const around = low ? 8 : 12;
  const rings = [
    { y: y0, out: r * 0.4 },
    { y: (y0 + y1) / 2, out: r * 1.6 },
    { y: y1, out: r * 0.4 },
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  // The rope texture's strands run diagonally, about eight to a repeat. Turned 45° (around the post
  // along the strands, up the post across them) and scaled so one strand is one rope's thickness, they
  // stack up the band as separate turns of rope.
  const scale = 1 / (32 * r);
  for (const ring of rings) {
    let p = 0;
    let px = 0;
    let pz = 0;
    for (let k = 0; k <= around; k++) {
      const a = phase + (k / around) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // A squarish loop that hugs the timber's flat faces.
      const x = Math.sign(c) * Math.abs(c) ** 0.3 * (half + ring.out);
      const z = Math.sign(s) * Math.abs(s) ** 0.3 * (half + ring.out);
      if (k > 0) p += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      positions.push(cx + x, ring.y, cz + z);
      uvs.push((p + ring.y - y0) * scale, (ring.y - y0 - p) * scale);
    }
  }
  const row = around + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < around; k++) {
      const a = i * row + k;
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A squared timber standing upright from `bottom` to `top`, centred on (x, z). */
function upright(o: Omit<BoardOptions, 'length' | 'z0'>, x: number, z: number, bottom: number, top: number): THREE.BufferGeometry {
  const g = buildBoard({ ...o, length: top - bottom, z0: 0 });
  return g.rotateX(-Math.PI / 2).translate(x, bottom, z - o.thickness / 2);
}

/**
 * The two anchor ends: thick weathered posts either side of the deck that the ropes tie off on (lashed
 * round them), backstays to timber stakes behind, and an iron-and-paper lantern swinging from an arm on
 * each front post with a warm, flickering light. Each end is its own pair of meshes (timber, rope), so
 * the camera only pays for an end it can see.
 */
export class Anchors {
  private readonly frames: THREE.InstancedMesh;
  private readonly glows: THREE.InstancedMesh;
  private readonly lights: THREE.PointLight[] = [];
  private readonly pivots: THREE.Vector3[] = [];
  /** Pendulum state per lantern: swing about x and z, and their rates. */
  private readonly swing = [new Float32Array(4), new Float32Array(4)];
  private readonly dummy = new THREE.Object3D();
  private readonly heart = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(ctx: RenderContext, parent: THREE.Object3D) {
    const low = ctx.quality === 'low';
    const rng = makeRng(0xa7c0);
    const set = ctx.assets.pbr('plank', 1, 1);
    // Upright timber holds no standing water: wet, but no rain ripples.
    const wood = withoutRipples(
      makeWetMaterial(
        { map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, color: 0xcfc4b6, roughness: 1, metalness: 0 },
        ctx.uniforms,
      ),
    );
    const rope = makeRopeMaterial(ctx);
    const timberOptions = (width: number, chips: number) => ({
      width,
      thickness: width,
      stations: low ? 3 : 4,
      bevel: Math.min(0.022, width * 0.12),
      bevelBottom: Math.min(0.022, width * 0.12),
      bevelSegments: 1,
      topSegments: 1,
      rng: makeRng(Math.floor(rng() * 1e9)),
      chips,
      ragged: 0.02,
      warp: 0.01,
      texScale: 0.9,
    });

    for (const end of [-1, 1]) {
      const wx = (end * BRIDGE_LENGTH) / 2;
      // Toward the middle of the bridge.
      const dir = -end;
      const timber: THREE.BufferGeometry[] = [];
      const ropes: THREE.BufferGeometry[] = [];
      for (const side of [1, -1]) {
        const z = side * POST_Z;
        const post = upright(timberOptions(POST_HALF * 2, 0.03), 0, 0, POST_BOTTOM, POST_TOP);
        // Show the chipped, weathered face to the camera.
        if (side > 0) post.rotateY(Math.PI);
        timber.push(post.translate(wx, 0, z));
        timber.push(place(new THREE.ConeGeometry(POST_HALF * Math.SQRT2 * 1.04, 0.1, 4, 1).rotateY(Math.PI / 4), wx, POST_TOP + 0.045, z));

        // The hand and edge ropes end lashed round the posts; a third lashing holds the backstay.
        ropes.push(lashing(wx, z, POST_HALF, HAND_HEIGHT - 0.075, HAND_HEIGHT + 0.07, 0.014, rng() * 6, low));
        ropes.push(lashing(wx, z, POST_HALF, EDGE_Y - 0.06, EDGE_Y + 0.055, 0.014, rng() * 6, low));
        ropes.push(lashing(wx, z, POST_HALF, 1.18, 1.28, 0.012, rng() * 6, low));

        // The backstay runs down to a stake leaning away behind the post.
        const sx = wx + end * 1.45;
        const sz = side * 1.18;
        const tilt = -end * 0.28;
        timber.push(upright(timberOptions(0.09, 0.015), 0, 0, -0.9, 0.35).rotateZ(tilt).translate(sx, 0, sz));
        const top = new THREE.Vector3(sx - Math.sin(tilt) * 0.28, Math.cos(tilt) * 0.28, sz);
        ropes.push(lashing(top.x, sz, 0.045, top.y - 0.05, top.y + 0.02, 0.011, rng() * 6, low));
        const from = new THREE.Vector3(wx + end * (POST_HALF + 0.012), 1.23, z);
        const mid = from.clone().lerp(top, 0.5);
        mid.y -= 0.06;
        ropes.push(fixedRope([from, mid, top], 0.018, low ? 4 : 8, low ? 3 : 4));
      }

      // The lantern arm on the front post, with a brace under it, lashed on.
      const arm = buildBoard({ ...timberOptions(ARM, 0.01), length: LANTERN_ARM_REACH + 0.1, z0: 0 });
      timber.push(place(arm.rotateY((dir * Math.PI) / 2), wx - dir * 0.1, LANTERN_ARM_Y + ARM / 2, POST_Z));
      const braceFrom = new THREE.Vector3(wx + dir * (POST_HALF - 0.01), LANTERN_ARM_Y - 0.34, POST_Z);
      const braceTo = new THREE.Vector3(wx + dir * 0.34, LANTERN_ARM_Y - ARM / 2 + 0.01, POST_Z);
      const brace = buildBoard({ ...timberOptions(0.05, 0), length: braceFrom.distanceTo(braceTo), z0: 0 }).translate(0, 0.025, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), braceTo.clone().sub(braceFrom).normalize());
      timber.push(place(brace, braceFrom.x, braceFrom.y, braceFrom.z, q));
      ropes.push(lashing(wx, POST_Z, POST_HALF, LANTERN_ARM_Y - 0.17, LANTERN_ARM_Y - 0.07, 0.012, rng() * 6, low));
      this.pivots.push(new THREE.Vector3(wx + dir * (LANTERN_ARM_REACH - 0.06), LANTERN_ARM_Y - ARM / 2, POST_Z));

      const name = end < 0 ? 'west' : 'east';
      const posts = new THREE.Mesh(mergeGeometries(timber), wood);
      posts.castShadow = posts.receiveShadow = true;
      posts.name = `anchor-posts-${name}`;
      const ties = new THREE.Mesh(mergeGeometries(ropes), rope);
      ties.castShadow = !low;
      ties.receiveShadow = true;
      ties.name = `anchor-ropes-${name}`;
      parent.add(posts, ties);
    }

    // Lanterns: an iron cage and roof round panels of oiled paper, one instance per end.
    const iron = withoutRipples(makeWetMaterial({ color: 0x24211e, metalness: 0.85, roughness: 0.5, wet: 0.8 }, ctx.uniforms));
    this.frames = new THREE.InstancedMesh(lanternFrame(), iron, 2);
    this.frames.castShadow = true;
    this.frames.name = 'lantern-frames';
    const paper = new THREE.MeshBasicMaterial({ map: paperTexture() });
    this.glows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.235, 0.15).translate(0, -LIGHT_DROP, 0), paper, 2);
    this.glows.name = 'lantern-glows';
    for (const m of [this.frames, this.glows]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Instanced bounds are computed once and the lanterns swing: never cull them.
      m.frustumCulled = false;
      parent.add(m);
    }
    for (let i = 0; i < 2; i++) {
      this.glows.setColorAt(i, this.color.setRGB(GLOW, GLOW * 0.82, GLOW * 0.62));
      const light = new THREE.PointLight(LANTERN_COLOR, LANTERN_CANDELA, LANTERN_RANGE, 2);
      light.castShadow = false;
      light.name = `lantern-light-${i}`;
      this.lights.push(light);
      parent.add(light);
    }
    this.update(0, null, 0);
  }

  /** Lanterns swing on the wind and their flames flicker; `time` is the shared clock. */
  update(dt: number, game: Game | null, time: number): void {
    const wind = game ? game.storm.wind : 0;
    const h = Math.min(dt, 0.05);
    for (let i = 0; i < 2; i++) {
      const s = this.swing[i];
      // The wind leans the lantern over and gusts rock it; a damped pendulum follows.
      const gust = Math.sin(time * 1.7 + i * 2.1) * 0.6 + Math.sin(time * 3.9 + i * 0.7) * 0.4;
      const reach = Math.min(0.09, 0.012 + Math.abs(wind) * 0.005);
      const leanZ = THREE.MathUtils.clamp(wind * 0.012, -0.3, 0.3) + gust * reach;
      const leanX = Math.sin(time * 1.1 + i * 4.0) * reach * 0.6;
      const w2 = PENDULUM * PENDULUM;
      const damp = 2 * 0.08 * PENDULUM;
      s[2] += (-w2 * (s[0] - leanX) - damp * s[2]) * h;
      s[3] += (-w2 * (s[1] - leanZ) - damp * s[3]) * h;
      s[0] += s[2] * h;
      s[1] += s[3] * h;
      this.dummy.position.copy(this.pivots[i]);
      this.dummy.rotation.set(s[0], 0, s[1]);
      this.dummy.updateMatrix();
      this.frames.setMatrixAt(i, this.dummy.matrix);
      this.glows.setMatrixAt(i, this.dummy.matrix);
      this.heart.set(0, -LIGHT_DROP, 0).applyMatrix4(this.dummy.matrix);
      this.lights[i].position.copy(this.heart);
      // A candle's unsteady flame, with the odd gutter.
      const p = i * 2.7;
      const flame =
        0.88 +
        0.06 * Math.sin(time * 13.1 + p) +
        0.04 * Math.sin(time * 27.3 + p * 2) +
        0.03 * Math.sin(time * 5.3 + p * 3) -
        0.18 * Math.max(0, Math.sin(time * 0.71 + p)) ** 14;
      this.lights[i].intensity = LANTERN_CANDELA * flame;
      this.glows.setColorAt(i, this.color.setRGB(GLOW * flame, GLOW * 0.82 * flame, GLOW * 0.62 * flame));
    }
    this.frames.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
  }
}

/** The lantern's ironwork, hanging from its hook at the origin: chain, ring, roof, cage and base. */
function lanternFrame(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4, 1, true).translate(0, -0.05, 0));
  parts.push(new THREE.TorusGeometry(0.016, 0.004, 3, 8).translate(0, -0.112, 0));
  parts.push(new THREE.ConeGeometry(0.14, 0.085, 4, 1).rotateY(Math.PI / 4).translate(0, -0.165, 0));
  parts.push(new THREE.BoxGeometry(0.2, 0.012, 0.2).translate(0, -0.212, 0));
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) parts.push(new THREE.BoxGeometry(0.014, 0.25, 0.014).translate(x * 0.08, -LIGHT_DROP, z * 0.08));
    parts.push(new THREE.BoxGeometry(0.17, 0.01, 0.012).translate(0, -LIGHT_DROP, x * 0.081));
    parts.push(new THREE.BoxGeometry(0.012, 0.01, 0.17).translate(x * 0.081, -LIGHT_DROP, 0));
  }
  parts.push(new THREE.BoxGeometry(0.19, 0.022, 0.19).translate(0, -0.461, 0));
  parts.push(new THREE.ConeGeometry(0.03, 0.05, 4, 1).rotateX(Math.PI).translate(0, -0.497, 0));
  return mergeGeometries(parts);
}
