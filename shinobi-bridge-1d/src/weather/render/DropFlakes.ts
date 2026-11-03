import * as THREE from 'three';
import { worldX } from '../../render/RenderContext.ts';
import flakeFrag from '../../shaders/Snowflake.frag';
import spriteVert from '../../shaders/SnowflakeSprite.vert';
import type { Drop } from '../PrecipitationDroplet.ts';
import { InstancePool, spriteQuad, stormMaterial } from './StormMaterial.ts';
import type { Shared } from './StormMaterial.ts';

/**
 * Gameplay snowflakes too small to be clumps: soft fluffy tufts (camera-facing sprites), brighter and
 * more solid than the cosmetic snowfall, turning slowly as they sway down.
 */
export class DropFlakes {
  readonly mesh: THREE.Mesh;
  private readonly pool: InstancePool;
  private readonly pos: Float32Array;
  private readonly look: Float32Array;

  constructor(scene: THREE.Scene, capacity: number, shared: { lightning: Shared<number>; viewport: Shared<THREE.Vector2> }) {
    this.pool = new InstancePool(spriteQuad(), capacity, { aPos: 4, aLook: 4 });
    this.pos = this.pool.array('aPos');
    this.look = this.pool.array('aLook');
    const material = stormMaterial({
      vertexShader: spriteVert,
      fragmentShader: flakeFrag,
      defines: { FLUFFY: '' },
      uniforms: {
        uLightning: shared.lightning,
        uViewport: shared.viewport,
        uColor: { value: new THREE.Color(0.86, 0.9, 1.0).multiplyScalar(1.15) },
        uOpacity: { value: 0.92 },
      },
    });
    this.mesh = new THREE.Mesh(this.pool.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  begin(): void {
    this.pool.begin();
  }

  add(d: Drop): void {
    const i = this.pool.next();
    if (i < 0) return;
    this.pos[i * 4] = worldX(d.x);
    this.pos[i * 4 + 1] = d.y;
    this.pos[i * 4 + 2] = d.z;
    this.pos[i * 4 + 3] = d.r;
    // Flakes turn slowly with their sway; the seed shapes each tuft.
    this.look[i * 4] = Math.sin(d.age * 0.9 + d.phase) * 0.6 + d.phase;
    this.look[i * 4 + 1] = 1;
    this.look[i * 4 + 2] = (d.id * 0.618034) % 1;
    this.look[i * 4 + 3] = 0;
  }

  end(): void {
    this.pool.end(this.mesh);
  }
}
