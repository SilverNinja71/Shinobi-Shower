import { v3 } from './Vec.ts';
import type { Vec3 } from './Vec.ts';
import type { StreamSpec } from '../hazards/ShowerStreamEmitter.ts';

export type Surface = 'dry' | 'wet' | 'soapy' | 'chrome';
export type BoxLook = 'tile' | 'chrome' | 'soap' | 'curtain' | 'bottle';

export interface Motion {
  axis: 'x' | 'y' | 'z';
  amp: number;
  rate: number;
  phase: number;
}

export interface Box {
  id: number;
  min: Vec3;
  max: Vec3;
  surface: Surface;
  look: BoxLook;
  /** Height ranges of a tile wall that are always wet. */
  wetBands: [number, number][];
  runnable: boolean;
  motion: Motion | null;
  /** Rest position of `min` on the moving axis. */
  rest: number;
  /** How far the box moved in the last update. */
  dx: number;
  dy: number;
  dz: number;
}

export interface Rail {
  points: Vec3[];
}

export interface BouncerSpec {
  pos: Vec3;
  r: number;
  power: number;
}

export interface Zone {
  min: Vec3;
  max: Vec3;
}

export interface Stage {
  name: string;
  spawn: Vec3;
  yaw: number;
  /** Entering this zone reaches the stage's checkpoint. */
  zone: Zone;
  /** Seconds between falling droplets. */
  dropletEvery: number;
}

export const WATER_LEVEL = 0;
const ROOM = 30;
const CEILING = 80;

type BoxOpts = Partial<Pick<Box, 'surface' | 'look' | 'wetBands' | 'runnable' | 'motion'>>;

function inZone(p: Vec3, z: Zone): boolean {
  return p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;
}

/** The whole course, as data. See test/course.test.ts for a scripted run that proves it can be finished. */
export class Level {
  readonly boxes: Box[] = [];
  readonly rails: Rail[] = [];
  readonly anchors: Vec3[] = [];
  readonly bouncers: BouncerSpec[] = [];
  readonly streams: StreamSpec[] = [];
  readonly steamZones: Zone[] = [];
  readonly stages: Stage[] = [];
  readonly goal = v3(25, 47.2, 20);
  readonly goalRadius = 2.6;

  constructor() {
    this.buildRoom();
    this.buildBasin();
    this.buildSoapDish();
    this.buildCrevasse();
    this.buildApex();
  }

  private add(min: [number, number, number], max: [number, number, number], opts: BoxOpts = {}): Box {
    const box: Box = {
      id: this.boxes.length,
      min: v3(...min),
      max: v3(...max),
      surface: opts.surface ?? 'dry',
      look: opts.look ?? 'tile',
      wetBands: opts.wetBands ?? [],
      runnable: opts.runnable ?? true,
      motion: opts.motion ?? null,
      rest: 0,
      dx: 0,
      dy: 0,
      dz: 0,
    };
    if (box.motion) box.rest = box.min[box.motion.axis];
    this.boxes.push(box);
    return box;
  }

  private buildRoom(): void {
    const t = ROOM + 2;
    this.add([-t, -3, -t], [t, -1, t], { runnable: false });
    // The left wall has a band of running water, so runs along it slip.
    this.add([-t, -3, -t], [-ROOM, CEILING, t], { wetBands: [[20, 34]] });
    this.add([ROOM, -3, -t], [t, CEILING, t]);
    this.add([-t, -3, -t], [t, CEILING, -ROOM]);
    this.add([-t, -3, ROOM], [t, CEILING, t]);
  }

  /** Stage 1: run, slide under the pipe, wall-run the gap, ride the rail upward. */
  private buildBasin(): void {
    this.stages.push({
      name: 'The Basin Drain',
      spawn: v3(-24, 2, 24),
      yaw: -Math.PI / 2,
      zone: { min: v3(-28, 1, 20), max: v3(-16, 8, 28) },
      dropletEvery: 1.5,
    });
    this.add([-28, 0, 20], [-16, 2, 28]);
    this.add([-14, 0, 20], [2, 2, 28]);
    this.add([-7, 3, 20], [-6, 4.2, 28], { surface: 'chrome', look: 'chrome', runnable: false });
    this.add([14, 0, 14], [28, 2, 29]);
    this.rails.push({ points: [v3(22, 3.2, 17), v3(24, 14.3, -6)] });
    this.streams.push({
      origin: v3(-2, 3.28, 30), target: v3(-2, 3.28, 19), sweepRadius: 0, sweepRate: 0, phase: 0,
      periodBeats: 4, onBeats: 2, beatOffset: 0, radius: 0.2,
    });
  }

