import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { GearBinder } from './gear/GearBinder.ts';
import { katanaGeometry, makeBladeMaterial, makeBladeUniforms } from './gear/Katana.ts';
import type { BladeStyle, BladeUniforms } from './gear/Katana.ts';
import { SlashArcs } from './gear/SlashArcs.ts';
import { StateCues } from './gear/StateCues.ts';
import { TierEffects } from './gear/TierEffects.ts';
import { makeGearMaterial, tailorTiers } from './gear/TierOutfits.ts';
import type { TierLook } from './gear/TierOutfits.ts';
import { WarriorRig } from './gear/WarriorRig.ts';
import type { BoneName } from './gear/WarriorRig.ts';
import { makeWarriorUniforms, shadeWarrior } from './gear/WarriorShading.ts';
import type { WarriorUniforms } from './gear/WarriorShading.ts';

const STYLES: BladeStyle[] = ['chipped', 'polished', 'spirit', 'ember', 'obsidian'];

/** Where each blade is held, in its bone's space: grip centre and orientation of the katana frame. */
const GRIPS: { bone: BoneName; at: THREE.Matrix4 }[] = [
  // Main hand: blade out of the thumb side of the fist, edge toward the knuckles.
  { bone: 'hand_r', at: new THREE.Matrix4().makeTranslation(-0.022, 0.082, 0.0) },
  { bone: 'hand_l', at: new THREE.Matrix4().makeTranslation(0.022, 0.082, 0.0) },
  // Third blade: bitten at the corner of the mouth, the blade swept back past the far cheek so it
  // reads in profile as a line trailing behind the head.
  {
    bone: 'Head',
    at: new THREE.Matrix4().compose(
      new THREE.Vector3(0.05, 0.035, 0.105),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.36, 0.06, -0.93).normalize()),
      new THREE.Vector3(1, 1, 1),
    ),
  },
];

/** Moonlight direction if the scene has no shadow-casting directional light (behind, above, left). */
const DEFAULT_MOON = new THREE.Vector3(-0.45, 0.72, -0.53).normalize();

/**
 * The warrior: the rigged Quaternius character driven by the simulation (WarriorRig), dressed in
 * the gear of the current cosmetic tier (TierOutfits), holding one to three katanas, with the slash
 * crescents (SlashArcs), each tier's extras (TierEffects: spirit ribbons, burning edge, crimson
 * lightning, cape, celestial eye, the blade light) and the state cues (StateCues: spirit shield,
 * vulnerable and exposed).
 *
 * Draw calls at the heaviest stance (tier 5, three blades, mid-slash, shield up): body 6, gear 1–3,
 * blades 3, cape 1, lightning 1, eye 1, arcs 1, shield 1, glint 1 — about 18, plus the casters in
 * the moon's shadow pass. Shaders for every tier are compiled on the first frame (`warmUp`), so a
 * level-up mid-run never stalls on a compile.
 */
