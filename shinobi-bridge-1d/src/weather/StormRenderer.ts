import * as THREE from 'three';
import type { Game } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { worldX } from '../render/RenderContext.ts';

const MAX = 4000;

/**
 * STUB (to be replaced): draws the gameplay drops as dots. The real module adds GPU rain sheets
 * (RainSheet.vert/.frag), streaks, mist, snow clumps, icy hail with telegraphs, and splashes.
 */
export class StormRenderer implements RenderModule {
  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(ctx: RenderContext) {
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial(), MAX);
    this.mesh.frustumCulled = false;
    ctx.scene.add(this.mesh);
  }

  update(_dt: number, game: Game): void {
    let n = 0;
    for (const d of game.drops) {
      if (n >= MAX) break;
      this.dummy.position.set(worldX(d.x), d.y, d.z);
      this.dummy.scale.setScalar(Math.max(0.04, d.r));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.mesh.setColorAt(n, this.color.set(d.kind === 'hail' ? 0xddeeff : d.kind === 'snow' ? 0xffffff : 0x66ccff));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
