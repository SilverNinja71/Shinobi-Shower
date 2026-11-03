/**
 * Where every part of the bridge sits, in deck coordinates: lane x along the bridge, height above the
 * deck surface, and z across it (positive toward the camera). Shared by the TypeScript builders and,
 * through `layoutDefines`, by the shaders, so ropes, planks and snow always agree.
 */
import { BRIDGE_LENGTH, DECK_HALF_WIDTH, PLANK_WIDTH } from '../SuspensionBridge.ts';

export { BRIDGE_LENGTH, DECK_HALF_WIDTH, PLANK_WIDTH };

/** Plank board thickness; the top face is the deck surface. */
export const PLANK_THICKNESS = 0.045;

/** Hand ropes: height above the deck where a suspender holds them, and distance from the centreline. */
export const HAND_HEIGHT = 1.05;
export const HAND_Z = 0.85;
export const HAND_RADIUS = 0.028;
/** Between suspenders the hand ropes dip by this much (the range is spread per span). */
export const HAND_SAG_MIN = 0.045;
export const HAND_SAG_MAX = 0.09;

/** Deck-edge ropes run just under the plank ends; the planks rest and are lashed on them. */
export const EDGE_Y = -PLANK_THICKNESS - 0.021;
export const EDGE_Z = 0.76;
export const EDGE_RADIUS = 0.024;

/** Suspenders hang the deck-edge rope from the hand rope every SUSPENDER_STEP metres of lane. */
export const SUSPENDER_STEP = 1.2;
export const SUSPENDER_RADIUS = 0.011;
/** The suspenders wrap the edge rope a little outside it. */
export const SUSPENDER_Z_BOTTOM = 0.79;

/** Anchor posts stand either side of the deck at both ends of the lane. */
export const POST_Z = 1.0;
export const POST_HALF = 0.12;
export const POST_TOP = 1.8;
export const POST_BOTTOM = -1.9;
/** Near the posts the ropes splay out to tie off on them. */
export const TIE_Z = 0.93;
/** Distance along the lane over which the ropes splay toward the posts. */
export const SPLAY = 1.0;

/** The lantern hangs from an arm on the front post, reaching this far over the lane. */
export const LANTERN_ARM_Y = 1.66;
export const LANTERN_ARM_REACH = 0.52;

/** GLSL #defines for the same numbers, so the shaders cannot drift from the builders. */
export function layoutDefines(): string {
  const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const values: Record<string, number> = {
    LANE_LENGTH: BRIDGE_LENGTH,
    LANE_HALF: BRIDGE_LENGTH / 2,
    HAND_HEIGHT,
    HAND_Z,
    HAND_SAG_MIN,
    HAND_SAG_MAX,
    EDGE_Y,
    EDGE_Z,
    SUSPENDER_STEP,
    SUSPENDER_Z_BOTTOM,
    TIE_Z,
    SPLAY,
    DECK_HALF_WIDTH,
  };
  return Object.entries(values)
    .map(([k, v]) => `#define ${k} ${f(v)}`)
    .join('\n');
}