export class CosmeticsRenderer implements RenderModule {
  private readonly ctx: RenderContext;
  private readonly rig: WarriorRig;
  private readonly u: WarriorUniforms;
  private readonly tiers: TierLook[];
  private readonly cloth: THREE.MeshStandardMaterial;
  private readonly hands: THREE.MeshStandardMaterial;
  private readonly gearGlow = { value: 1 };
  /** Blade meshes by slot (main hand, off hand, mouth), restyled per tier. */
  private readonly slots: THREE.Mesh[] = [];
  private readonly bladeGeometry = new Map<BladeStyle, THREE.BufferGeometry>();
  private readonly bladeMaterial = new Map<BladeStyle, THREE.MeshStandardMaterial>();
  private readonly blade = {} as Record<BladeStyle, BladeUniforms>;
  private readonly arcs: SlashArcs;
  private readonly effects: TierEffects;
  private readonly cues: StateCues;
  private readonly moon: THREE.DirectionalLight | null;
  private readonly aimPoint = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();
  /** Key of the outfit now worn (tier, blades in hand, triple), or −1 to force a re-dress. */
  private dressed = -1;
  private tier = 0;
  /** Blades in hand for the current stance. */
  private bladeHands = 1;
  private heat = 0;
  /** 1 while the warrior lives; after death it falls to 0 and the blades go cold. */
  private life = 1;
  private lastSwing = 0;
  /** Frames of shader warm-up still to undo (see `warmUp`). */
  private warm: (() => void) | null = null;
  private warmed = false;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    const low = ctx.quality === 'low';
    this.u = makeWarriorUniforms();
    this.rig = new WarriorRig(ctx);
    const t = ctx.assets.tex;
    this.cloth = shadeWarrior(new THREE.MeshStandardMaterial({ map: t.ranger_d, normalMap: t.ranger_n, roughness: 0.85 }), this.u, {
      key: 'cloth',
      wet: 1,
      snow: true,
      dye: { main: 0x3b3428, trim: 0x2a2018, metal: 0x5c574f },
    });
    this.hands = shadeWarrior(new THREE.MeshStandardMaterial({ map: t.arm_m_d, normalMap: t.arm_m_n, roughness: 0.75 }), this.u, {
      key: 'hands',
      wet: 0.5,
      dye: { main: 0x7a6e5c, trim: 0x7a6e5c, metal: 0x7a6e5c },
    });
    const head = shadeWarrior(new THREE.MeshStandardMaterial({ map: t.head_m_d, normalMap: t.head_m_n, roughness: 0.62 }), this.u, { key: 'head', wet: 0.4, snow: true });
    const p = this.rig.parts;
    p.cloth.material = this.cloth;
    p.skin.material = this.hands;
    p.head.material = head;
    p.eye.material = new THREE.MeshStandardMaterial({ map: t.eye_d, roughness: 0.15 });
    p.brow.material = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.9 });
    p.hair.material = shadeWarrior(new THREE.MeshStandardMaterial({ color: 0x100c0a, roughness: 0.55 }), this.u, { key: 'hair', wet: 0.8, snow: true });
    // Tiny parts barely show at gameplay distance; their shadows are not worth a draw call each.
    for (const name of ['eye', 'brow']) p[name].castShadow = false;

    // Gear is skinned in the relaxed standing pose, in the torso's own frame.
    this.rig.poseForBinding();
    const binder = new GearBinder(p.cloth);
    const torso = this.torsoFrame(binder);
    this.tiers = tailorTiers({ binder, torso, low, u: this.u, assets: ctx.assets, gear: makeGearMaterial(this.u, this.gearGlow) });
    for (const look of this.tiers) {
      look.group.visible = false;
      this.rig.model.add(look.group);
    }

    for (const style of STYLES) {
      this.blade[style] = makeBladeUniforms(style);
      this.bladeGeometry.set(style, katanaGeometry({ style, low, seed: 7 }));
      this.bladeMaterial.set(style, makeBladeMaterial(this.u, style, this.blade[style]));
    }
    for (const g of GRIPS) {
      const m = new THREE.Mesh(this.bladeGeometry.get('chipped'), this.bladeMaterial.get('chipped'));
      m.matrixAutoUpdate = false;
      m.matrix.copy(g.at);
      m.castShadow = !low;
      m.visible = false;
      this.rig.bone(g.bone).add(m);
      this.slots.push(m);
    }
    ctx.scene.add(this.rig.root);

    this.arcs = new SlashArcs(low);
    ctx.scene.add(this.arcs.mesh);
    this.effects = new TierEffects(ctx, this.rig, this.slots, binder, torso, this.u);
    this.cues = new StateCues(low);
    ctx.scene.add(this.cues.shield, this.cues.glint);

    // The rim follows the scene's moon (MountainPeakScene's shadow-casting light) when there is one.
    let moon: THREE.DirectionalLight | null = null;
    ctx.scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (!moon && l.isDirectionalLight && l.castShadow) moon = l;
    });
    this.moon = moon;
  }

  /** The torso's frame at rest: origin under the chest, z along the chest's facing, level. */
  private torsoFrame(binder: GearBinder): THREE.Matrix4 {
    const chest = binder.restMatrix('spine_03');
    const forward = new THREE.Vector3().setFromMatrixColumn(chest, 2).setY(0).normalize();
    const origin = binder.restPosition('spine_02').setY(0);
    const yaw = Math.atan2(forward.x, forward.z);
    return new THREE.Matrix4().makeRotationY(yaw).setPosition(origin);
  }

  /** Puts on the tier's gear and the right number of blades for the stance. */
  private dress(game: Game): void {
    const s = game.stance;
    const hands = s.dual || s.triple ? 2 : 1;
    this.bladeHands = hands;
    const key = s.tier * 10 + hands * 2 + (s.triple ? 1 : 0);
    if (key === this.dressed) return;
    // A new tier mid-run (not the first dressing) flashes along the silhouette.
    if (this.tier !== 0 && s.tier !== this.tier) this.cues.flashTier();
    this.dressed = key;
    this.tier = s.tier;
    const look = this.tiers[s.tier - 1];
    for (const l of this.tiers) l.group.visible = l === look;
    const dye = this.cloth.userData.dye;
    dye.uDyeMain.value.set(look.dye.main);
    dye.uDyeTrim.value.set(look.dye.trim);
    dye.uDyeMetal.value.set(look.dye.metal);
    const hd = this.hands.userData.dye;
    hd.uDyeMain.value.set(look.hands);
    hd.uDyeTrim.value.set(look.hands);
    hd.uDyeMetal.value.set(look.hands);
    this.rig.parts.hair.visible = look.hair;
    const geo = this.bladeGeometry.get(look.blade);
    const mtl = this.bladeMaterial.get(look.blade);
    if (!geo || !mtl) return;
    for (let i = 0; i < this.slots.length; i++) {
      const m = this.slots[i];
      m.geometry = geo;
      m.material = mtl;
      m.visible = i === 0 || (i === 1 && hands === 2) || (i === 2 && s.triple);
    }
    // The first saya is the main blade's (always drawn, so empty); the second holds the off-hand
    // blade, which waits sheathed with only its grip showing when the stance fights with one.
    if (look.hilts[0]) look.hilts[0].visible = false;
    if (look.hilts[1]) look.hilts[1].visible = hands < 2;
  }

  handleEvent(e: GameEvent, _game: Game): void {
    this.rig.handleEvent(e);
    this.cues.handleEvent(e);
  }

  update(dt: number, game: Game): void {
    if (this.warm) {
      this.warm();
      this.warm = null;
      this.dressed = -1;
    }
    const u = this.u;
    const shared = this.ctx.uniforms;
    u.uTime.value += dt;
    this.dress(game);

    // Weather on the cloth: soaked with the world, snow settling while it snows (rain washes it off).
    u.uWet.value = shared.uWetness.value;
    const snow = u.uSnowCover;
    snow.value = THREE.MathUtils.clamp(snow.value + (shared.uSnow.value * 0.09 - 0.012 - shared.uRain.value * 0.06) * dt, 0, 0.75);
    if (game.warrior.rolling) snow.value = Math.max(0, snow.value - dt * 2);

    // Rim light from the moon, in view space.
    const cam = this.ctx.camera;
    if (this.moon) this.moonDir.subVectors(this.moon.position, this.moon.target.position).normalize();
    else this.moonDir.copy(DEFAULT_MOON);
    u.uMoonDir.value.copy(this.moonDir).transformDirection(cam.matrixWorldInverse);

    // Blade heat: flares on every swing, settles back to a smoulder.
    const k = game.katana;
    if (k.swing !== this.lastSwing && k.t >= 0) {
      this.lastSwing = k.swing;
      this.heat = 1;
    }
    this.heat = Math.max(k.t >= 0 ? 0.8 : 0, this.heat - dt * 1.5);
    this.life = game.phase === 'over' ? Math.max(0, this.life - dt * 1.5) : 1;
    const style = this.tiers[this.tier - 1].blade;
    const flame = style !== 'ember' || game.stance.flame;
    this.blade[style].uBladeHeat.value = flame ? (0.15 + this.heat * 0.85) * this.life : 0;
    this.gearGlow.value = (0.7 + this.heat * 0.6) * (0.4 + 0.6 * this.life);

    this.arcs.update(dt, game);
    const aim = this.arcs.leadingEdge(game, this.aimPoint) ? this.aimPoint : null;
    this.rig.update(dt, game, aim, this.bladeHands);
    this.effects.update(dt, game, cam, shared, this.life);
    this.cues.update(dt, game, this.rig, u.uTime.value, u.uCueRim.value);

    if (!this.warmed) this.warmUp();
  }

  /**
   * Compiles every tier's shaders on the first frame: everything is drawn once with colour and
   * depth writes off, then put back on the next frame. Without this the first level-up into a new
   * tier would stall while its materials compile. Gear shares its shadow-pass shaders with tier 1's,
   * so it stays out of the shadow map; the tier effects keep theirs (the cape needs its own).
   */
  private warmUp(): void {
    this.warmed = true;
    const scene = this.ctx.scene;
    const shown: { o: THREE.Object3D; visible: boolean; shadow: boolean }[] = [];
    const mats = new Map<THREE.Material, { color: boolean; depth: boolean }>();
    const extra: THREE.Object3D[] = [];
    const reveal = (o: THREE.Object3D, shadows = false) => {
      o.traverse((c) => {
        shown.push({ o: c, visible: c.visible, shadow: c.castShadow });
        c.visible = true;
        c.castShadow = shadows && c.castShadow;
        const m = (c as THREE.Mesh).material;
        if (m) for (const mm of Array.isArray(m) ? m : [m]) if (!mats.has(mm)) mats.set(mm, { color: mm.colorWrite, depth: mm.depthWrite });
      });
    };
    for (const look of this.tiers) reveal(look.group);
    for (const o of this.effects.meshes()) reveal(o, true);
    reveal(this.cues.shield);
    reveal(this.cues.glint);
    reveal(this.arcs.mesh);
    // One stand-in per blade style and slash style, so every variant compiles.
    for (const style of STYLES) {
      const m = new THREE.Mesh(this.bladeGeometry.get(style), this.bladeMaterial.get(style));
      this.rig.bone('hand_r').add(m);
      extra.push(m);
    }
    for (const mat of this.arcs.all()) {
      const m = new THREE.Mesh(this.arcs.mesh.geometry, mat);
      m.frustumCulled = false;
      scene.add(m);
      extra.push(m);
    }
    for (const e of extra) reveal(e);
    for (const m of mats.keys()) {
      m.colorWrite = false;
      m.depthWrite = false;
    }
    this.warm = () => {
      for (const e of extra) e.removeFromParent();
      for (const s of shown) {
        s.o.visible = s.visible;
        s.o.castShadow = s.shadow;
      }
      for (const [m, s] of mats) {
        m.colorWrite = s.color;
        m.depthWrite = s.depth;
      }
    };
  }
}
