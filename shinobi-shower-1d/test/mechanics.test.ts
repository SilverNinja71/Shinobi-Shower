import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROFILES, damageOf, extents, makeDrop, stepDrops } from '../src/engine/DropletPhysics.ts';
import type { Drop, DropKind } from '../src/engine/DropletPhysics.ts';
import { Game, NO_INPUT } from '../src/engine/Game.ts';
import { WeatherSystem, seasonOf } from '../src/engine/WeatherSystem.ts';
import { Katana, SWEET_HALF_WIDTH } from '../src/entities/Katana.ts';
import { DASH_COST, MAX_SPEED, Ninja } from '../src/entities/Ninja.ts';
import { LevelManager, expToNext, totalExpFor } from '../src/progression/LevelManager.ts';
import { BASE_COOLDOWN, incomingDamage, stanceFor } from '../src/progression/StanceModifiers.ts';

const DT = 1 / 120;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

/** A game with no weather, so tests place every drop themselves. */
function quietGame(level = 1): Game {
  const g = new Game(level);
  g.start(7);
  g.weather.update = () => {};
  return g;
}

function stepN(g: Game, n: number, input = NO_INPUT) {
  for (let i = 0; i < n; i++) g.step(DT, input);
}

test('momentum: the ninja speeds up over time, tops out, and coasts to a stop', () => {
  const n = new Ninja();
  const s = stanceFor(1);
  n.update(DT, 1, false, s);
  assert.ok(n.vx > 0 && n.vx < 1, 'first step only nudges');
  for (let i = 0; i < 60; i++) n.update(DT, 1, false, s);
  assert.ok(near(n.vx, MAX_SPEED), 'reaches top speed');
  let steps = 0;
  while (n.vx > 0) {
    n.update(DT, 0, false, s);
    steps++;
  }
  assert.ok(steps > 10, 'coasts instead of stopping dead');
});

test('dash roll costs stamina, is fast, and is invulnerable', () => {
  const g = quietGame();
  const x = g.ninja.x;
  g.step(DT, { ...NO_INPUT, moveX: 1, dashPressed: true });
  assert.equal(g.ninja.rolling, true);
  assert.equal(g.ninja.stamina, 100 - DASH_COST);
  g.spawn('rain', g.ninja.x + 0.3, 0.6);
  g.step(DT, NO_INPUT);
  assert.equal(g.dryness, 100, 'rolling through rain costs nothing');
  stepN(g, 30);
  assert.ok(g.ninja.x - x > 3, 'a roll covers ground');
});

test('the katana cooldown is exactly 0.35 seconds', () => {
  const k = new Katana();
  const s = stanceFor(1);
  k.press();
  assert.equal(k.update(DT, s, 1, true), true);
  let steps = 0;
  let started = false;
  while (!started && steps < 200) {
    k.press();
    started = k.update(DT, s, 1, true);
    steps++;
  }
  assert.ok(near(steps * DT, BASE_COOLDOWN, 1e-9), `took ${steps} steps`);
});

test('flame edge stretches the cooldown by 25%', () => {
  const k = new Katana();
  const s = stanceFor(30);
  k.press();
  k.update(DT, s, 1, true);
  let steps = 0;
  do {
    k.press();
    steps++;
  } while (!k.update(DT, s, 1, true));
  assert.ok(near(steps * DT, BASE_COOLDOWN * 1.25, DT), `took ${steps} steps`);
});

test('a press during cooldown is buffered only when it is close', () => {
  const k = new Katana();
  const s = stanceFor(1);
  k.press();
  k.update(DT, s, 1, true);
  k.press(); // far too early
  let fired = false;
  for (let i = 0; i < 60; i++) fired ||= k.update(DT, s, 1, true);
  assert.equal(fired, false);
});

test('a slash cuts rain in front, but not behind', () => {
  const g = quietGame();
  const front = g.spawn('rain', g.ninja.x + 1.2, 2);
  const back = g.spawn('rain', g.ninja.x - 1.2, 2);
  front.vy = back.vy = 0;
  g.step(DT, { ...NO_INPUT, slashPressed: true });
  stepN(g, 10);
  assert.equal(front.dead, true);
  assert.equal(back.dead, false);
  assert.equal(g.stats.sliced, 1);
});

function freeze(d: Drop) {
  d.vy = 0;
  return d;
}

