import * as THREE from 'three';
import type { Game } from '../../core/Game.ts';
import type { RenderContext } from '../../render/RenderContext.ts';
import snowSource from '../../shaders/Snow.glsl';
import type { SnowAccumulator } from '../SnowAccumulator.ts';
import { SNOW_CELL } from '../SnowAccumulator.ts';
import { DECK_GLSL } from './DeckSampler.ts';
import type { DeckSampler } from './DeckSampler.ts';
import { extendMaterial, glslSections } from './glsl.ts';
import { BRIDGE_LENGTH, layoutDefines } from './layout.ts';

const SNOW = glslSections(snowSource);
const CELLS = Math.ceil(BRIDGE_LENGTH / SNOW_CELL);
/** The snow surface floats this far over the plank tops, so thin snow never fights them for depth. */
const SNOW_LIFT = 0.004;
/** Metres of snow per texture repeat. */
const TEX_SCALE = 1.4;
/** A drift slumps into the hole where a plank broke away over this distance, plus most of its depth. */
const SNOW_LIP = 0.12;

/**
 * Snow lying on the deck: a grid over the planks lifted by the simulation's snow height map into
 * rounded drifts, thickest down the middle of the deck. The height map is re-uploaded (a 240-texel
 * texture) only when `game.snow.version` changes; the shader places every vertex on the swaying deck
 * each frame, and cuts the snow away over open planks.
 */
export class DeckSnow {
  private readonly data = new Float32Array(CELLS * 4);
  private readonly texture: THREE.DataTexture;
  private readonly mesh: THREE.Mesh;
  /** Grid columns per snow cell, and index count per column. */
  private readonly perCell: number;
  private readonly perColumn: number;
  private source: SnowAccumulator | null = null;
  private version = -1;

  constructor(ctx: RenderContext, parent: THREE.Object3D, deck: DeckSampler) {
    const low = ctx.quality === 'low';
    this.texture = new THREE.DataTexture(this.data, CELLS, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    // Two columns per snow cell along the lane (one on low), rows across the deck.
    this.perCell = low ? 1 : 2;
    const cols = CELLS * this.perCell;
    const rows = low ? 6 : 10;
    this.perColumn = rows * 6;
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * BRIDGE_LENGTH;
      for (let j = 0; j <= rows; j++) {
        // Rows bunch toward the edges, where the drift's rounded flank curves fastest.
        const t = (j / rows) * 2 - 1;
        const zn = Math.sign(t) * Math.abs(t) ** 0.8;
        position.push(x, 0, zn);
        uv.push(x / TEX_SCALE, (zn * 0.8) / TEX_SCALE);
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j;
        const b = a + rows + 1;
        // Facing up: x runs along i, z along j.
        index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(position.length).fill(0), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);

    const set = ctx.assets.pbr('snow', 1, 1);
    const material = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: set.roughnessMap,
      color: 0xf0f4fb,
      roughness: 0.9,
      metalness: 0,
    });
    const defines = [
      layoutDefines(),
      `#define SNOW_CELLS ${CELLS.toFixed(1)}`,
      `#define SNOW_CELL ${SNOW_CELL}`,
      `#define SNOW_LIFT ${SNOW_LIFT}`,
      `#define SNOW_TEX_SCALE ${TEX_SCALE}`,
      `#define SNOW_LIP ${SNOW_LIP}`,
      '',
    ].join('\n');
    extendMaterial(
      material,
      'deck-snow',
      { uDeck: deck.uniform, uSnowDepth: { value: this.texture }, uTime: ctx.uniforms.uTime, uRain: ctx.uniforms.uRain },
      [
        { anchor: '#include <common>', code: `${defines}${DECK_GLSL}\n${SNOW['vertex-common']}` },
        { anchor: '#include <beginnormal_vertex>', code: SNOW['normal-vertex'] },
        { anchor: '#include <begin_vertex>', code: SNOW.position },
      ],
      [
        { anchor: '#include <common>', code: `${defines}${SNOW['fragment-common']}` },
        { anchor: '#include <clipping_planes_fragment>', code: SNOW.clip },
        { anchor: '#include <color_fragment>', code: SNOW.albedo },
        { anchor: '#include <roughnessmap_fragment>', code: SNOW.roughness },
        { anchor: '#include <emissivemap_fragment>', code: SNOW.sparkle },
      ],
    );
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.mesh.name = 'deck-snow';
    parent.add(this.mesh);
  }

  update(game: Game): void {
    const snow = game.snow;
    if (snow === this.source && snow.version === this.version) return;
    this.source = snow;
    this.version = snow.version;
    const data = this.data;
    // Distance from each cell centre to the nearest open cell's edge (negative inside one), swept from
    // both ends; interpolated between centres it is exact, so the shader can round the drift off there.
    let hole = -1e9;
    let first = CELLS;
    let last = -1;
    for (let i = 0; i < CELLS; i++) {
      const d = snow.depth[i] ?? 0;
      const open = snow.open[i] ?? 0;
      if (open) hole = i;
      if (d > 0.004) {
        first = Math.min(first, i);
        last = i;
      }
      data[i * 4] = d;
      data[i * 4 + 1] = open;
      data[i * 4 + 2] = (i - hole) * SNOW_CELL - SNOW_CELL / 2;
    }
    hole = 1e9;
    for (let i = CELLS - 1; i >= 0; i--) {
      if (snow.open[i]) hole = i;
      data[i * 4 + 2] = Math.min(data[i * 4 + 2], (hole - i) * SNOW_CELL - SNOW_CELL / 2, 2);
    }
    this.texture.needsUpdate = true;
    // Draw only the stretch of deck that has snow on it, and nothing at all while it is bare.
    this.mesh.visible = last >= first;
    if (last >= first) {
      const c0 = Math.max(0, (first - 1) * this.perCell);
      const c1 = Math.min(CELLS * this.perCell, (last + 2) * this.perCell);
      this.mesh.geometry.setDrawRange(c0 * this.perColumn, (c1 - c0) * this.perColumn);
    }
  }
}
