import * as THREE from 'three';
import type { Game } from '../core/Game.ts';
import { makeWetMaterial } from '../render/Assets.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { placeOnDeck } from '../render/RenderContext.ts';
import { DECK_HALF_WIDTH, PLANK_COUNT, PLANK_WIDTH } from '../scene/SuspensionBridge.ts';

/**
 * STUB (to be replaced): the suspension bridge. Planks follow the sway model; broken planks vanish.
 * The real module adds ropes, posts, lanterns, cracks, falling planks and the snow mesh.
 */
export class BridgeRenderer implements RenderModule {
  private readonly planks: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();

  constructor(ctx: RenderContext) {
    const set = ctx.assets.pbr('plank', 0.3, 1.5);
    const material = makeWetMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap }, ctx.uniforms);
    this.planks = new THREE.InstancedMesh(new THREE.BoxGeometry(PLANK_WIDTH, 0.05, DECK_HALF_WIDTH * 2), material, PLANK_COUNT);
    this.planks.castShadow = this.planks.receiveShadow = true;
    ctx.scene.add(this.planks);
  }

  update(_dt: number, game: Game): void {
    for (const p of game.bridge.planks) {
      placeOnDeck(this.dummy, game, p.x, -0.025);
      this.dummy.scale.setScalar(p.broken ? 0.0001 : 1);
      this.dummy.updateMatrix();
      this.planks.setMatrixAt(p.index, this.dummy.matrix);
    }
    this.planks.instanceMatrix.needsUpdate = true;
  }
}