test('hail only breaks on the sweet spot; off-centre it glances', () => {
  const g = quietGame();
  const sweet = g.katana.arcs(g.ninja.x, g.stance)[0].sweet;
  const centred = freeze(g.spawn('hail', sweet, 2, 0.5));
  g.weather.update = () => {};
  const orig = PROFILES.hail.gravity;
  PROFILES.hail.gravity = 0;
  try {
    g.step(DT, { ...NO_INPUT, slashPressed: true });
    stepN(g, 12);
    assert.equal(centred.dead, true);
    assert.equal(g.stats.perfect, 1);

    const g2 = quietGame();
    const off = freeze(g2.spawn('hail', g2.katana.arcs(g2.ninja.x, g2.stance)[0].sweet + SWEET_HALF_WIDTH + 0.5, 2, 0.5));
    g2.step(DT, { ...NO_INPUT, slashPressed: true });
    stepN(g2, 12);
    assert.equal(off.dead, false);
    assert.ok(off.vx > 0, 'knocked away');
    assert.ok(g2.events.some((e) => e.type === 'clang'));
  } finally {
    PROFILES.hail.gravity = orig;
  }
});

test('each precipitation has its own profile', () => {
  const drizzle = makeDrop('drizzle', 5, 10);
  const rain = makeDrop('rain', 5, 10);
  const snow = makeDrop('snow', 5, 10);
  const hail = makeDrop('hail', 5, 10, 0.7);
  assert.ok(drizzle.r < rain.r && rain.r < snow.r && snow.r < hail.r);
  assert.ok(Math.abs(rain.vy) > Math.abs(drizzle.vy) && Math.abs(drizzle.vy) > Math.abs(snow.vy));
  assert.ok(damageOf(drizzle) < damageOf(rain) / 3, 'drizzle chips');
  assert.equal(damageOf(hail), 40);
  assert.ok(near(damageOf(makeDrop('hail', 0, 0, 0.45)), 25));
  assert.ok(extents(snow).rx > extents(snow).ry, 'snow is wide');
  assert.ok(extents(rain).ry > extents(rain).rx, 'rain is a streak');
  // Hail starts slow and speeds up.
  const drops = [hail];
  stepDrops(drops, 0.1, 0);
  const early = -hail.vy;
  stepDrops(drops, 0.5, 0);
  assert.ok(-hail.vy > early);
});

test('snow drifts with the wind and clumps into wider flakes', () => {
  const a = makeDrop('snow', 10, 10);
  const b = makeDrop('snow', 10.2, 10.05);
  const drops = [a, b];
  stepDrops(drops, DT, 3);
  assert.equal(drops.filter((d) => !d.dead).length, 1);
  const clump = drops.find((d) => !d.dead)!;
  assert.ok(near(clump.r, Math.hypot(0.2, 0.2), 1e-6), 'area is kept');
  for (let i = 0; i < 120; i++) stepDrops(drops, DT, 3);
  assert.ok(clump.vx > 1, 'drifts downwind');
  assert.ok(damageOf(clump) > PROFILES.snow.damage);
});

test('the weather system brings all four precipitation types', () => {
  const w = new WeatherSystem(3);
  const seen = new Map<DropKind, number>();
  const drops: Drop[] = [];
  for (let wave = 1; wave <= 4; wave++) {
    assert.equal(w.wave, wave);
    assert.deepEqual(seasonOf(wave).kinds.length, 1);
    while (w.wave === wave) {
      w.update(DT, drops, 15);
      stepDrops(drops, DT, w.wind);
    }
    for (const d of drops) seen.set(d.kind, (seen.get(d.kind) ?? 0) + 1);
  }
  for (const k of ['drizzle', 'rain', 'snow', 'hail'] as const) assert.ok((seen.get(k) ?? 0) > 0, `no ${k}`);
});

