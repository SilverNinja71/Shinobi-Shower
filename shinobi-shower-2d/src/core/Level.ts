import { v3 } from './Vec.ts';
import type { Vec3 } from './Vec.ts';
import type { StreamSpec } from '../hazards/ShowerStreamEmitter.ts';

export type Surface = 'dry' | 'wet' | 'soapy' | 'chrome';
export type BoxLook = 'room' | 'tile' | 'chrome' | 'soap' | 'curtain' | 'bottle';

export interface Motion {
  axis: 'x' | 'y';
  amp: number;
  rate: number;
  phase: number;
}

/** A rectangle of the side-on world. Depth is kept so ray and overlap code stays general; z is always 0. */
export interface Box {
  id: number;
  min: Vec3;
  max: Vec3;
  surface: Surface;
  look: BoxLook;
  wetBands: [number, number][];
  runnable: boolean;
  motion: Motion | null;
  rest: number;
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
  /** Which way the ninja faces on arrival: 1 right, -1 left. */
  facing: number;
  zone: Zone;
  dropletEvery: number;
}

export const WATER_LEVEL = 0;
export const ROOM = 20;
export const CEILING = 104;

type BoxOpts = Partial<Pick<Box, 'surface' | 'look' | 'wetBands' | 'runnable' | 'motion'>>;

const zone = (x0: number, y0: number, x1: number, y1: number): Zone => ({ min: v3(x0, y0, -5), max: v3(x1, y1, 5) });

function stream(partial: Partial<StreamSpec> & Pick<StreamSpec, 'origin' | 'target' | 'radius'>): StreamSpec {
  return { sweepRadius: 0, sweepRate: 0, phase: 0, periodBeats: 1, onBeats: 1, beatOffset: 0, ...partial };
}

function inZone(p: Vec3, z: Zone): boolean {
  return p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y;
}

/** The whole climb, as data. test/course.test.ts drives the real controller up it to prove it can be finished. */
export class Level {
  readonly boxes: Box[] = [];
  readonly rails: Rail[] = [];
  readonly anchors: Vec3[] = [];
  readonly bouncers: BouncerSpec[] = [];
  readonly streams: StreamSpec[] = [];
  readonly steamZones: Zone[] = [];
  readonly stages: Stage[] = [];
  readonly goal = v3(-15, 79.2, 0);
  readonly goalRadius = 2.4;

  constructor() {
    const t = ROOM + 3;
    this.add(-t, -3, t, -1, { look: 'room', runnable: false });
    this.add(-t, -3, -ROOM, CEILING, { look: 'room', wetBands: [[38, 58]] });
    this.add(ROOM, -3, t, CEILING, { look: 'room' });
    this.buildBasin();
    this.buildSoapDish();
    this.buildCrevasse();
    this.buildApex();
  }

  private add(x0: number, y0: number, x1: number, y1: number, opts: BoxOpts = {}): Box {
    const box: Box = {
      id: this.boxes.length,
      min: v3(x0, y0, -1),
      max: v3(x1, y1, 1),
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

  /** Stage 1: run, slide under the pipe and the low jet, run up the wall, ride the rail. */
  private buildBasin(): void {
    this.stages.push({ name: 'The Basin Drain', spawn: v3(-15, 2, 0), facing: 1, zone: zone(-20, 1, -9, 12), dropletEvery: 1.6 });
    this.add(-20, 0, -9, 2);
    this.add(-6.5, 0, 9, 2);
    this.add(-1, 3, 0, 9, { surface: 'chrome', look: 'chrome', runnable: false });
    this.add(12, 0, 15, 18);
    this.add(15, 15.5, 20, 18);
    this.streams.push(stream({ origin: v3(9, 3.25, 0), target: v3(1.5, 3.25, 0), radius: 0.2, periodBeats: 4, onBeats: 2 }));
    this.rails.push({ points: [v3(13, 19.4, 0), v3(-7, 26.2, 0)] });
  }

  /** Stage 2: slick moving soap, a timed geyser and a foam bouncer. */
  private buildSoapDish(): void {
    this.stages.push({ name: 'The Soap Dish Ledges', spawn: v3(-14, 25, 0), facing: 1, zone: zone(-20, 24, -7, 34), dropletEvery: 1.1 });
    this.add(-20, 23, -7, 25);
    const soap = { surface: 'soapy', look: 'soap', runnable: false } as const;
    // The soap is on the far side of the room, so the route doubles back across the shaft.
    this.add(-3.5, 26.8, 0.5, 27.8, { ...soap, motion: { axis: 'x', amp: 1.2, rate: 0.9, phase: 0 } });
    this.add(4, 27.8, 8, 28.8, { ...soap, motion: { axis: 'y', amp: 0.7, rate: 1.1, phase: 1 } });
    this.add(11, 28, 20, 30);
    this.add(18.2, 30, 19.2, 35.5, { look: 'bottle', runnable: false });
    this.anchors.push(v3(18.7, 36.7, 0));
    this.bouncers.push({ pos: v3(13.5, 31.5, 0), r: 1.2, power: 24 });
    this.streams.push(stream({ origin: v3(11.8, 30, 0), target: v3(11.8, 38, 0), radius: 0.55, periodBeats: 6, onBeats: 2, beatOffset: 2 }));
  }

  /** Stage 3: kick between the wet wall and the curtain, then swing up on the wire. */
  private buildCrevasse(): void {
    this.stages.push({ name: 'The Curtain Crevasse', spawn: v3(0, 40, 0), facing: -1, zone: zone(-20, 39, 9, 42), dropletEvery: 1.0 });
    this.add(-20, 37, 9, 39);
    this.add(-13, 41.5, -12, 57, { look: 'curtain', surface: 'wet', motion: { axis: 'x', amp: 0.3, rate: 0.7, phase: 0 } });
    this.add(-10.5, 53, 1, 55);
    this.anchors.push(v3(9, 76, 0));
    this.streams.push(stream({ origin: v3(-16.5, 66, 0), target: v3(-16.5, 40, 0), sweepRadius: 2.2, sweepRate: 1.1, radius: 0.34, periodBeats: 8, onBeats: 3 }));
  }

  /** Stage 4: blind steam, pulses timed by the drips, sweeping jets and one last bounce. */
  private buildApex(): void {
    this.stages.push({ name: 'The Apex Spout', spawn: v3(9, 67, 0), facing: -1, zone: zone(4, 66, 15, 73), dropletEvery: 0.85 });
    this.add(4, 64, 15, 66);
    this.add(-8, 64.6, 0, 66.6);
    this.bouncers.push({ pos: v3(-3.5, 68, 0), r: 1.2, power: 24 });
    this.add(-20, 75, -9, 77);
    this.steamZones.push(zone(-10, 60, 18, 76));
    this.streams.push(
      stream({ origin: v3(2, 100, 0), target: v3(2, 60, 0), radius: 0.7, periodBeats: 4, onBeats: 2, beatOffset: 1 }),
      stream({ origin: v3(4, 102, 0), target: v3(2, 66, 0), sweepRadius: 13, sweepRate: 0.75, radius: 0.28 }),
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
