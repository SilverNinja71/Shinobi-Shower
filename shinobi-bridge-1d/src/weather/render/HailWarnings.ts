import type { Game } from '../../core/Game.ts';
import { worldX } from '../../render/RenderContext.ts';
import { BRIDGE_LENGTH, DECK_HALF_WIDTH } from '../../scene/SuspensionBridge.ts';
import { SWEET_HALF_WIDTH, SWEET_HIGH, SWEET_LOW } from '../../warrior/KatanaSlash.ts';
import { PROFILES } from '../PrecipitationDroplet.ts';
import type { Drop } from '../PrecipitationDroplet.ts';
import { MARK, snowSurface } from './StormMarks.ts';
import type { StormMarks } from './StormMarks.ts';

const HAIL = PROFILES.hail;
/** Hail's sideways speed decays at this rate (1/s), as moveDrops has it. */
const HAIL_DRAG = 1.1;
/** A fresh stone falls for about this long (s); the warning ring closes over it. */
const WARN_TIME = 1.8;
/** The mark's footprint ring is this share of its half-size (StormMarks.frag). */
const FOOT_SHARE = 0.42;
/** The sweet-spot box shows while a stone is within this far above the warrior's feet and to the side. */
const NEAR_ABOVE = 6;
const NEAR_SIDE = 5;

/** Seconds for a stone falling at `down` m/s to drop `h` metres, accelerating to its terminal speed. */
function fallTime(h: number, down: number): number {
  if (h <= 0) return 0;
  const g = HAIL.gravity;
  const vt = -HAIL.terminal;
  const v0 = Math.min(Math.max(down, 0), vt);
  const t1 = (vt - v0) / g;
  const d1 = v0 * t1 + 0.5 * g * t1 * t1;
  if (h <= d1) return (-v0 + Math.sqrt(v0 * v0 + 2 * g * h)) / g;
  return t1 + (h - d1) / vt;
}

const clampLane = (x: number) => Math.min(BRIDGE_LENGTH, Math.max(0, x));

/**
 * Hail is the one hazard that must be read before it arrives. Under every stone a mark lies on the
 * deck where it will land: its shadow deepening, a red-orange ring closing onto its footprint and
 * pulsing faster as it nears, and the same ring standing up as a short wall of light so it reads from
 * the low side-on camera. When a stone comes within reach overhead, the box where a cut breaks hail
 * glows faintly, brightening when the stone is lined up in it.
 */
export class HailWarnings {
  private sweet = 0;

  update(dt: number, game: Game, hail: readonly Drop[], marks: StormMarks): void {
    const b = game.bridge;
    const w = game.warrior;
    const feet = game.feetY;
    let near = false;
    for (const d of hail) {
      // Where will it land? Guess, then refine with the deck height there.
      let x = d.x;
      let t = 0;
      for (let pass = 0; pass < 2; pass++) {
        const lx = clampLane(x);
        t = fallTime(d.y - d.r - (b.deckY(lx) + snowSurface(game, lx, d.z)), -d.vy);
        x = d.x + (d.vx * (1 - Math.exp(-HAIL_DRAG * t))) / HAIL_DRAG;
      }
      const dy = d.y - feet;
      if (dy > -0.5 && dy < NEAR_ABOVE && Math.abs(d.x - w.x) < NEAR_SIDE) near = true;
      // Past the anchors it falls into the gorge; already below the deck it has passed.
      if (x < 0 || x > BRIDGE_LENGTH) continue;
      const half = d.r / FOOT_SHARE;
      // The mark is flat: lay it on the highest snow under it so no drift buries part of the ring.
      let lift = 0;
      for (let s = -2; s <= 2; s++) lift = Math.max(lift, snowSurface(game, clampLane(x + (s * half) / 2), d.z));
      if (d.y + d.r < b.deckY(x) + snowSurface(game, x, d.z) - 0.2) continue;
      const k = 1 - Math.min(1, t / WARN_TIME);
      // Over a missing plank it will fall straight through: a weaker warning.
      const power = b.isOpen(x) ? 0.45 : 1;
      marks.onDeck(game, MARK.HAIL, x, d.z, lift + 0.035, half, Math.min(half, DECK_HALF_WIDTH), k, power);
      const ring = half * (0.96 + (FOOT_SHARE - 0.96) * k);
      marks.upright(MARK.WALL, worldX(x), b.deckY(x) + lift - 0.04, b.lateral(x) + d.z, ring, 0.25 + 0.55 * k, true, k, power);
    }

    this.sweet += ((near ? 1 : 0) - this.sweet) * Math.min(1, dt * (near ? 9 : 3));
    if (this.sweet < 0.01) return;
    const halfH = (SWEET_HIGH - SWEET_LOW) / 2;
    for (const arc of game.katana.arcs(w.x, feet, game.stance, w.facing)) {
      // Lined up: a stone over the box, inside the cutting band (1) or still falling into it (0.45).
      let aligned = 0;
      for (const d of hail) {
        if (Math.abs(d.x - arc.sweet) > SWEET_HALF_WIDTH) continue;
        const rel = d.y - feet;
        if (rel >= SWEET_LOW && rel <= SWEET_HIGH) aligned = 1;
        else if (rel > SWEET_HIGH && rel < NEAR_ABOVE) aligned = Math.max(aligned, 0.45);
      }
      marks.upright(MARK.SWEET, worldX(arc.sweet), feet + SWEET_LOW + halfH, b.lateral(w.x), SWEET_HALF_WIDTH, halfH, false, aligned, this.sweet, halfH / SWEET_HALF_WIDTH);
    }
  }
}
