import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BladeTime } from '../src/combat/BladeTime.ts';
import { KatanaSlice } from '../src/combat/KatanaSlice.ts';
import { TrialGame } from '../src/core/TrialGame.ts';
import { Level } from '../src/core/Level.ts';
import { mulberry32, v3 } from '../src/core/Vec.ts';
import { Stream } from '../src/hazards/ShowerStreamEmitter.ts';
import { TileHazardGrid } from '../src/hazards/TileHazardGrid.ts';
import { cleave, makeDroplet } from '../src/hazards/WaterDroplet.ts';
import { GrappleWire } from '../src/parkour/GrappleWire.ts';
import { COYOTE_TIME, DASH_IFRAMES, IDLE_INTENT, NinjaController } from '../src/parkour/NinjaController.ts';
import type { NinjaIntent } from '../src/parkour/NinjaController.ts';
import { findWall, rayBox } from '../src/parkour/WallRunDetector.ts';

const DT = 1 / 120;
const NO_SLICE = { pressed: false, held: false };

function setup(spawn = v3(-15, 2.01, 0)) {
  const level = new Level();
  const grid = new TileHazardGrid();
  const n = new NinjaController();
  n.reset(spawn, 1);
  const run = (seconds: number, intent: Partial<NinjaIntent> = {}) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      level.update(0);
      n.step(DT, { ...IDLE_INTENT, ...intent }, level, grid);
    }
  };
  return { level, grid, n, run };
}

test('rayBox reports distance and the face normal', () => {
  const level = new Level();
  const wall = level.boxes[2];
  const hit = rayBox(v3(19, 50, 0), v3(1, 0, 0), wall, 5)!;
  assert.ok(Math.abs(hit.t - 1) < 1e-6);
  assert.deepEqual(hit.normal, v3(-1, 0, 0));
});

test('the detector finds only a nearby runnable wall on the side asked', () => {
  const level = new Level();
  assert.equal(findWall(level, v3(19.6, 50, 0), 1, null), level.boxes[2]);
  assert.equal(findWall(level, v3(19.6, 50, 0), -1, null), null);
  assert.equal(findWall(level, v3(15, 50, 0), 1, null), null);
});

test('dry walls hold you up to the top, wet walls slip', () => {
  const dry = setup(v3(19.5, 60, 0));
  dry.run(0.1, { moveX: 1 });
  assert.equal(dry.n.state, 'wallrun');
  dry.run(1.5, { moveX: 1 });
  assert.equal(dry.n.state, 'wallrun');
  assert.ok(dry.n.pos.y > 70);

  const wet = setup(v3(-19.5, 42, 0));
  wet.run(0.1, { moveX: -1 });
  assert.equal(wet.n.state, 'wallrun');
  wet.run(0.8, { moveX: -1 });
  assert.notEqual(wet.n.state, 'wallrun');
});

test('a wall kick sends you up and away', () => {
  const { n, run } = setup(v3(-19.5, 42, 0));
  run(0.1, { moveX: -1 });
  run(DT, { moveX: -1, jumpPressed: true });
  assert.ok(n.vel.x > 8 && n.vel.y > 9);
});

test('a jump works during coyote time, then no longer', () => {
  const walkOff = (wait: number) => {
    const { n, run } = setup(v3(8.4, 2.01, 0));
    run(0.05);
    n.vel.x = 3;
    let t = 0;
    while (n.grounded && t < 2) {
      run(DT, { moveX: 1 });
      t += DT;
    }
    run(wait, {});
    run(DT, { jumpPressed: true, jumpHeld: true });
    return n.vel.y;
  };
  assert.ok(walkOff(COYOTE_TIME * 0.5) > 9);
  assert.ok(walkOff(COYOTE_TIME + 0.1) < 0);
});

test('letting go of jump cuts it short', () => {
  const peak = (held: boolean) => {
    const { n, run } = setup();
    run(0.05);
    run(DT, { jumpPressed: true, jumpHeld: true });
    let top = 0;
    for (let i = 0; i < 80; i++) {
      run(DT, { jumpHeld: held });
      top = Math.max(top, n.pos.y);
    }
    return top;
  };
  assert.ok(peak(true) > peak(false) + 0.5);
});

test('slide lowers the ninja, adds speed, and wet tile gives a bigger burst', () => {
  const burst = (wet: boolean) => {
    const { n, run, grid } = setup();
    run(0.05);
    if (wet) for (let x = -20; x < -9; x += 0.5) grid.wet(v3(x, 2, 0), v3(0, 1, 0));
    n.vel.x = 9;
    run(DT, { moveX: 1, slide: true });
    assert.equal(n.state, 'slide');
    assert.equal(n.height, 0.9);
    return n.speed - 9;
  };
  assert.ok(burst(true) > burst(false) + 2);
});

test('the slide will not stand up under the low pipe', () => {
  const { n, run } = setup(v3(-1.7, 2.01, 0));
  run(0.05);
  n.vel.x = 9;
  run(DT, { moveX: 1, slide: true });
  run(0.07, { moveX: 1, slide: true });
  assert.ok(n.pos.x > -1 && n.pos.x < 0, `x ${n.pos.x}`);
  run(0.01);
  assert.equal(n.state, 'slide');
});

test('the iai dash gives ten frames of i-frames and spends the air charge', () => {
  const { n, run } = setup(v3(0, 30, 0));
  run(DT, { dashPressed: true, moveX: 1 });
  assert.equal(n.state, 'dash');
  assert.ok(Math.abs(n.iframes - DASH_IFRAMES) < 0.02);
  assert.equal(n.airDashes, 0);
  run(0.7);
  run(DT, { dashPressed: true, moveX: 1 });
  assert.notEqual(n.state, 'dash');
});

