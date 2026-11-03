import * as THREE from 'three';
import type { Game } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { placeOnDeck } from '../render/RenderContext.ts';

/**
 * STUB (to be replaced): the warrior. The real module loads the Quaternius rig from ctx.assets,
 * drives its animations from the simulation, dresses it in the tier 1–5 gear, and draws the blades
 * and slash arcs.
 */
export class CosmeticsRenderer implements RenderModule {
  private readonly body: THREE.Mesh;

  constructor(ctx: RenderContext) {
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x223355 }));
    this.body.castShadow = true;
    ctx.scene.add(this.body);
  }

  update(_dt: number, game: Game): void {
    placeOnDeck(this.body, game, game.warrior.x, 0.85);
  }
}
