import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRID_SIZE, STALL_HALF, SURFACES, TileGrid } from '../src/player/FloorInteraction.ts';
import { COYOTE_TIME, DASH_COOLDOWN, NO_INTENT, PlayerController } from '../src/player/PlayerController.ts';
import type { PlayerIntent } from '../src/player/PlayerController.ts';

const DT = 1 / 120;

function run(p: PlayerController, seconds: number, intent: Partial<PlayerIntent>, surface = SURFACES.wet) {
  const full = { ...NO_INTENT, ...intent };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) p.step(DT, full, surface, 0, 0);
}

function pressOnce(p: PlayerController, intent: Partial<PlayerIntent>, surface = SURFACES.wet) {
  return p.step(DT, { ...NO_INTENT, ...intent }, surface, 0, 0);
}

function fresh(vx = 0, vz = 0): PlayerController {
  const p = new PlayerController();
  p.reset(0, 0);
  p.vx = vx;
  p.vz = vz;
  return p;
}

test('coasting distance goes dry < wet < soapy', () => {
  const dist = (name: keyof typeof SURFACES) => {
    const p = fresh(0, 0);
    p.reset(-5, 0);
    p.vx = 5;
    run(p, 1, {}, SURFACES[name]);
    return p.x + 5;
  };
  assert.ok(dist('dry') < 1, `dry ${dist('dry')}`);
  assert.ok(dist('wet') > 2.5, `wet ${dist('wet')}`);
  assert.ok(dist('soapy') > 4.7, `soapy ${dist('soapy')}`);
});

test('soapy tile keeps almost all sliding speed', () => {
  const p = fresh(6, 0);
  run(p, 0.8, {}, SURFACES.soapy);
  assert.ok(p.speed > 5.7);
});

test('steering on wet tile drifts: sideways speed lingers where dry tile bites instantly', () => {
  const lateralAfterTurn = (name: keyof typeof SURFACES) => {
    const p = fresh(6, 0);
    run(p, 0.2, { moveZ: 1 }, SURFACES[name]);
    return Math.abs(p.vx);
  };
  assert.ok(lateralAfterTurn('wet') > 2.5);
  assert.ok(lateralAfterTurn('dry') < 0.3);
});

test('overspeed bleeds softly rather than being clamped', () => {
  const p = fresh(14, 0);
  pressOnce(p, {});
  assert.ok(p.speed > 13);
  run(p, 1.5, {});
  assert.ok(p.speed < SURFACES.wet.maxSpeed);
});

test('sliding reaches a higher top speed and lowers the hitbox', () => {
  const top = (slide: boolean) => {
    const p = fresh();
    run(p, 0.45, { moveX: 1, slide });
    return p;
  };
  const normal = top(false);
  const sliding = top(true);
  assert.ok(sliding.height < normal.height);
  const p = fresh(SURFACES.wet.maxSpeed, 0);
  run(p, 0.4, { moveX: 1, slide: true });
  assert.ok(p.speed > SURFACES.wet.maxSpeed);
});

test('a sliding player clears a shin-height droplet that hits a standing one', () => {
  const p = fresh();
  assert.equal(p.overlapsSphere(0, 0.62, 0, 0.13), true);
  run(p, DT, { slide: true });
  assert.equal(p.sliding, true);
  assert.equal(p.overlapsSphere(p.x, 0.62, p.z, 0.13), false);
});

test('dash fires during the coyote window after a hop', () => {
  const p = fresh();
  pressOnce(p, { hopPressed: true });
  assert.equal(p.grounded, false);
  run(p, COYOTE_TIME * 0.7, {});
  assert.equal(pressOnce(p, { dashPressed: true }).dashed, true);
  assert.equal(p.vy, 0, 'a coyote dash carries flat');
});

test('dash is refused once the coyote window has passed', () => {
  const p = fresh();
  pressOnce(p, { hopPressed: true });
  run(p, COYOTE_TIME + 0.08, {});
  assert.equal(pressOnce(p, { dashPressed: true }).dashed, false);
});

test('an early press is buffered through to landing', () => {
  const p = fresh();
  pressOnce(p, { hopPressed: true });
  run(p, 0.57, {});
  assert.equal(p.grounded, false);
  pressOnce(p, { dashPressed: true });
  let dashed = false;
  for (let i = 0; i < 24 && !dashed; i++) dashed = pressOnce(p, {}).dashed;
  assert.equal(dashed, true);
});

test('dash has a cooldown and is invincible only while it lasts', () => {
  const p = fresh();
  assert.equal(pressOnce(p, { dashPressed: true, moveX: 1 }).dashed, true);
  assert.equal(p.dashing, true);
  assert.equal(pressOnce(p, { dashPressed: true }).dashed, false);
  run(p, 0.2, {});
  assert.equal(p.dashing, false);
  run(p, DASH_COOLDOWN, {});
  assert.equal(pressOnce(p, { dashPressed: true }).dashed, true);
});

test('hop cannot be repeated in the air', () => {
  const p = fresh();
  assert.equal(pressOnce(p, { hopPressed: true }).hopped, true);
  assert.equal(pressOnce(p, { hopPressed: true }).hopped, false);
  run(p, 0.05, { hopPressed: true });
  assert.ok(p.vy < 6);
});

test('walls bounce with lost energy, so soap slides can be redirected', () => {
  const p = fresh();
  p.reset(STALL_HALF - 0.4, 0);
  p.vx = 8;
  run(p, 0.1, {}, SURFACES.soapy);
  assert.ok(p.vx < 0 && p.vx > -8);
  assert.ok(p.x < STALL_HALF);
});

test('bubble needs repeated presses to burst', () => {
  const p = fresh();
  p.encase();
  let burst = false;
  for (let i = 0; i < 5; i++) burst = pressOnce(p, { mash: 1 }).burst || burst;
  assert.equal(burst, false);
  assert.equal(pressOnce(p, { mash: 1 }).burst, true);
  assert.equal(p.encased, false);
});

test('grid starts with dry corners and wet everywhere else', () => {
  const grid = new TileGrid();
  let dry = 0;
  for (let j = 0; j < GRID_SIZE; j++) {
    for (let i = 0; i < GRID_SIZE; i++) {
      if (grid.surfaceAt(i - STALL_HALF + 0.5, j - STALL_HALF + 0.5) === 'dry') dry++;
    }
  }
  assert.equal(dry, 12);
  assert.equal(grid.surfaceAt(-6.5, -6.5), 'dry');
  assert.equal(grid.surfaceAt(6.5, 6.5), 'dry');
  assert.equal(grid.surfaceAt(0, 0), 'wet');
});

test('soap beats water, and water rinses soap away', () => {
  const grid = new TileGrid();
  grid.addSoap(1, 1, 1);
  assert.equal(grid.surfaceAt(1, 1), 'soapy');
  for (let i = 0; i < 3; i++) grid.addWater(1, 1, 0.5);
  assert.equal(grid.surfaceAt(1, 1), 'wet');
});

test('tiles dry out and positions outside the stall clamp to the edge', () => {
  const grid = new TileGrid();
  for (let i = 0; i < 60; i++) grid.update(1);
  assert.equal(grid.surfaceAt(0, 0), 'dry');
  assert.equal(grid.indexAt(-100, -100), 0);
  assert.equal(grid.indexAt(100, 100), GRID_SIZE * GRID_SIZE - 1);
});
