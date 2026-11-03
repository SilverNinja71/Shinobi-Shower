import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TrialGame } from '../src/core/TrialGame.ts';
import { mulberry32, v3 } from '../src/core/Vec.ts';
import type { Vec3 } from '../src/core/Vec.ts';
import { IDLE_INTENT } from '../src/parkour/NinjaController.ts';
import type { NinjaIntent } from '../src/parkour/NinjaController.ts';

const DT = 1 / 120;
const NO_SLICE = { pressed: false, held: false };

type Leg = {
  name: string;
  /** Returns the intent for this step, or null when the leg is finished. */
  run: (g: TrialGame) => Partial<NinjaIntent> | null;
};

const yawTo = (from: Vec3, x: number, z: number) => Math.atan2(-(x - from.x), -(z - from.z));

function runTo(name: string, x: number, z: number, done: (g: TrialGame) => boolean, extra: (g: TrialGame) => Partial<NinjaIntent> = () => ({})): Leg {
  return {
    name,
    run: (g) => (done(g) ? null : { yaw: yawTo(g.ninja.pos, x, z), moveZ: 1, ...extra(g) }),
  };
}

/** Hold still in the air (or wherever) until a condition holds. */
function hold(name: string, done: (g: TrialGame) => boolean): Leg {
  return { name, run: (g) => (done(g) ? null : { yaw: g.ninja.yaw, moveZ: 0 }) };
}

const soap = (g: TrialGame, i: number) => {
  const b = g.level.boxes.filter((box) => box.look === 'soap')[i];
  return v3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
};

const jumpEvery = { jumpPressed: true };

/** A route through every stage using the real controller: each technique the course asks for. */
const ROUTE: Leg[] = [
  runTo('start to first gap', -13, 24, (g) => g.ninja.pos.x > -13 && g.ninja.grounded, (g) => (g.ninja.pos.x > -16.7 && g.ninja.grounded ? jumpEvery : {})),
  runTo('approach the pipe', 0, 24, (g) => g.ninja.pos.x > -9),
  runTo('slide under the pipe', 0, 24, (g) => g.ninja.pos.x > -5.4, () => ({ slide: true })),
  runTo('line up for the wall', 2, 27.4, (g) => g.ninja.pos.x > 1.1 && g.ninja.state === 'move'),
  {
    name: 'jump at the wall',
    run: (g) => (g.ninja.state === 'wallrun' ? null : g.ninja.pos.y < 0.5 ? null : { yaw: yawTo(g.ninja.pos, g.ninja.pos.x + 5, 30), moveZ: 1, jumpPressed: g.ninja.grounded }),
  },
  { name: 'wall-run the gap', run: (g) => (g.ninja.pos.x > 16 ? null : { yaw: -Math.PI / 2, moveZ: 1 }) },
  hold('land on the far side', (g) => g.ninja.grounded),
  runTo('run to the rail', 22, 17, (g) => g.ninja.state === 'grind', (g) => (Math.hypot(g.ninja.pos.x - 22, g.ninja.pos.z - 17) < 2.5 && g.ninja.grounded ? jumpEvery : {})),
  hold('grind up to stage 2', (g) => g.ninja.state !== 'grind'),
  hold('land on the dish', (g) => g.ninja.grounded),
  runTo('jump to soap 1', 12, -10, (g) => g.ninja.grounded && g.ninja.pos.x < 15 && g.ninja.pos.y > 12.5, (g) => (g.ninja.pos.x < 20.8 && g.ninja.grounded ? jumpEvery : {})),
  {
    name: 'jump to soap 2',
    run: (g) => {
      const n = g.ninja;
      const t = soap(g, 1);
      if (n.grounded && n.pos.x < 6) return null;
      return { yaw: yawTo(n.pos, t.x, t.z), moveZ: 1, jumpPressed: n.grounded && n.pos.x < 11.5 };
    },
  },
  {
    name: 'jump to the ledge',
    run: (g) => {
      const n = g.ninja;
      if (n.grounded && n.pos.x < -4) return null;
      return { yaw: yawTo(n.pos, -6, -10), moveZ: 1, jumpPressed: n.grounded && n.pos.x < 2 };
    },
  },
  runTo('into the bouncer', -7.6, -10, (g) => g.ninja.vel.y > 10),
  runTo('onto the slab', -18, -8, (g) => g.ninja.grounded && g.ninja.pos.x < -15),
  runTo('line up with the wall', -29.3, -9, (g) => g.ninja.pos.x < -29),
  runTo('run along the wall line', -29.3, -2, (g) => g.ninja.pos.z > -3),
  {
    name: 'jump to the wet wall',
    run: (g) => (g.ninja.state === 'wallrun' ? null : { yaw: Math.PI, moveZ: 1, jumpPressed: g.ninja.grounded }),
  },
  {
    name: 'kick off before slipping',
    run: (g) => (g.ninja.state !== 'wallrun' ? null : { yaw: 0 + Math.PI, moveZ: 1, jumpPressed: g.ninja.pos.z > 2.5 }),
  },
  {
    name: 'fly to the curtain',
    run: (g) => (g.ninja.state === 'wallrun' ? null : { yaw: yawTo(g.ninja.pos, -21, g.ninja.pos.z + 3), moveZ: 1 }),
  },
  { name: 'run the curtain', run: (g) => (g.ninja.state !== 'wallrun' ? null : { yaw: Math.PI, moveZ: 1 }) },
  runTo('land past the curtain', -24, 25, (g) => g.ninja.grounded),
  {
    name: 'wire up to the apex',
    run: (g) => {
      const n = g.ninja;
      const a = g.level.anchors[1];
      if (n.pos.y > 37 && Math.abs(n.pos.x + 6) < 5) return null;
      const eye = n.eye;
      const yaw = yawTo(eye, a.x, a.z);
      const pitch = Math.atan2(a.y - eye.y, Math.hypot(a.x - eye.x, a.z - eye.z));
      return { yaw, pitch, moveZ: 1, wireHeld: true };
    },
  },
  hold('drop to the platform', (g) => g.ninja.grounded),
  runTo('jump the steam gap', 8, 24, (g) => g.ninja.grounded && g.ninja.pos.x > 4, (g) => (g.ninja.pos.x > -0.8 && g.ninja.grounded ? jumpEvery : {})),
  runTo('into the last bouncer', 12.5, 24, (g) => g.ninja.vel.y > 10),
  runTo('claim the spout', 25, 20, (g) => g.phase === 'finished'),
];

