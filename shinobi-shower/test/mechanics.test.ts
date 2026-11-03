import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BladeTime } from '../src/combat/BladeTime.ts';
import { KatanaSlice } from '../src/combat/KatanaSlice.ts';
import { TrialGame } from '../src/core/TrialGame.ts';
import { Level } from '../src/core/Level.ts';
import { mulberry32, v3, viewDir } from '../src/core/Vec.ts';
import { Stream } from '../src/hazards/ShowerStreamEmitter.ts';
import { TileHazardGrid } from '../src/hazards/TileHazardGrid.ts';
import { cleave, makeDroplet } from '../src/hazards/WaterDroplet.ts';
import { GrappleWire } from '../src/parkour/GrappleWire.ts';
import { COYOTE_TIME, DASH_IFRAMES, IDLE_INTENT, NinjaController } from '../src/parkour/NinjaController.ts';
import type { NinjaIntent } from '../src/parkour/NinjaController.ts';
import { findWall, rayBox } from '../src/parkour/WallRunDetector.ts';

const DT = 1 / 120;
const NO_SLICE = { pressed: false, held: false };

function setup(spawn = v3(-22, 2.01, 24), yaw = -Math.PI / 2) {
  const level = new Level();
  const grid = new TileHazardGrid();
  const n = new NinjaController();
  n.reset(spawn, yaw);
  const run = (seconds: number, intent: Partial<NinjaIntent> = {}) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      level.update(0);
      n.step(DT, { ...IDLE_INTENT, yaw: n.yaw, pitch: n.pitch, ...intent }, level, grid);
    }
  };
  return { level, grid, n, run };
}

test('rayBox reports distance and the face normal', () => {
  const level = new Level();
  const wall = level.boxes[2];
  const hit = rayBox(v3(29, 10, 0), v3(1, 0, 0), wall, 5)!;
  assert.ok(Math.abs(hit.t - 1) < 1e-6);
  assert.deepEqual(hit.normal, v3(-1, 0, 0));
});

test('the detector finds a wall from a parallel run and rejects a head-on one', () => {
  const level = new Level();
  const near = v3(29.5, 10, 0);
  const wall = findWall(level, near, v3(0, 0, 10), null)!;
  assert.deepEqual(wall.normal, v3(-1, 0, 0));
  assert.equal(wall.tangent.z, 1);
  assert.equal(findWall(level, near, v3(10, 0, 0.5), null), null);
  assert.equal(findWall(level, near, v3(0, 0, 2), null), null);
});

test('dry wall-runs hold indefinitely and wet ones slip', () => {
  const hold = (y: number, x: number, z: number, vz: number, side: number) => {
    const { n, run } = setup(v3(x, y, z), vz > 0 ? Math.PI : 0);
    n.vel = v3(side, 0, vz);
    run(0.1, { moveZ: 1 });
    assert.equal(n.state, 'wallrun');
    let t = 0;
    while (n.state === 'wallrun' && t < 2.5) {
      run(DT, { moveZ: 1 });
      t += DT;
    }
    return { t, slipped: n.events.wallSlip };
  };
  const dry = hold(30, 29.5, -20, 11, 1);
  assert.ok(dry.t > 2.2);
  const wet = hold(26, -29.5, -20, 11, -1);
  assert.ok(wet.t < 1, `held ${wet.t}`);
});

test('a jump works during coyote time, then no longer', () => {
  const walkOff = (wait: number) => {
    const { n, run } = setup(v3(1.4, 2.01, 24));
    run(0.05);
    n.vel.x = 9;
    let t = 0;
    while (n.grounded && t < 2) {
      run(DT, { moveZ: 1 });
      t += DT;
    }
    run(wait, { moveZ: 1 });
    n.step(DT, { ...IDLE_INTENT, yaw: n.yaw, moveZ: 1, jumpPressed: true }, new Level(), new TileHazardGrid());
    return n.vel.y;
  };
  assert.ok(walkOff(COYOTE_TIME * 0.5) > 7);
  assert.ok(walkOff(COYOTE_TIME + 0.1) < 0);
});

test('slide lowers the ninja, adds speed, and wet tile gives a bigger burst', () => {
  const burst = (wet: boolean) => {
    const { n, run, grid } = setup();
    run(0.05);
    if (wet) for (let x = -28; x < -16; x += 0.5) for (let z = 20; z < 28; z += 0.5) grid.wet(v3(x, 2, z), v3(0, 1, 0));
    n.vel.x = 9;
    const before = n.speed;
    run(DT, { moveZ: 1, slide: true });
    assert.equal(n.state, 'slide');
    assert.equal(n.height, 0.9);
    return n.speed - before;
  };
  assert.ok(burst(true) > burst(false) + 2);
});

test('the slide will not stand up under the low pipe', () => {
  const { n, run } = setup(v3(-8, 2.01, 24));
  run(0.05);
  n.vel.x = 9;
  run(DT, { moveZ: 1, slide: true });
  run(0.09, { moveZ: 1, slide: true });
  assert.ok(n.pos.x > -7.2 && n.pos.x < -5.8, `x ${n.pos.x}`);
  run(0.01);
  assert.equal(n.state, 'slide');
});