  /** Stage 2: slick moving soap, a geyser, then a foam bouncer. */
  private buildSoapDish(): void {
    this.stages.push({
      name: 'The Soap Dish Ledges',
      spawn: v3(24, 13, -9),
      yaw: Math.PI / 2,
      zone: { min: v3(20, 12, -20), max: v3(28, 18, -5) },
      dropletEvery: 1.05,
    });
    this.add([20, 11, -20], [28, 13, -5]);
    const soap = { surface: 'soapy', look: 'soap', runnable: false } as const;
    this.add([9.5, 12, -12], [14.5, 13, -8], { ...soap, motion: { axis: 'z', amp: 2.5, rate: 0.9, phase: 0 } });
    this.add([0.5, 12.5, -12], [5.5, 13.5, -8], { ...soap, motion: { axis: 'z', amp: 2.5, rate: 0.9, phase: Math.PI } });
    this.add([-14, 13, -14], [-4, 15, -6]);
    this.add([-5.2, 15, -13.8], [-4.2, 21, -12.8], { look: 'bottle', runnable: false });
    this.anchors.push(v3(-4.7, 22.2, -13.3));
    this.bouncers.push({ pos: v3(-7.6, 16.6, -10), r: 1.2, power: 20 });
    this.streams.push({
      origin: v3(-5.4, 15, -7.4), target: v3(-5.4, 24, -7.4), sweepRadius: 0, sweepRate: 0, phase: 0,
      periodBeats: 6, onBeats: 2, beatOffset: 2, radius: 0.6,
    });
  }

  /** Stage 3: wall-run the wet tile, kick across to the swaying curtain, then swing up on the wire. */
  private buildCrevasse(): void {
    this.stages.push({
      name: 'The Curtain Crevasse',
      spawn: v3(-20, 24, -9),
      yaw: 0.6,
      zone: { min: v3(-29, 23, -14), max: v3(-14, 30, -2) },
      dropletEvery: 1.0,
    });
    this.add([-30, 22.5, -14], [-14, 24, -2]);
    this.add([-22.5, 14, 3], [-21.5, 42, 19], {
      look: 'curtain',
      motion: { axis: 'x', amp: 0.45, rate: 0.7, phase: 0 },
    });
    this.add([-30, 18.5, 21], [-16, 20, 29]);
    this.anchors.push(v3(-6, 50, 23));
    this.streams.push({
      origin: v3(-26, 60, 9), target: v3(-26, 20, 9), sweepRadius: 3, sweepRate: 1.1, phase: 0,
      periodBeats: 8, onBeats: 3, beatOffset: 0, radius: 0.45,
    });
  }

  /** Stage 4: blind steam, pulses timed by the drips, sweeping jets, and one last bounce. */
  private buildApex(): void {
    this.stages.push({
      name: 'The Apex Spout',
      spawn: v3(-6, 36, 24),
      yaw: -Math.PI / 2,
      zone: { min: v3(-12, 35, 20), max: v3(0, 42, 28) },
      dropletEvery: 0.8,
    });
    this.add([-12, 34.5, 20], [0, 36, 28]);
    this.add([4, 35, 20], [16, 36.6, 28]);
    this.bouncers.push({ pos: v3(12.5, 37.9, 24), r: 1.2, power: 20 });
    this.add([20, 44.5, 14], [30, 46, 29]);
    this.steamZones.push({ min: v3(-14, 32, 16), max: v3(20, 48, 30) });
    this.streams.push(
      {
        origin: v3(2, 70, 24), target: v3(2, 30, 24), sweepRadius: 0, sweepRate: 0, phase: 0,
        periodBeats: 4, onBeats: 2, beatOffset: 1, radius: 0.9,
      },
      {
        origin: v3(0, 72, 10), target: v3(6, 36, 24), sweepRadius: 9, sweepRate: 0.8, phase: 0,
        periodBeats: 1, onBeats: 1, beatOffset: 0, radius: 0.32,
      },
      {
        origin: v3(0, 72, 10), target: v3(6, 36, 24), sweepRadius: 9, sweepRate: 0.8, phase: Math.PI,
        periodBeats: 1, onBeats: 1, beatOffset: 0, radius: 0.32,
      },
    );
  }

  update(time: number): void {
    for (const box of this.boxes) {
      const m = box.motion;
      if (!m) continue;
      const size = box.max[m.axis] - box.min[m.axis];
      const next = box.rest + Math.sin(time * m.rate + m.phase) * m.amp;
      const delta = next - box.min[m.axis];
      box.dx = m.axis === 'x' ? delta : 0;
      box.dy = m.axis === 'y' ? delta : 0;
      box.dz = m.axis === 'z' ? delta : 0;
      box.min[m.axis] = next;
      box.max[m.axis] = next + size;
    }
  }

  stageAt(p: Vec3): number {
    for (let i = this.stages.length - 1; i >= 0; i--) if (inZone(p, this.stages[i].zone)) return i;
    return -1;
  }

  steamAt(p: Vec3): boolean {
    return this.steamZones.some((z) => inZone(p, z));
  }
}
