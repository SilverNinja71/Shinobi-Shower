import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CYCLES, GameLoop, waveAt } from '../src/core/GameLoop.ts';
import { mulberry32 } from '../src/core/Rng.ts';
import { HEAVY_TELEGRAPH, stepDroplet } from '../src/hazards/DropletProjectile.ts';
import { DropletSpawner } from '../src/hazards/DropletSpawner.ts';
import { DRAIN_RADIUS, drainPull, drainStrength } from '../src/hazards/SudsVortex.ts';
import { NO_INTENT } from '../src/player/PlayerController.ts';
import type { PlayerIntent } from '../src/player/PlayerController.ts';

const DT = 1 / 120;

test('cone spray lands inside the aimed patch', () => {
  const spawner = new DropletSpawner(mulberry32(1));
  const landings: [number, number][] = [];
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2;
    const tx = Math.cos(a) * 3;
    const tz = Math.sin(a) * 3;
    spawner.pool.clear();
    spawner.spawnSpray(tx, tz);
    const d = spawner.pool.alive[0];
    let guard = 0;
    while (!stepDroplet(d, DT) && guard++ < 1000);
    landings.push([d.x - tx, d.z - tz]);
  }
  for (const [ex, ez] of landings) assert.ok(Math.hypot(ex, ez) < 0.15, `missed by ${Math.hypot(ex, ez)}`);
});

test('a heavy drop lands at its target exactly when the telegraph ends', () => {
  const spawner = new DropletSpawner(mulberry32(2));
  spawner.spawnHeavy(2, -3);
  const d = spawner.pool.alive[0];
  let t = 0;
  while (!stepDroplet(d, DT)) t += DT;
  assert.ok(Math.abs(t + DT - HEAVY_TELEGRAPH) < DT * 1.5);
  assert.ok(Math.abs(d.y) < 0.1);
  assert.equal(d.x, 2);
  assert.equal(d.z, -3);
});

test('a burst throws 8 to 12 beads and starts one ripple', () => {
  for (let seed = 1; seed < 40; seed++) {
    const spawner = new DropletSpawner(mulberry32(seed));
    spawner.burst(0, 0);
    const beads = spawner.pool.count('bead');
    assert.ok(beads >= 8 && beads <= 12, `${beads} beads`);
    assert.equal(spawner.ripples.length, 1);
  }
});

test('drain pulls toward the centre, harder when close and later in the shower', () => {
  const near = drainPull(1, 0, 3, { x: 0, z: 0 });
  const far = drainPull(5, 0, 3, { x: 0, z: 0 });
  assert.ok(near.x < 0);
  assert.ok(Math.abs(near.x) > Math.abs(far.x));
  assert.deepEqual(drainPull(6.5, 0, 3, { x: 0, z: 0 }), { x: 0, z: 0 });
  assert.ok(drainStrength(180) > drainStrength(60));
  assert.ok(drainStrength(60) > drainStrength(0));
});

test('the wave gets harder through each cycle', () => {
  assert.equal(CYCLES.length, 3);
  assert.ok(waveAt(179).coneRate > waveAt(100).coneRate);
  assert.ok(waveAt(100).coneRate > waveAt(10).coneRate);
  assert.ok(waveAt(179).heavyInterval < waveAt(10).heavyInterval);
});

test('a heavy drop landing on the player crushes and knocks back', () => {
  const game = new GameLoop(mulberry32(3));
  game.start();
  game.player.reset(3, 3);
  game.spawner.spawnHeavy(3.2, 3);
  for (let i = 0; i < 95; i++) game.step(DT);
  assert.ok(game.events.some((e) => e.type === 'crush'));
  assert.ok(game.moisture.value >= 18);
  assert.ok(game.player.speed > 3);
});

