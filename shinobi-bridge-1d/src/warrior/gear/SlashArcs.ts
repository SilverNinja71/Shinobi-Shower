import * as THREE from 'three';
import type { Game } from '../../core/Game.ts';
import { worldX } from '../../render/RenderContext.ts';
import fragmentShader from '../../shaders/SlashArc.frag';
import vertexShader from '../../shaders/SlashArc.vert';
import { ACTIVE, STARTUP, WAKE } from '../KatanaSlash.ts';

export type SlashStyle = 'steel' | 'spirit' | 'flame' | 'crimson';

/** Swings alternate: odd ones cut down from overhead, even ones rise from the feet. */
export const slashDescends = (swing: number): boolean => swing % 2 === 1;

/** Height of the sweep's centre above the feet: about the shoulders, where the swing turns. */
const PIVOT = 1.5;
/** How far in front of the body (toward the camera) the light is drawn. */
const DEPTH = 0.32;

/**
 * The slash crescents: one additive ribbon per cutting arc, whose outer edge traces the
 * simulation's real cutting box (reach, ARC_LOW to ARC_HIGH above the feet, just behind the
 * warrior). The leading edge runs with the active frames and the ribbon dissolves through the wake.
 * Both arcs (three blades cut both ways) share one mesh and one draw call.
 */
export class SlashArcs {
  readonly mesh: THREE.Mesh;
  private readonly materials: Record<SlashStyle, THREE.ShaderMaterial>;
  private readonly u = {
    uTime: { value: 0 },
    uOrigin: { value: new THREE.Vector3() },
    uFacing: { value: 1 },
    uReach: { value: 2.4 },
    uLow: { value: 0.2 },
    uHigh: { value: 3.4 },
    uPivot: { value: PIVOT },
    uDescend: { value: 1 },
    uArcs: { value: 1 },
    uDepth: { value: DEPTH },
    uSweep: { value: 0 },
    uWake: { value: 0 },
    uStrength: { value: 0 },
  };
  private swing = -1;

  constructor(low: boolean) {
    const along = low ? 40 : 80;
    const across = low ? 3 : 6;
    const arc: number[] = [];
    const index: number[] = [];
    for (let which = 0; which < 2; which++) {
      const base = arc.length / 3;
      for (let i = 0; i <= along; i++) for (let j = 0; j <= across; j++) arc.push(i / along, j / across, which);
      for (let i = 0; i < along; i++) {
        for (let j = 0; j < across; j++) {
          const a = base + i * (across + 1) + j;
          const b = a + across + 1;
          index.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(arc.length), 3));
    g.setAttribute('aArc', new THREE.Float32BufferAttribute(arc, 3));
    g.setIndex(index);
    const make = (style: SlashStyle) =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...this.u },
        defines: { [style.toUpperCase()]: '' },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: true,
      });
    this.materials = { steel: make('steel'), spirit: make('spirit'), flame: make('flame'), crimson: make('crimson') };
    this.mesh = new THREE.Mesh(g, this.materials.steel);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /** The arc look for a stance: crimson lightning at tier 5, else fire, spirit mist, or steel. */
  static styleFor(game: Game): SlashStyle {
    const s = game.stance;
    if (s.tier >= 5) return 'crimson';
    if (s.flame) return 'flame';
    if (s.aura) return 'spirit';
    return 'steel';
  }

  /**
   * World point on the crescent where the blade is now (before the sweep, where it will start;
   * after, where it ended), at `radius` of the band's outer edge. False when no swing is in flight.
   */
  leadingEdge(game: Game, out: THREE.Vector3, radius = 0.8): boolean {
    const k = game.katana;
    if (k.t < 0 || k.swing !== this.swing) return false;
    const u = this.u;
    const x = Math.min(1, k.sweep * 1.06);
    const s = u.uDescend.value > 0.5 ? x : 1 - x;
    const a = 1.66 + (-1.66 - 1.66) * s;
    const up = a >= 0 ? u.uHigh.value - u.uPivot.value : u.uPivot.value - u.uLow.value;
    out.copy(u.uOrigin.value);
    out.x += u.uFacing.value * u.uReach.value * Math.cos(a) * radius;
    out.y += u.uPivot.value + up * Math.sin(a) * radius;
    return true;
  }

  /** Every material, for warming shaders up before they are first needed. */
  all(): THREE.Material[] {
    return Object.values(this.materials);
  }

  update(dt: number, game: Game): void {
    const k = game.katana;
    const u = this.u;
    u.uTime.value += dt;
    if (k.t < 0 || game.phase === 'over') {
      this.mesh.visible = false;
      return;
    }
    if (k.swing !== this.swing) {
      // A new swing: read its cutting boxes once (relative to the warrior), and pick its look.
      this.swing = k.swing;
      const w = game.warrior;
      const feet = game.feetY;
      const arcs = k.arcs(w.x, feet, game.stance);
      const a = arcs[0];
      u.uFacing.value = a.side;
      u.uReach.value = a.side > 0 ? a.x1 - w.x : w.x - a.x0;
      u.uLow.value = a.y0 - feet;
      u.uHigh.value = a.y1 - feet;
      u.uArcs.value = arcs.length;
      u.uDescend.value = slashDescends(k.swing) ? 1 : 0;
      this.mesh.material = this.materials[SlashArcs.styleFor(game)];
    }
    const x = game.warrior.x;
    u.uOrigin.value.set(worldX(x), game.feetY, game.bridge.lateral(x));
    u.uSweep.value = k.sweep;
    u.uWake.value = Math.min(1, Math.max(0, (k.t - STARTUP - ACTIVE) / WAKE));
    u.uStrength.value = Math.min(1, k.t / STARTUP);
    this.mesh.visible = k.t >= STARTUP * 0.5;
  }
}
