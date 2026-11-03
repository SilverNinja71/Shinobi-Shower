import * as THREE from 'three';
import fogFrag from '../../shaders/GorgeFog.frag';
import fogVert from '../../shaders/GorgeFog.vert';
import type { RenderContext } from '../../render/RenderContext.ts';
import type { EnvUniforms } from './EnvUniforms.ts';
import { Random } from './noise.ts';
import { PALETTE } from './palette.ts';

/**
 * Depths of the fog sheets, top to bottom. The first lies well below the deck: the open drop under
 * the planks is what sells the height, with only wisps drifting through it.
 */
const SHEETS = { high: [-14, -25, -42, -70, -115], low: [-16, -45, -110] };
const WISPS = { high: 40, low: 18 };
/** Wisps drift along x and wrap over ±this span. */
const WISP_SPAN = 42;
/** Extent of each sheet: wider than the gorge, reaching far back toward the ranges. */
const SHEET_X = 95;
const SHEET_Z0 = -340;
const SHEET_Z1 = 60;

/**
 * The fog that fills the gorge: layered horizontal sheets (one draw call, deepest first so they
 * blend back to front from above) and vertical wisps rising along the walls (one instanced call).
 */
export class GorgeFog {
  readonly sheets: THREE.Mesh;
  readonly wisps: THREE.Mesh;

  constructor(ctx: RenderContext, env: EnvUniforms, noise: THREE.Texture) {
    const u = ctx.uniforms;
    const high = ctx.quality === 'high';
    const shared = {
      uNoise: { value: noise },
      uTime: u.uTime,
      uLightning: u.uLightning,
      uMist: u.uMist,
      uRain: u.uRain,
      uDrift: env.uWindDrift,
      uFogColor: { value: PALETTE.gorgeFog },
      uMoonDir: env.uMoonDir,
      uMoonColor: { value: PALETTE.moon },
      uFlashDir: env.uFlashDir,
      uFlashColor: { value: PALETTE.lightning },
    };

    this.sheets = new THREE.Mesh(
      sheetGeometry(high ? SHEETS.high : SHEETS.low),
      new THREE.ShaderMaterial({
        vertexShader: fogVert,
        fragmentShader: fogFrag,
        uniforms: { ...shared, uOpacity: { value: high ? 1 : 1.35 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.sheets.name = 'env-fog-sheets';
    // Drawn before the other transparent things: everything else is nearer the camera.
    this.sheets.renderOrder = -20;
    this.sheets.frustumCulled = false;
    ctx.scene.add(this.sheets);

    this.wisps = new THREE.Mesh(
      wispGeometry(high ? WISPS.high : WISPS.low),
      new THREE.ShaderMaterial({
        vertexShader: fogVert,
        fragmentShader: fogFrag,
        uniforms: { ...shared, uOpacity: { value: 1 }, uSpan: { value: WISP_SPAN } },
        defines: { WISP: '' },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.wisps.name = 'env-fog-wisps';
    this.wisps.renderOrder = -19;
    this.wisps.frustumCulled = false;
    ctx.scene.add(this.wisps);
  }
}

function sheetGeometry(depths: number[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const layer: number[] = [];
  const index: number[] = [];
  const deepest = depths[depths.length - 1];
  // Deepest first: from above, that is back to front.
  for (let k = depths.length - 1; k >= 0; k--) {
    const y = depths[k];
    const base = pos.length / 3;
    pos.push(-SHEET_X, y, SHEET_Z0, SHEET_X, y, SHEET_Z0, SHEET_X, y, SHEET_Z1, -SHEET_X, y, SHEET_Z1);
    const l = y / deepest;
    layer.push(l, l, l, l);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
  g.setIndex(index);
  return g;
}

function wispGeometry(count: number): THREE.InstancedBufferGeometry {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.attributes.position);
  const r = new Random(0x3159);
  const centre = new Float32Array(count * 3);
  const size = new Float32Array(count * 2);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Most wisps hug the walls, where cold air spills down and fog curls back up the rock.
    const wall = r.chance(0.65);
    const y = wall ? r.range(-55, -12) : r.range(-90, -16);
    centre[i * 3] = wall ? (r.chance(0.5) ? -1 : 1) * r.range(12, 19) : r.range(-WISP_SPAN, WISP_SPAN);
    centre[i * 3 + 1] = y;
    centre[i * 3 + 2] = wall ? r.range(-90, 12) : r.range(-220, -20);
    size[i * 2] = r.range(8, 22);
    // Never tall enough to reach up past the deck (the shader also bobs them by up to 3 m).
    size[i * 2 + 1] = Math.min(r.range(16, 42), 2 * (-7 - y));
    seed[i] = r.next();
  }
  g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centre, 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  g.instanceCount = count;
  return g;
}