test('the dash passes through spray and costs moisture', () => {
  const game = new GameLoop(mulberry32(4));
  game.start();
  game.player.reset(5, 5);
  game.step(DT, { ...NO_INTENT, dashPressed: true, moveX: -1 });
  const afterDash = game.moisture.value;
  assert.ok(afterDash > 3.9);
  const d = game.spawner.pool.spawn('bead')!;
  Object.assign(d, { x: game.player.x, y: 0.3, z: game.player.z, vx: 0, vy: 0, vz: 0, r: 0.1, life: 2 });
  game.step(DT);
  assert.ok(game.moisture.value - afterDash < 1);
  assert.ok(game.spawner.pool.alive.includes(d));
});

test('reaching the drain ends the run, hopping across it does not', () => {
  const game = new GameLoop(mulberry32(5));
  game.start();
  game.player.reset(DRAIN_RADIUS * 0.5, 0);
  game.player.applyImpulse(0, 3, 0);
  game.player.y = 0.5;
  game.step(DT);
  assert.equal(game.state, 'playing');
  game.player.reset(DRAIN_RADIUS * 0.5, 0);
  game.step(DT);
  assert.equal(game.state, 'lost');
  assert.equal(game.lossCause, 'drained');
});

test('surviving the full shower wins', () => {
  const game = new GameLoop(mulberry32(6));
  game.start();
  game.time = 179.99;
  game.player.reset(6, 6);
  for (let i = 0; i < 4 && game.state === 'playing'; i++) game.step(DT);
  assert.equal(game.state, 'won');
});

function playedSeconds(seed: number, brain: (g: GameLoop) => PlayerIntent): { time: number; cause: string } {
  const game = new GameLoop(mulberry32(seed));
  game.start();
  while (game.state === 'playing') game.step(DT, brain(game));
  game.events.length = 0;
  return { time: game.time, cause: game.lossCause ?? 'won' };
}

/** A plain potential-field dodger: flees telegraphs, the drain and walls. A person also has hops, slides and dry tile. */
function dodgeBot(g: GameLoop): PlayerIntent {
  const p = g.player;
  let mx = 0;
  let mz = 0;
  let threatened = false;
  const dist = Math.hypot(p.x, p.z) || 1;
  const drainFear = dist < 3.5 ? 2 : 0.2;
  mx += (p.x / dist) * drainFear;
  mz += (p.z / dist) * drainFear;
  if (Math.abs(p.x) > 5.5) mx -= Math.sign(p.x) * 2;
  if (Math.abs(p.z) > 5.5) mz -= Math.sign(p.z) * 2;
  for (const d of g.spawner.pool.alive) {
    if (d.kind !== 'heavy') continue;
    const dx = p.x - d.x;
    const dz = p.z - d.z;
    const r = Math.hypot(dx, dz);
    if (r < 3) {
      threatened = threatened || r < 1.3;
      mx += (dx / (r + 0.01)) * 4;
      mz += (dz / (r + 0.01)) * 4;
    }
  }
  const len = Math.hypot(mx, mz) || 1;
  return {
    ...NO_INTENT,
    moveX: mx / len,
    moveZ: mz / len,
    dashPressed: threatened && g.moisture.value < 70,
    hopPressed: g.spawner.streamWarning !== null,
    mash: p.encased ? 1 : 0,
  };
}

test('balance: standing still loses quickly, plain dodging lasts far longer', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const idle = seeds.map((s) => playedSeconds(s, () => NO_INTENT));
  const dodger = seeds.map((s) => playedSeconds(s, dodgeBot));
  const line = (rs: { time: number; cause: string }[]) => rs.map((r) => `${r.time.toFixed(0)}s ${r.cause[0]}`).join(' ');
  console.log('idle   ', line(idle));
  console.log('dodger ', line(dodger));
  const mean = (rs: { time: number }[]) => rs.reduce((a, r) => a + r.time, 0) / rs.length;
  assert.ok(mean(idle) < 40);
  assert.ok(mean(dodger) > mean(idle) * 2);
});