test('the wire pulls only when stretched, and reels in', () => {
  const wire = new GrappleWire();
  const vel = v3();
  wire.attach(v3(0, 20, 0), v3(0, 0, 0));
  wire.length = 30;
  wire.apply(v3(0, 0, 0), vel, DT);
  assert.equal(vel.y, 0);
  wire.length = 10;
  wire.apply(v3(0, 0, 0), vel, DT);
  assert.ok(vel.y > 0);
  assert.ok(wire.length < 10);
});

test('the blade cuts only what the sweep has reached, where you aim', () => {
  const k = new KatanaSlice();
  const aim = v3(1, 0, 0);
  const eye = v3();
  assert.equal(k.cuts(eye, aim, v3(2, 0, 0), 0.4), null);
  k.swing();
  k.update(0.15);
  assert.ok(k.cuts(eye, aim, v3(2, 0, 0), 0.4));
  assert.equal(k.cuts(eye, aim, v3(-2, 0, 0), 0.4), null);
  assert.equal(k.cuts(eye, aim, v3(9, 0, 0), 0.4), null);
  assert.ok(k.cuts(eye, v3(0, 1, 0), v3(0, 2, 0), 0.4));
});

test('cleaving makes two halves moving apart', () => {
  const [a, b] = cleave(makeDroplet(v3(0, 5, 0), 0.4, 0), v3(1, 0, 0));
  assert.ok(a.vel.x > 0 && b.vel.x < 0);
});

test('blade time needs a mid-air hold, eases to 0.2x and runs out', () => {
  const b = new BladeTime();
  for (let i = 0; i < 40; i++) b.update(1 / 60, true, false);
  assert.ok(b.scale > 0.99);
  for (let i = 0; i < 40; i++) b.update(1 / 60, true, true);
  assert.ok(b.scale < 0.25 && b.scale >= 0.2);
  for (let i = 0; i < 200; i++) b.update(1 / 60, true, true);
  assert.ok(b.scale > 0.9);
});

test('pulsing streams follow the beat, and a sliding ninja fits under the low one', () => {
  const level = new Level();
  const s = new Stream(level.streams[0]);
  s.update(0.1, level);
  assert.equal(s.on, true);
  s.update(0.8 * 2.5, level);
  assert.equal(s.on, false);
  s.update(0.1, level);
  assert.ok(s.touches(v3(4.7, 2, -0.3), v3(5.3, 3.8, 0.3)));
  assert.equal(s.touches(v3(4.7, 2, -0.3), v3(5.3, 2.9, 0.3)), null);
});

function playing() {
  const g = new TrialGame(mulberry32(7));
  g.start(false);
  return g;
}

test('a droplet hit stains and drains, and hardcore fails on the first drop', () => {
  const g = playing();
  g.droplets.push(makeDroplet(v3(g.ninja.pos.x, g.ninja.pos.y + 1, 0), 0.4, 0));
  g.step(DT, IDLE_INTENT, NO_SLICE);
  assert.equal(g.stains, 1);
  assert.equal(g.dryness, 86);
  const h = new TrialGame(mulberry32(7));
  h.start(true);
  h.droplets.push(makeDroplet(v3(h.ninja.pos.x, h.ninja.pos.y + 1, 0), 0.4, 0));
  h.step(DT, IDLE_INTENT, NO_SLICE);
  assert.equal(h.phase, 'failed');
});

test('slicing a droplet refills the air dash and leaves no stain', () => {
  const g = playing();
  const n = g.ninja;
  n.airDashes = 0;
  const eye = n.eye;
  g.droplets = [makeDroplet(v3(eye.x + 2, eye.y, 0), 0.42, 0)];
  g.step(DT, IDLE_INTENT, { pressed: true, held: true });
  for (let i = 0; i < 24; i++) g.step(DT, IDLE_INTENT, { pressed: false, held: true });
  assert.equal(g.slices, 1);
  assert.equal(n.airDashes, 1);
  assert.equal(g.stains, 0);
  assert.equal(g.halves.length, 2);
});

test('the dash pierces droplets without a stain', () => {
  const g = playing();
  const n = g.ninja;
  for (let i = 0; i < 4; i++) g.step(DT, IDLE_INTENT, NO_SLICE);
  g.step(DT, { ...IDLE_INTENT, dashPressed: true, moveX: 1 }, NO_SLICE);
  g.droplets = [makeDroplet(v3(n.pos.x, n.pos.y + 1, 0), 0.42, 0)];
  g.step(DT, IDLE_INTENT, NO_SLICE);
  assert.equal(g.stains, 0);
  assert.equal(g.slices, 1);
});

test('a parry opens a 0.4 s corridor through a stream', () => {
  const g = playing();
  g.droplets = [];
  g.ninja.reset(v3(5, 2.01, 0), 1);
  g.time = 0;
  const aim = { ...IDLE_INTENT, aimX: 0.6, aimY: 0.8 };
  g.step(DT, aim, { pressed: true, held: true });
  let corridor = g.corridor;
  for (let i = 0; i < 12; i++) {
    g.step(DT, aim, NO_SLICE);
    corridor = Math.max(corridor, g.corridor);
  }
  assert.ok(corridor > 0.3 && corridor <= 0.4, `corridor ${corridor}`);
  assert.equal(g.stains, 0);
});

test('falling in the water costs dryness and returns you to the checkpoint', () => {
  const g = playing();
  g.ninja.pos.y = 0.05;
  g.step(DT, IDLE_INTENT, NO_SLICE);
  assert.equal(g.dryness, 70);
  assert.ok(g.ninja.pos.y > 1);
});