function playRoute(g: TrialGame, trace: string[]): void {
  for (const leg of ROUTE) {
    let t = 0;
    for (;;) {
      if (g.phase !== 'playing') break;
      const partial = leg.run(g);
      if (!partial) break;
      g.step(DT, { ...IDLE_INTENT, pitch: 0, ...partial }, NO_SLICE);
      g.events.length = 0;
      t += DT;
      if (t > 20) throw new Error(`stuck on "${leg.name}" at ${JSON.stringify(g.ninja.pos)} state ${g.ninja.state}\n${trace.join('\n')}`);
    }
    trace.push(`${leg.name}: ${t.toFixed(2)}s at (${g.ninja.pos.x.toFixed(1)}, ${g.ninja.pos.y.toFixed(1)}, ${g.ninja.pos.z.toFixed(1)}) stage ${g.stage} retries-falls dry ${g.dryness}`);
    if (g.phase !== 'playing') break;
  }
}

test('the full course can be finished using only the moves it teaches, hazards off', () => {
  const g = new TrialGame(mulberry32(1));
  g.start(false);
  g.hazardsOn = false;
  const trace: string[] = [];
  playRoute(g, trace);
  assert.equal(g.phase, 'finished', trace.join('\n'));
  assert.equal(g.stage, 3);
  assert.equal(g.dryness, 100, trace.join('\n'));
  console.log(`scripted clear in ${g.elapsed.toFixed(1)}s`);
});

test('with hazards on, the same undodging route takes hits but is not hopeless', () => {
  const results = [1, 2, 3, 4, 5, 6].map((seed) => {
    const g = new TrialGame(mulberry32(seed));
    g.start(false);
    try {
      playRoute(g, []);
    } catch {
      return `stuck after ${g.stains} stains`;
    }
    return `${g.phase}, ${g.stains} stains, stage ${g.stage + 1}`;
  });
  console.log(results.join(' | '));
  assert.equal(results.length, 6);
});
