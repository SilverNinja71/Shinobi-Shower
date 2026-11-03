import * as THREE from 'three';
import type { Game, GameEvent } from '../../core/Game.ts';
import { worldX } from '../../render/RenderContext.ts';
import glintFrag from '../../shaders/SpiritGlint.frag';
import glintVert from '../../shaders/SpiritGlint.vert';
import shieldFrag from '../../shaders/SpiritShield.frag';
import shieldVert from '../../shaders/SpiritShield.vert';
import { additiveMaterial } from './FxMaterial.ts';
import type { WarriorRig } from './WarriorRig.ts';

const SHIELD_CRACK = 0.38;
const SHIELD_REFORM = 0.5;
const GLINT_TIME = 0.32;
const VULNERABLE = new THREE.Color(1.0, 0.07, 0.09);
const TIER_UP = new THREE.Color(1.0, 0.82, 0.5);

/**
 * What the warrior's state looks like at a glance:
 *  - the spirit shield (stance.aura with the shield up): a faint violet bubble that cracks apart
 *    when hail breaks it and swells back when it reforms;
 *  - vulnerable (game.vulnerable > 0): a pulsing red rim on the whole figure;
 *  - exposed after a missed slash (game.exposed): a brief red star glint at the chest, and a
 *    faint red rim while it lasts;
 *  - a new tier: a warm flash along the silhouette as the gear changes.
 * The rims ride the shared `uCueRim` uniform of every warrior material: no extra draw calls.
 */
export class StateCues {
  readonly shield: THREE.Mesh;
  readonly glint: THREE.Mesh;
  private readonly shieldU = { uTime: { value: 0 }, uIntensity: { value: 0.6 }, uCrack: { value: 0 }, uSwell: { value: 1 } };
  private readonly glintU = { uColor: { value: new THREE.Color(1.0, 0.16, 0.14) }, uIntensity: { value: 0 }, uSpin: { value: 0 }, uSize: { value: 0.62 } };
  private crackT = 1;
  private reformT = 1;
  private glintT = 1;
  private tierFlash = 0;
  private wasExposed = false;
  private readonly chest = new THREE.Vector3();

  constructor(low: boolean) {
    const sphere = new THREE.SphereGeometry(1, low ? 20 : 36, low ? 14 : 24);
    this.shield = new THREE.Mesh(sphere, additiveMaterial(shieldVert, shieldFrag, this.shieldU, {}, THREE.FrontSide));
    this.shield.frustumCulled = false;
    this.shield.renderOrder = 9;
    this.shield.visible = false;
    this.glint = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additiveMaterial(glintVert, glintFrag, this.glintU));
    this.glint.frustumCulled = false;
    this.glint.renderOrder = 10;
    this.glint.visible = false;
  }

  handleEvent(e: GameEvent): void {
    if (e.type === 'shatter') this.crackT = 0;
    else if (e.type === 'reform') this.reformT = 0;
  }

  /** A warm flash along the silhouette when the gear changes tier. */
  flashTier(): void {
    this.tierFlash = 1;
  }

  /** Updates the bubble and the glint, and writes the rim cue colour (× strength) into `rim`. */
  update(dt: number, game: Game, rig: WarriorRig, time: number, rim: THREE.Color): void {
    this.crackT += dt;
    this.reformT += dt;
    this.glintT += dt;
    this.tierFlash = Math.max(0, this.tierFlash - dt * 1.4);
    const playing = game.phase !== 'over';
    const w = game.warrior;

    // Spirit shield.
    const cracking = this.crackT < SHIELD_CRACK;
    const up = game.stance.aura && game.shieldUp;
    this.shield.visible = playing && game.stance.aura && (up || cracking);
    if (this.shield.visible) {
      const x = w.x;
      const height = rig.rollingPose ? 0.6 : 0.95;
      this.shield.position.set(worldX(x), game.feetY + height, game.bridge.lateral(x));
      this.shield.scale.set(0.95, rig.rollingPose ? 0.75 : 1.12, 0.95);
      this.shield.updateMatrix();
      this.shieldU.uTime.value = time;
      if (cracking) {
        const k = this.crackT / SHIELD_CRACK;
        this.shieldU.uCrack.value = k;
        this.shieldU.uSwell.value = 1 + k * 0.28;
        this.shieldU.uIntensity.value = 1.8 * (1 - k);
      } else {
        const k = Math.min(1, this.reformT / SHIELD_REFORM);
        this.shieldU.uCrack.value = 0;
        this.shieldU.uSwell.value = 0.55 + 0.45 * (1 - (1 - k) * (1 - k));
        this.shieldU.uIntensity.value = 0.34 + 0.05 * Math.sin(time * 2.3) + (1 - k) * 1.6;
      }
    }

    // Exposed: a red glint the moment a slash whiffs, then a faint red rim until the blade is ready.
    const exposed = game.exposed && playing;
    if (exposed && !this.wasExposed) this.glintT = 0;
    this.wasExposed = exposed;
    const g = this.glintT < GLINT_TIME ? this.glintT / GLINT_TIME : 1;
    this.glint.visible = g < 1;
    if (this.glint.visible) {
      this.chest.setFromMatrixPosition(rig.bone('spine_03').matrixWorld);
      this.glint.position.copy(this.chest);
      this.glintU.uIntensity.value = Math.min(1, g * 8) * (1 - g) * 2.6;
      this.glintU.uSpin.value = g * 1.2;
      this.glintU.uSize.value = 0.45 + g * 0.5;
    }

    // Rim: vulnerable pulse, exposed tint and flash, tier-up flash.
    rim.setRGB(0, 0, 0);
    if (game.vulnerable > 0 && playing) {
      const fade = Math.min(1, game.vulnerable / 0.4);
      addScaled(rim, VULNERABLE, fade * (0.65 + 0.55 * Math.sin(time * 12)));
    }
    if (exposed) addScaled(rim, VULNERABLE, 0.35 + (g < 1 ? (1 - g) * 1.6 : 0));
    if (this.tierFlash > 0) addScaled(rim, TIER_UP, this.tierFlash * 2.2);
  }
}

function addScaled(out: THREE.Color, c: THREE.Color, k: number): void {
  out.r += c.r * k;
  out.g += c.g * k;
  out.b += c.b * k;
}