test('the iai dash gives exactly ten frames of i-frames and spends the air charge', () => {
  const { n, run } = setup(v3(0, 30, 0));
  run(DT, { dashPressed: true, moveZ: 1 });
  assert.equal(n.state, 'dash');
  assert.ok(Math.abs(n.iframes - (DASH_IFRAMES - 0)) < 0.02);
  assert.equal(n.airDashes, 0);
  run(0.7);
  run(DT, { dashPressed: true, moveZ: 1 });
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

test('the blade cuts only what the sweep has reached', () => {
  const k = new KatanaSlice();
  const look = viewDir(0, 0);
  const eye = v3();
  assert.equal(k.cuts(eye, look, v3(0, 0, -2), 0.4), null);
  k.swing();
  k.update(0.15);
  assert.ok(k.cuts(eye, look, v3(0, 0, -2), 0.4));
  assert.equal(k.cuts(eye, look, v3(0, 0, 2), 0.4), null);
  assert.equal(k.cuts(eye, look, v3(0, 0, -9), 0.4), null);
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
  assert.ok(s.touches(v3(-2.3, 2, 23.7), v3(-1.7, 3.8, 24.3)));
  assert.equal(s.touches(v3(-2.3, 2, 23.7), v3(-1.7, 2.9, 24.3)), null);
});

function playing() {
  const g = new TrialGame(mulberry32(7));
  g.start(false);
  return g;
}

test('a droplet hit stains and drains, and hardcore fails on the first drop', () => {
  const g = playing();
  g.droplets.push(makeDroplet(v3(g.ninja.pos.x, g.ninja.pos.y + 1, g.ninja.pos.z), 0.4, 0));
  g.step(DT, IDLE_INTENT, NO_SLICE);
  assert.equal(g.stains, 1);
  assert.equal(g.dryness, 86);
  const h = new TrialGame(mulberry32(7));
  h.start(true);
  h.droplets.push(makeDroplet(v3(h.ninja.pos.x, h.ninja.pos.y + 1, h.ninja.pos.z), 0.4, 0));
  h.step(DT, { ...IDLE_INTENT, yaw: h.ninja.yaw }, NO_SLICE);
  assert.equal(h.phase, 'failed');
});

test('slicing a droplet refills the air dash and leaves no stain', () => {
  const g = playing();
  g.hazardsOn = true;
  const n = g.ninja;
  n.airDashes = 0;
  const yaw = n.yaw;
  const look = viewDir(yaw, 0);
  const eye = n.eye;
  g.droplets = [makeDroplet(v3(eye.x + look.x * 2, eye.y, eye.z + look.z * 2), 0.42, 0)];
  g.step(DT, { ...IDLE_INTENT, yaw }, { pressed: true, held: true });
  for (let i = 0; i < 24; i++) g.step(DT, { ...IDLE_INTENT, yaw }, { pressed: false, held: true });
  assert.equal(g.slices, 1);
  assert.equal(n.airDashes, 1);
  assert.equal(g.stains, 0);
  assert.equal(g.halves.length, 2);
});

test('the dash pierces droplets without a stain', () => {
  const g = playing();
  const n = g.ninja;
  const yaw = n.yaw;
  for (let i = 0; i < 4; i++) g.step(DT, { ...IDLE_INTENT, yaw }, NO_SLICE);
  g.step(DT, { ...IDLE_INTENT, yaw, dashPressed: true, moveZ: 1 }, NO_SLICE);
  g.droplets = [makeDroplet(v3(n.pos.x, n.pos.y + 1, n.pos.z), 0.42, 0)];
  g.step(DT, { ...IDLE_INTENT, yaw }, NO_SLICE);
  assert.equal(g.stains, 0);
  assert.equal(g.slices, 1);
});

test('a parry opens a 0.4 s corridor through a stream', () => {
  const g = playing();
  g.hazardsOn = true;
  g.droplets = [];
  const n = g.ninja;
  n.reset(v3(-2, 2.01, 24), Math.PI);
  g.time = 0;
  const yaw = Math.PI;
  g.step(DT, { ...IDLE_INTENT, yaw }, { pressed: true, held: true });
  let corridor = g.corridor;
  for (let i = 0; i < 12; i++) {
    g.step(DT, { ...IDLE_INTENT, yaw }, NO_SLICE);
    corridor = Math.max(corridor, g.corridor);
  }
  assert.ok(corridor > 0.3 && corridor <= 0.4, `corridor ${corridor}`);
  assert.equal(g.stains, 0);
});

test('falling in the water costs dryness and returns you to the checkpoint', () => {
  const g = playing();
  g.ninja.pos.y = 0.05;
  g.step(DT, { ...IDLE_INTENT, yaw: g.ninja.yaw }, NO_SLICE);
  assert.equal(g.dryness, 70);
  assert.ok(g.ninja.pos.y > 1);
});
