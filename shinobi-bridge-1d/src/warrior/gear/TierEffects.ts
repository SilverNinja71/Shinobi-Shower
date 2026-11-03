import * as THREE from 'three';
import type { Game } from '../../core/Game.ts';
import type { RenderContext } from '../../render/RenderContext.ts';
import glintFrag from '../../shaders/SpiritGlint.frag';
import glintVert from '../../shaders/SpiritGlint.vert';
import lightningFrag from '../../shaders/LightningArc.frag';
import ribbonFrag from '../../shaders/SpiritRibbon.frag';
import ribbonVert from '../../shaders/SpiritRibbon.vert';
import { CrimsonCape } from './CrimsonCape.ts';
import { FlameParticles } from './FlameParticles.ts';
import { additiveMaterial } from './FxMaterial.ts';
import type { GearBinder } from './GearBinder.ts';
import { BLADE_BASE, BLADE_LENGTH, bladePoint } from './Katana.ts';
import { RibbonStrip } from './RibbonStrip.ts';
import { SpiritRibbons } from './SpiritRibbons.ts';
import type { Capsule } from './Verlet.ts';
import type { WarriorRig } from './WarriorRig.ts';
import type { WarriorUniforms } from './WarriorShading.ts';

const EMBER = new THREE.Color(0xff7a2a);
const CRIMSON = new THREE.Color(0xff1f3d);
/** Seconds a bolt holds its shape before it re-strikes. */
const BOLT_LIFE = 0.06;
const BOLT_POINTS = 8;

interface Bolt {
  /** Katana-space points. */
  local: Float32Array;
  age: number;
  life: number;
  seed: number;
}

/**
 * Everything a tier adds beyond its gear: the Kenshi's spirit ribbons and the mist sheathing his
 * blade; the Warlord's burning edge; the Sovereign's crimson lightning, cape and celestial eye. Also
 * the one light this module may own, which follows the main blade and burns ember-orange or
 * crimson. It exists from the start at zero intensity, so reaching tier 4 mid-run never changes
 * the scene's light count (that would recompile every lit shader at once).
 */
