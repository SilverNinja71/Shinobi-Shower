import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import { BRIDGE_LENGTH } from '../scene/SuspensionBridge.ts';
import type { Assets } from './Assets.ts';

/**
 * What every rendering module receives. Shared uniforms are single objects held by reference, so a
 * material can put `ctx.uniforms.uWetness` straight into its own uniforms and see every update.
 */
export interface SharedUniforms {
  /** Seconds since the renderer started (keeps running while paused, for ambient motion). */
  uTime: { value: number };
  /** 0–1: how soaked every surface is. Rises fast in rain and mist, dries slowly. */
  uWetness: { value: number };
  /** 0–1: brightness of the current lightning flash (owned and written by MountainPeakScene). */
  uLightning: { value: number };
  /** Crosswind in m/s, positive toward +x. */
  uWind: { value: number };
  /** +1 when rain slants toward +x, −1 toward −x. */
  uRainDir: { value: number };
  /** Rain angle from vertical, radians (35°–60°). */
  uRainAngle: { value: number };
  /** Rain speed in m/s. */
  uRainSpeed: { value: number };
  /** 0–1 rain strength right now (cosmetic rain sheets follow it). */
  uRain: { value: number };
  /** 0–1 mist density (lens fog, haze). */
  uMist: { value: number };
  /** 0–1 snowfall strength right now. */
  uSnow: { value: number };
}

export type Quality = 'high' | 'low';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  assets: Assets;
  uniforms: SharedUniforms;
  quality: Quality;
}

/** One piece of the picture. GameRenderer calls `update` once per rendered frame, after the simulation. */
export interface RenderModule {
  update(dt: number, game: Game): void;
  handleEvent?(e: GameEvent, game: Game): void;
}

/** Lane x (0 at the west anchor) to world x (the bridge is centred on the origin). */
export const worldX = (laneX: number) => laneX - BRIDGE_LENGTH / 2;
export const laneX = (worldX: number) => worldX + BRIDGE_LENGTH / 2;

/**
 * Places an object on the deck at lane x, following the bridge's sag, sway, pitch and roll.
 * `lift` raises it above the deck surface along world up.
 */
export function placeOnDeck(obj: THREE.Object3D, game: Game, x: number, lift = 0, z = 0): void {
  const b = game.bridge;
  obj.position.set(worldX(x), b.deckY(x) + lift, b.lateral(x) + z);
  obj.rotation.set(b.rollAt(x), 0, b.pitch(x));
}
