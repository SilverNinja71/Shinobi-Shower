import * as THREE from 'three';
import { worldX } from '../../render/RenderContext.ts';
import type { Curtain } from '../DynamicStormSystem.ts';

/** How many curtains the rain shader can draw at once (the simulation rarely has more than two). */
export const CURTAIN_SLOTS = 4;

/** Height range the cosmetic sheets fill, for how long a band lingers after its curtain ends. */
const TOP_Y = 20;
const BOTTOM_Y = -25;

interface Slot {
  /** Simulation curtain id, or 0 when the slot is free. */
  id: number;
  centre: number;
  width: number;
  speed: number;
  age: number;
  life: number;
  seen: boolean;
}

/**
 * Hands the simulation's curtains to the rain shader in stable slots. A slot keeps its curtain for its
 * whole life, so the drops riding it never jump to another band, and outlives it until its last drops
 * have fallen through the box. The shader thins each height of the band by the swell at the moment
 * those drops left the clouds, so a sheet pours in from above and its tail falls away, as the
 * gameplay drops do.
 */
export class CurtainSlots {
  /** Per slot: x footprint centre (world x), y width, z sweep speed (m/s), w strength. */
  readonly bands = Array.from({ length: CURTAIN_SLOTS }, () => new THREE.Vector4());
  /** Per slot: x age, y life (s). */
  readonly times = Array.from({ length: CURTAIN_SLOTS }, () => new THREE.Vector4());
  private readonly slots: Slot[] = Array.from({ length: CURTAIN_SLOTS }, () => ({ id: 0, centre: 0, width: 0, speed: 0, age: 0, life: 0, seen: false }));

  /** True while any sheet is still in the air, even after its curtain has ended. */
  get live(): boolean {
    for (const s of this.slots) if (s.id !== 0) return true;
    return false;
  }

  /** `fall` is the rain's downward speed (m/s); `strength` scales every sheet. */
  update(dt: number, curtains: readonly Curtain[], fall: number, strength: number): void {
    for (const s of this.slots) s.seen = false;
    for (const c of curtains) {
      const slot = this.slotFor(c.id);
      slot.id = c.id;
      slot.centre = c.center;
      slot.width = c.width;
      slot.speed = c.speed;
      slot.age = c.age;
      slot.life = c.life;
      slot.seen = true;
    }
    const linger = (TOP_Y - BOTTOM_Y) / Math.max(fall, 1) + 0.5;
    for (let i = 0; i < CURTAIN_SLOTS; i++) {
      const s = this.slots[i];
      if (s.id !== 0 && !s.seen) {
        // The curtain has ended (or the game is paused): its last drops keep falling and its band sweeping.
        s.age += dt;
        s.centre += s.speed * dt;
        if (s.age > s.life + linger) s.id = 0;
      }
      this.bands[i].set(worldX(s.centre), s.width, s.speed, s.id !== 0 ? strength : 0);
      this.times[i].set(s.age, s.life, 0, 0);
    }
  }

  /** The slot already holding this curtain, else a free one, else the one whose curtain ended longest ago. */
  private slotFor(id: number): Slot {
    let free: Slot | null = null;
    let oldest = this.slots[0];
    for (const s of this.slots) {
      if (s.id === id) return s;
      if (s.id === 0 && !free) free = s;
      if (!s.seen && s.age - s.life > oldest.age - oldest.life) oldest = s;
    }
    return free ?? oldest;
  }
}
