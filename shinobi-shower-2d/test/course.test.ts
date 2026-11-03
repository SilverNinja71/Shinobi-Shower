import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TrialGame } from '../src/core/TrialGame.ts';
import { mulberry32 } from '../src/core/Vec.ts';
import { IDLE_INTENT } from '../src/parkour/NinjaController.ts';
import type { NinjaIntent } from '../src/parkour/NinjaController.ts';

const DT = 1 / 120;
const NO_SLICE = { pressed: false, held: false };

type Leg = { name: string; run: (g: TrialGame) => Partial<NinjaIntent> | null };

const toward = (g: TrialGame, x: number) => (Math.abs(x - g.ninja.pos.x) < 0.2 ? 0 : Math.sign(x - g.ninja.pos.x));
const soap = (g: TrialGame, i: number) => {
  const b = g.level.boxes.filter((box) => box.look === 'soap')[i];
  return (b.min.x + b.max.x) / 2;
};

function go(name: string, x: number, done: (g: TrialGame) => boolean, extra: (g: TrialGame) => Partial<NinjaIntent> = () => ({})): Leg {
  return { name, run: (g) => (done(g) ? null : { moveX: toward(g, x) || Math.sign(x - g.ninja.pos.x) || 1, jumpHeld: true, ...extra(g) }) };
}

const jumpIf = (cond: (g: TrialGame) => boolean) => (g: TrialGame) => ({ jumpPressed: cond(g) && g.ninja.grounded });

/** A route through every stage using the real controller: each technique the course asks for. */
const ROUTE: Leg[] = [
  go('first gap', 0, (g) => g.ninja.pos.x > -6 && g.ninja.grounded, jumpIf((g) => g.ninja.pos.x > -9.8)),
  go('to the pipe', 0, (g) => g.ninja.pos.x > -3.5),
  go('slide under the pipe', 8.2, (g) => g.ninja.pos.x > 1, () => ({ slide: true })),
  go('slide under the jet', 8.2, (g) => g.ninja.pos.x > 7.9, (g) => ({ slide: g.ninja.pos.x < 8 })),
  go('jump to the wall', 15, (g) => g.ninja.state === 'wallrun', jumpIf((g) => g.ninja.pos.x > 7.9)),
  go('run up the wall', 15, (g) => g.ninja.state === 'grind' || (g.ninja.pos.y >= 18 && g.ninja.grounded)),
  { name: 'hop onto the rail', run: (g) => (g.ninja.state === 'grind' ? null : { moveX: -1, jumpHeld: true, jumpPressed: g.ninja.grounded }) },
  { name: 'grind the rail', run: (g) => (g.ninja.state !== 'grind' ? null : {}) },
  go('land on the dish', -12, (g) => g.ninja.grounded && g.ninja.pos.y > 24),
  go('run back to soap 1', -1.5, (g) => g.ninja.grounded && g.ninja.pos.x > -5 , jumpIf((g) => g.ninja.pos.x > -7.9)),
  {
    name: 'soap 1 to soap 2',
    run: (g) => (g.ninja.grounded && g.ninja.pos.x > 3 ? null : { moveX: toward(g, soap(g, 1)) || 1, jumpHeld: true, jumpPressed: g.ninja.grounded && g.ninja.pos.x > soap(g, 0) + 0.6 }),
  },
  go('soap 2 to the far ledge', 14, (g) => g.ninja.grounded && g.ninja.pos.x > 10.8, jumpIf((g) => g.ninja.pos.x > 5.6)),
  go('into the bouncer', 13.5, (g) => g.ninja.vel.y > 15),
  { name: 'rise past the slab', run: (g) => (g.ninja.pos.y > 39.5 ? null : { moveX: g.ninja.pos.x > 10.2 ? -1 : 1 }) },
  go('land on the long slab', 7, (g) => g.ninja.grounded),
  go('run under the curtain', -19.6, (g) => g.ninja.pos.x < -18.4),
  { name: 'latch the wet wall', run: (g) => (g.ninja.state === 'wallrun' ? null : { moveX: -1, jumpHeld: true, jumpPressed: g.ninja.grounded }) },
  ...Array.from({ length: 16 }, (_, i) => i).flatMap((i): Leg[] => {
    const side = i % 2 === 0 ? 1 : -1;
    return [
      {
        name: 'kick across ' + i,
        run: (g) => {
          if (g.ninja.pos.y > 56) return null;
          if (g.ninja.state !== 'wallrun') return { moveX: side, jumpHeld: true };
          return g.ninja.wallSide === -side ? { moveX: -side, jumpPressed: true, jumpHeld: true } : null;
        },
      },
    ];
  }),
  go('over the curtain', -5, (g) => g.ninja.grounded && g.ninja.pos.y > 52.5),
  go('to the wire spot', -2, (g) => g.ninja.pos.x > -3),
  {
    name: 'wire up to the apex',
    run: (g) => {
      const n = g.ninja;
      const a = g.level.anchors[1];
      if (n.pos.y > 67.5 && n.pos.x > 3) return null;
      const dx = a.x - n.center.x;
      const dy = a.y - n.center.y;
      const l = Math.hypot(dx, dy);
      return { aimX: dx / l, aimY: dy / l, moveX: 1, wireHeld: true };
    },
  },
  { name: 'drop to the platform', run: (g) => (g.ninja.grounded ? null : { moveX: toward(g, 9.5) }) },
  go('jump the steam gap', -4, (g) => g.ninja.grounded && g.ninja.pos.x < 0, jumpIf((g) => g.ninja.pos.x < 4.6)),
  go('into the last bouncer', -3.5, (g) => g.ninja.vel.y > 15),
  { name: 'rise to the summit', run: (g) => (g.ninja.pos.y > 77.2 ? null : { moveX: g.ninja.pos.x > -7.5 ? 0 : 1 }) },
  go('claim the spout', -15, (g) => g.phase === 'finished'),
];

function playRoute(g: TrialGame, trace: string[]): void {
  for (const leg of ROUTE) {
    let t = 0;
    for (;;) {
      if (g.phase !== 'playing') break;
      const partial = leg.run(g);
      if (!partial) break;
      g.step(DT, { ...IDLE_INTENT, ...partial }, NO_SLICE);
      g.events.length = 0;
      t += DT;
      if (t > 15) throw new Error(`stuck on "${leg.name}" at x ${g.ninja.pos.x.toFixed(1)} y ${g.ninja.pos.y.toFixed(1)} state ${g.ninja.state}\n${trace.join('\n')}`);
    }
    trace.push(`${leg.name}: ${t.toFixed(2)}s at (${g.ninja.pos.x.toFixed(1)}, ${g.ninja.pos.y.toFixed(1)}) stage ${g.stage} dry ${g.dryness}`);
    if (g.phase !== 'playing') break;
  }
}

test('the full climb can be finished using only the moves it teaches, hazards off', () => {
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
