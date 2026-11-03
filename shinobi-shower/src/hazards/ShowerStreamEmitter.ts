import type { Level } from '../core/Level.ts';
import { raycast } from '../parkour/WallRunDetector.ts';
import { dist, norm, sub, v3 } from '../core/Vec.ts';
import type { Vec3 } from '../core/Vec.ts';

/** Seconds per beat. Pulses are multiples of this, so dripping sounds let you time them blind. */
export const BEAT = 0.8;

export interface StreamSpec {
  origin: Vec3;
  /** A fixed aim point, or the centre of a circle the jet sweeps around. */
  target: Vec3;
  /** Circle radius and angular speed. 0 for a fixed stream. */
  sweepRadius: number;
  sweepRate: number;
  phase: number;
  /** Beats per cycle, and how many of them it is on. Equal values mean it never stops. */
  periodBeats: number;
  onBeats: number;
  beatOffset: number;
  radius: number;
}

export class Stream {
  readonly spec: StreamSpec;
  on = true;
  dir: Vec3 = v3(0, -1, 0);
  /** Beam length after hitting geometry. */
  length = 0;
  end: Vec3 = v3();
  endNormal: Vec3 = v3(0, 1, 0);
  /** Distance along the beam where a parry is holding the water back. */
  blockedAt = Infinity;

  constructor(spec: StreamSpec) {
    this.spec = spec;
  }

  update(time: number, level: Level): void {
    const s = this.spec;
    const beat = time / BEAT + s.beatOffset;
    this.on = ((beat % s.periodBeats) + s.periodBeats) % s.periodBeats < s.onBeats;
    const a = s.phase + time * s.sweepRate;
    const aim = v3(s.target.x + Math.cos(a) * s.sweepRadius, s.target.y, s.target.z + Math.sin(a) * s.sweepRadius);
    this.dir = norm(sub(aim, s.origin));
    // A fixed stream stops at its target. A sweeping jet runs until it hits something.
    const reach = s.sweepRadius > 0 ? 120 : dist(s.origin, s.target);
    const hit = raycast(level, s.origin, this.dir, reach);
    this.length = hit ? hit.t : reach;
    this.blockedAt = Infinity;
    if (hit) this.endNormal = hit.normal;
    this.end = v3(
      s.origin.x + this.dir.x * this.length,
      s.origin.y + this.dir.y * this.length,
      s.origin.z + this.dir.z * this.length,
    );
  }

  /**
   * Finds whether the beam overlaps a box, by walking spheres along the part of it nearest the box.
   * Returns the point of contact, or null.
   */
  touches(min: Vec3, max: Vec3): Vec3 | null {
    if (!this.on) return null;
    const s = this.spec;
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    const along = (cx - s.origin.x) * this.dir.x + (cy - s.origin.y) * this.dir.y + (cz - s.origin.z) * this.dir.z;
    const r2 = s.radius * s.radius;
    for (let k = -8; k <= 8; k++) {
      const t = along + k * 0.2;
      if (t < 0 || t > Math.min(this.length, this.blockedAt)) continue;
      const px = s.origin.x + this.dir.x * t;
      const py = s.origin.y + this.dir.y * t;
      const pz = s.origin.z + this.dir.z * t;
      const dx = Math.max(min.x - px, 0, px - max.x);
      const dy = Math.max(min.y - py, 0, py - max.y);
      const dz = Math.max(min.z - pz, 0, pz - max.z);
      if (dx * dx + dy * dy + dz * dz < r2) return v3(px, py, pz);
    }
    return null;
  }
}