export class TierEffects {
  readonly light: THREE.PointLight;
  private readonly rig: WarriorRig;
  private readonly blades: THREE.Mesh[];
  private readonly ribbons: SpiritRibbons;
  private readonly aura: RibbonStrip;
  private readonly lightning: RibbonStrip;
  private readonly flames: FlameParticles;
  private readonly cape: CrimsonCape;
  private readonly eye: THREE.Mesh;
  private readonly bolts: Bolt[] = [];
  private readonly low: boolean;
  private readonly time: { value: number };
  private readonly auraIntensity = { value: 1 };
  private readonly boltIntensity = { value: 1 };
  private readonly torso: Capsule = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0.2 };
  private readonly thighL: Capsule = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0.12 };
  private readonly thighR: Capsule = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0.12 };
  /** 0–1: how hot / charged the blades are (flares on a slash, settles to a smoulder). */
  private heat = 0;
  private flicker = 0;
  private lastSwing = 0;
  private tier = 0;
  private emitAcc = 0;
  private lastX = Number.NaN;
  private readonly prevTips = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly scratch = new Float32Array(16 * 3);
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly rnd = mulberry(91);

  constructor(ctx: RenderContext, rig: WarriorRig, blades: THREE.Mesh[], binder: GearBinder, torso: THREE.Matrix4, u: WarriorUniforms) {
    this.rig = rig;
    this.blades = blades;
    this.low = ctx.quality === 'low';
    this.time = u.uTime;
    const scene = ctx.scene;

    // Spirit ribbons: two tails from the headband knot, two from the sash knot.
    const local = (bone: string, modelPoint: THREE.Vector3) => modelPoint.clone().applyMatrix4(binder.restMatrix(bone).clone().invert());
    const sashKnot = (x: number) => local('spine_01', new THREE.Vector3(x, 0.99, -0.19).applyMatrix4(torso));
    this.ribbons = new SpiritRibbons(
      [
        { bone: rig.bone('Head'), local: new THREE.Vector3(0.028, 0.15, -0.115), length: 1.05, width: 0.075 },
        { bone: rig.bone('Head'), local: new THREE.Vector3(-0.028, 0.15, -0.115), length: 0.85, width: 0.065 },
        { bone: rig.bone('spine_01'), local: sashKnot(0.04), length: 0.95, width: 0.07 },
        { bone: rig.bone('spine_01'), local: sashKnot(-0.04), length: 0.75, width: 0.06 },
      ],
      this.low,
      this.time,
      this.torso,
    );
    scene.add(this.ribbons.mesh);

    this.aura = new RibbonStrip(additiveMaterial(ribbonVert, ribbonFrag, { uTime: this.time, uIntensity: this.auraIntensity }, { AURA: '' }), 3 * 8);
    this.aura.mesh.renderOrder = 6;
    scene.add(this.aura.mesh);

    this.lightning = new RibbonStrip(additiveMaterial(ribbonVert, lightningFrag, { uTime: this.time, uIntensity: this.boltIntensity }), 3 * 4 * BOLT_POINTS);
    this.lightning.mesh.renderOrder = 7;
    scene.add(this.lightning.mesh);
    for (let i = 0; i < 12; i++) this.bolts.push({ local: new Float32Array(BOLT_POINTS * 3), age: 1, life: 0, seed: i * 0.73 });

    this.flames = new FlameParticles(this.low ? 110 : 220, this.time, ctx.uniforms.uWind);
    scene.add(this.flames.mesh);

    // The cape hangs from a curve across the upper back, shoulder to shoulder.
    const cols = this.low ? 6 : 9;
    const capeTop: THREE.Vector3[] = [];
    for (let c = 0; c < cols; c++) {
      const s = (c / (cols - 1)) * 2 - 1;
      const p = new THREE.Vector3(-s * 0.23, 1.45 - Math.abs(s) * 0.03, -0.12 - 0.06 * (1 - s * s)).applyMatrix4(torso);
      capeTop.push(local('spine_03', p));
    }
    this.cape = new CrimsonCape({ bone: rig.bone('spine_03'), local: capeTop }, this.low, u, [this.torso, this.thighL, this.thighR]);
    scene.add(this.cape.mesh);

    // The celestial eye: a star glint on the eye that faces the camera.
    this.eye = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      additiveMaterial(glintVert, glintFrag, { uColor: { value: new THREE.Color(1.0, 0.55, 0.45) }, uIntensity: { value: 1 }, uSpin: { value: 0 }, uSize: { value: 0.3 } }),
    );
    this.eye.position.set(-0.033, 0.1, 0.1);
    this.eye.frustumCulled = false;
    this.eye.renderOrder = 8;
    rig.bone('Head').add(this.eye);

    this.light = new THREE.PointLight(EMBER, 0, 7, 2);
    this.light.castShadow = false;
    scene.add(this.light);
    this.hideAll();
  }

  /** Materials of every effect, for shader warm-up. */
  meshes(): THREE.Object3D[] {
    return [this.ribbons.mesh, this.aura.mesh, this.lightning.mesh, this.flames.mesh, this.cape.mesh, this.eye];
  }

  private hideAll(): void {
    this.ribbons.mesh.visible = false;
    this.aura.mesh.visible = false;
    this.lightning.mesh.visible = false;
    this.flames.mesh.visible = false;
    this.cape.mesh.visible = false;
    this.eye.visible = false;
  }

  /**
   * `life` (0–1) is how much power is left in the blades: 1 in play, falling to 0 after death, when
   * the mist sheath, the fire, the bolts and the light die away (the cloth keeps moving).
   */
  update(dt: number, game: Game, camera: THREE.Camera, uniforms: { uWind: { value: number } }, life = 1): void {
    const s = game.stance;
    const tier = s.tier;
    // A new run puts the warrior back mid-bridge: cloth dragged across that jump would snap and
    // tangle, so it is re-hung at rest instead (a dash covers well under a metre per frame).
    const teleported = Math.abs(game.warrior.x - this.lastX) > 2.5;
    this.lastX = game.warrior.x;
    if (tier !== this.tier || teleported) {
      // A new look: hide the old tier's extras and let cloth settle from rest.
      this.tier = tier;
      this.hideAll();
      this.ribbons.reset();
      this.cape.reset();
      this.flames.clear();
    }
    const k = game.katana;
    if (k.swing !== this.lastSwing && k.t >= 0) {
      this.lastSwing = k.swing;
      this.heat = 1;
    }
    const swinging = k.t >= 0;
    this.heat = Math.max(swinging ? 0.85 : 0, this.heat - dt * 1.6);
    const wind = uniforms.uWind.value;
    const time = this.time.value;
    this.rig.root.updateMatrixWorld(true);
    this.updateColliders();
    const floor = game.feetY + 0.03;

    // Tier 3: spirit ribbons and the mist sheath.
    const spirit = tier === 3;
    this.ribbons.mesh.visible = spirit;
    if (spirit) this.ribbons.update(dt, camera, wind, time, floor, this.rig.side);
    const sheathed = spirit && life > 0;
    this.aura.mesh.visible = sheathed;
    if (sheathed) {
      this.auraIntensity.value = (0.8 + this.heat * 1.2) * life;
      this.aura.begin(camera);
      for (const blade of this.blades) if (blade.visible) this.sheath(blade);
      this.aura.end();
    }

    // Tier 4: the ember blade burns (when the flame stance is on). Licks already shed burn out.
    const burning = tier === 4 && s.flame;
    this.flames.mesh.visible = burning;
    if (burning) this.burn(dt, time, life);

    // Tier 5: crimson lightning, the cape and the eye.
    const sovereign = tier === 5;
    this.lightning.mesh.visible = sovereign && life > 0;
    if (this.lightning.mesh.visible) this.strike(dt, camera, life);
    this.cape.mesh.visible = sovereign;
    if (sovereign) this.cape.update(dt, wind, time, floor, this.rig.side);
    this.eye.visible = sovereign && game.phase !== 'over';
    if (this.eye.visible) {
      const m = this.eye.material as THREE.ShaderMaterial;
      m.uniforms.uSpin.value = time * 0.6;
      m.uniforms.uIntensity.value = 0.85 + 0.35 * Math.sin(time * 3.1) + this.heat * 0.6;
    }

    // The blade light: ember orange or crimson, at the main blade, flickering with the fire / bolts.
    this.flicker += (this.rnd() - 0.5) * dt * 30;
    this.flicker *= Math.exp(-dt * 12);
    const lit = burning || sovereign;
    if (lit) {
      // Out toward the point, so the glow washes the deck and the swing rather than the face.
      bladePoint(1.05, 0.5, this.p).applyMatrix4(this.blades[0].matrixWorld);
      this.light.position.copy(this.p);
      this.light.color.copy(burning ? EMBER : CRIMSON);
      const base = (burning ? 0.6 + this.heat * 2.4 : 0.2 + this.heat * 1.1) * life;
      this.light.intensity = Math.max(0, base * (1 + this.flicker * 0.35 + (sovereign ? (this.rnd() < 0.1 ? 0.6 : 0) : 0)));
    } else {
      this.light.intensity = 0;
    }
  }

  /** Capsules around the torso and thighs keep the cape and ribbons outside the body. */
  private updateColliders(): void {
    const b = this.rig.bones;
    setCapsule(this.torso, b.pelvis, b.neck_01, this.p, this.q);
    setCapsule(this.thighL, b.thigh_l, b.calf_l, this.p, this.q);
    setCapsule(this.thighR, b.thigh_r, b.calf_r, this.p, this.q);
  }

  /** The spirit blade's mist sheath: a camera-facing band from collar to point. */
  private sheath(blade: THREE.Mesh): void {
    const n = 6;
    for (let i = 0; i < n; i++) {
      bladePoint(i / (n - 1), 0.55, this.p).applyMatrix4(blade.matrixWorld);
      this.scratch[i * 3] = this.p.x;
      this.scratch[i * 3 + 1] = this.p.y;
      this.scratch[i * 3 + 2] = this.p.z;
    }
    this.aura.line(this.scratch, n, 0.13, 0.07, this.blades.indexOf(blade) * 2.1);
  }

  /** Sheds flame licks along each burning edge; more, and flung harder, mid-swing. */
  private burn(dt: number, time: number, life: number): void {
    this.flames.heat.value = 0.3 + this.heat * 0.7;
    // A smoulder of small licks hugging the edge at rest; a sheet of fire mid-swing.
    const rate = (80 + this.heat * 300) * life;
    this.emitAcc += rate * dt;
    let count = Math.floor(this.emitAcc);
    this.emitAcc -= count;
    let turn = 0;
    while (count-- > 0) {
      // Round-robin over the drawn blades.
      let slot = -1;
      for (let tries = 0; tries < this.blades.length && slot < 0; tries++) {
        const i = turn++ % this.blades.length;
        if (this.blades[i].visible) slot = i;
      }
      if (slot < 0) break;
      const blade = this.blades[slot];
      const f = 0.08 + this.rnd() * 0.92;
      bladePoint(f, 0.65 + this.rnd() * 0.35, this.p).applyMatrix4(blade.matrixWorld);
      // Inherit a little of the blade's own motion: fire peels off a swing.
      bladePoint(1, 0.5, this.q).applyMatrix4(blade.matrixWorld);
      this.vel.subVectors(this.q, this.prevTips[slot]).multiplyScalar((f * 0.25) / Math.max(dt, 1 / 120));
      if (this.vel.lengthSq() > 64) this.vel.setLength(8);
      this.vel.x += (this.rnd() - 0.5) * 0.3;
      this.vel.y += 0.25 + this.rnd() * (0.3 + this.heat * 0.5);
      this.vel.z += (this.rnd() - 0.5) * 0.3;
      this.flames.emit(this.p, this.vel, 0.15 + this.rnd() * 0.18 + this.heat * 0.22, time);
    }
    for (let i = 0; i < this.blades.length; i++) bladePoint(1, 0.5, this.prevTips[i]).applyMatrix4(this.blades[i].matrixWorld);
    this.flames.flush();
  }

  /** Crimson lightning crawling over the black blades, re-striking every few frames. */
  private strike(dt: number, camera: THREE.Camera, life: number): void {
    this.boltIntensity.value = (0.7 + this.heat * 1.1) * life;
    this.lightning.begin(camera);
    let b = 0;
    const perBlade = this.heat > 0.3 ? 4 : 2;
    for (const blade of this.blades) {
      if (!blade.visible) continue;
      for (let j = 0; j < perBlade && b < this.bolts.length; j++, b++) {
        const bolt = this.bolts[b];
        bolt.age += dt;
        if (bolt.age >= bolt.life) this.regrow(bolt, j);
        for (let i = 0; i < BOLT_POINTS; i++) {
          this.p.fromArray(bolt.local, i * 3).applyMatrix4(blade.matrixWorld);
          this.p.toArray(this.scratch, i * 3);
        }
        this.lightning.line(this.scratch, BOLT_POINTS, 0.022 + this.heat * 0.02, 0.012, bolt.seed);
      }
    }
    this.lightning.end();
  }

  /** A new jagged path between two points of the blade (or off its point, mid-swing). */
  private regrow(bolt: Bolt, j: number): void {
    const r = this.rnd;
    bolt.age = 0;
    bolt.life = BOLT_LIFE * (0.6 + r() * 0.9);
    bolt.seed = r() * 10;
    const a = 0.05 + r() * 0.5;
    const span = 0.25 + r() * 0.55;
    const flare = j >= 2 && r() < 0.6;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const f = i / (BOLT_POINTS - 1);
      const along = flare ? 0.85 + f * 0.5 : Math.min(1.02, a + f * span);
      const jag = i === 0 || i === BOLT_POINTS - 1 ? 0.25 : 1;
      bladePoint(Math.min(along, 1), 0.5, this.q);
      bolt.local[i * 3] = this.q.x + (r() - 0.5) * 0.07 * jag;
      bolt.local[i * 3 + 1] = this.q.y + (r() - 0.5) * 0.08 * jag + (flare ? f * 0.12 : 0);
      bolt.local[i * 3 + 2] = flare ? BLADE_BASE + BLADE_LENGTH * along : this.q.z;
    }
  }
}

function setCapsule(c: Capsule, a: THREE.Object3D, b: THREE.Object3D, p: THREE.Vector3, q: THREE.Vector3): void {
  p.setFromMatrixPosition(a.matrixWorld);
  q.setFromMatrixPosition(b.matrixWorld);
  c.ax = p.x;
  c.ay = p.y;
  c.az = p.z;
  c.bx = q.x;
  c.by = q.y;
  c.bz = q.z;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