test('the level curve: 49 steps up, each one longer', () => {
  for (let l = 1; l < 49; l++) assert.ok(expToNext(l + 1) > expToNext(l));
  const lm = new LevelManager();
  const reached = lm.add(totalExpFor(10));
  assert.equal(lm.level, 10);
  assert.deepEqual(reached, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  lm.add(10 ** 9);
  assert.equal(lm.level, 50);
  assert.equal(lm.progress, 1);
});

test('stance trade-offs at levels 10, 20, 30, 40 and 50', () => {
  const s1 = stanceFor(1);
  assert.deepEqual([s1.arcMul, s1.speedMul, s1.cooldown, s1.dashCostMul, s1.tier], [1, 1, 0.35, 1, 1]);
  const s10 = stanceFor(10);
  assert.ok(s10.dual && near(s10.arcMul, 1.35) && near(s10.speedMul, 0.9));
  assert.ok(stanceFor(20).aura);
  assert.ok(near(stanceFor(30).cooldown, 0.4375));
  const s40 = stanceFor(40);
  assert.ok(s40.triple && near(s40.speedMul, 0.8) && s40.dashCostMul === 2);
  assert.ok(stanceFor(50).focus && stanceFor(50).tier === 5);
  // A stance can be set aside, and its cost goes with it.
  assert.ok(near(stanceFor(40, new Set(['dual'])).speedMul, 0.9));
});

test('dual wield widens the arc and slows the run', () => {
  const k = new Katana();
  const w1 = k.arcs(10, stanceFor(1))[0];
  const w10 = k.arcs(10, stanceFor(10))[0];
  assert.ok(near((w10.x1 - 10) / (w1.x1 - 10), 1.35));
  const n = new Ninja();
  for (let i = 0; i < 120; i++) n.update(DT, 1, false, stanceFor(10));
  assert.ok(near(n.vx, MAX_SPEED * 0.9));
});

test('spirit armor soaks light water, and hail shatters it', () => {
  const s = stanceFor(20);
  assert.ok(near(incomingDamage('rain', 4, s, { shieldUp: true, vulnerable: 0 }).damage, 0.8));
  assert.ok(near(incomingDamage('drizzle', 0.6, s, { shieldUp: true, vulnerable: 0 }).damage, 0.12));
  const g = quietGame(20);
  g.spawn('hail', g.ninja.x, 1, 0.45);
  g.step(DT, NO_INPUT);
  assert.equal(g.shieldUp, false);
  assert.ok(near(g.dryness, 75, 1e-6));
  assert.ok(g.ninja.stun > 0, 'hail stuns');
  g.spawn('rain', g.ninja.x, 0.6);
  g.step(DT, NO_INPUT);
  assert.ok(near(g.dryness, 75 - 7.5, 1e-6), 'unshielded and vulnerable: 5 x 1.5');
  stepN(g, 3 * 120);
  assert.equal(g.vulnerable, 0, 'vulnerability lasts 3 seconds');
});

test('flame edge steams away nearby drops; triple blade cuts both ways', () => {
  const g = quietGame(30);
  const x = g.ninja.x;
  const target = g.spawn('rain', x + 1, 2);
  const neighbour = g.spawn('drizzle', x + 2.65, 2);
  for (const d of [target, neighbour]) d.vy = 0;
  g.step(DT, { ...NO_INPUT, slashPressed: true });
  stepN(g, 6);
  assert.equal(target.dead, true);
  assert.equal(neighbour.dead, true, 'out of reach of the blade, but not of the steam');

  const t = quietGame(40);
  const left = t.spawn('rain', t.ninja.x - 1.5, 2);
  const right = t.spawn('rain', t.ninja.x + 1.5, 2);
  left.vy = right.vy = 0;
  t.step(DT, { ...NO_INPUT, slashPressed: true });
  stepN(t, 6);
  assert.equal(left.dead && right.dead, true);
});

test('focus cut clears the sky once every 45 seconds', () => {
  const g = quietGame(50);
  for (let i = 0; i < 10; i++) g.spawn('rain', 2 + i * 2, 10);
  g.spawn('hail', 20, 12, 0.6);
  g.step(DT, { ...NO_INPUT, focusPressed: true });
  assert.equal(g.drops.length, 0);
  g.spawn('rain', 3, 10);
  g.step(DT, { ...NO_INPUT, focusPressed: true });
  assert.equal(g.drops.length, 1, 'still recharging');
  assert.equal(quietGame(49).focusReady, false, 'needs level 50');
});

test('levelling up mid-run applies the new stance at once', () => {
  const g = quietGame(9);
  g.levels.exp = expToNext(9) - 1;
  const d = g.spawn('rain', g.ninja.x + 1, 2);
  d.vy = 0;
  g.step(DT, { ...NO_INPUT, slashPressed: true });
  stepN(g, 6);
  assert.equal(g.levels.level, 10);
  assert.equal(g.stance.dual, true);
  assert.ok(g.events.some((e) => e.type === 'levelup' && e.perk === 'Dual-Wield Stance'));
});

test('an idle ninja is worn down and the run ends', () => {
  const g = new Game();
  g.start(11);
  for (let i = 0; i < 120 * 600 && g.phase === 'playing'; i++) g.step(DT, NO_INPUT);
  assert.equal(g.phase, 'over');
  assert.ok(g.stats.time > 20, `lasted ${g.stats.time.toFixed(1)}s`);
});
