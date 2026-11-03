import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';

/**
 * STUB (to be replaced): the mountain-top setting. Owns the sky, distant peaks, anchor cliffs,
 * gorge fog, storm sea, the moonlight (with shadows), ambient light, fog and lightning.
 * It writes ctx.uniforms.uLightning.
 */
export class MountainPeakScene implements RenderModule {
  readonly moonLight: THREE.DirectionalLight;
  private readonly ctx: RenderContext;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    ctx.scene.background = new THREE.Color(0x0b1018);
    ctx.scene.fog = new THREE.FogExp2(0x0b1018, 0.012);
    ctx.scene.add(new THREE.HemisphereLight(0x8899bb, 0x111418, 0.6));
    this.moonLight = new THREE.DirectionalLight(0xc8d6ff, 1.6);
    this.moonLight.position.set(-20, 30, 25);
    this.moonLight.castShadow = true;
    ctx.scene.add(this.moonLight);
  }

  update(dt: number, _game: Game): void {
    const u = this.ctx.uniforms.uLightning;
    u.value = Math.max(0, u.value - dt * 3);
  }

  handleEvent(e: GameEvent): void {
    if (e.type === 'lightning') this.ctx.uniforms.uLightning.value = e.power;
  }
}
