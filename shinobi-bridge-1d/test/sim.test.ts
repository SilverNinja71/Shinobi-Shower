import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, NO_INPUT } from '../src/core/Game.ts';
import type { FrameInput } from '../src/core/Game.ts';
import { LevelManager, expToNext, totalExpFor } from '../src/progression/LevelManager.ts';
import { BASE_COOLDOWN, EXPOSED_DAMAGE, FLAME_COOLDOWN, incomingDamage, stanceFor, tierFor } from '../src/progression/StanceModifiers.ts';
import { WaveDirector, planWave, waveDuration } from '../src/progression/WaveDirector.ts';
import { SNOW_MAX_SLOW, SNOW_SLOW_DEPTH, SnowAccumulator } from '../src/scene/SnowAccumulator.ts';
import { BRIDGE_LENGTH, PLANK_HEALTH, SuspensionBridge } from '../src/scene/SuspensionBridge.ts';
import { DynamicStormSystem, RAIN_MAX_ANGLE, RAIN_MIN_ANGLE } from '../src/weather/DynamicStormSystem.ts';
import { damageOf, makeDrop, moveDrops, sweptHits } from '../src/weather/PrecipitationDroplet.ts';
import type { DropKind } from '../src/weather/PrecipitationDroplet.ts';
import { ACTIVE, KatanaSlash, STARTUP, SWEET_HALF_WIDTH } from '../src/warrior/KatanaSlash.ts';
import { MAX_SPEED } from '../src/warrior/WarriorController.ts';

const DT = 1 / 120;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const press = (p: Partial<FrameInput>): FrameInput => ({ ...NO_INPUT, ...p });

/** A running game with the weather switched off, so each test places its own drops. */
function calm(level = 1): Game {
  const g = new Game(level);
  g.start(7);
  g.waves.update = () => {};
  g.storm.update = () => {};
  return g;
}

function stepN(g: Game, n: number, input = NO_INPUT) {
  for (let i = 0; i < n; i++) g.step(DT, input);
}

/** Holds a drop still in the air for the duration of a test. */
function hover(g: Game, kind: DropKind, x: number, aboveFeet: number, r?: number) {
  const d = g.spawn(kind, x, g.feetY + aboveFeet, r, 0, 0);
  if (kind === 'hail') d.vy = 0;
  return d;
}

/* ---------------- The blade ---------------- */

test('the katana cooldown is exactly 0.4 seconds', () => {
  const k = new KatanaSlash();
  const s = stanceFor(1);
  k.press();
  assert.equal(k.update(DT, s, 1, true), 'start');
  let steps = 0;
  let r: string | null = null;
  while (r !== 'start' && steps < 400) {
    k.press();
    r = k.update(DT, s, 1, true);
    steps++;
  }
  assert.ok(near(steps * DT, BASE_COOLDOWN), `took ${steps} steps`);
});

test('flame edge slows the blade to 0.55 seconds', () => {
  const k = new KatanaSlash();
  const s = stanceFor(30);
  assert.equal(s.cooldown, FLAME_COOLDOWN);
  k.press();
  k.update(DT, s, 1, true);
  let steps = 0;
  do {
    k.press();
    steps++;
  } while (k.update(DT, s, 1, true) !== 'start');
  assert.ok(near(steps * DT, 0.55, DT), `took ${steps} steps`);
});

test('a slash cuts rain in front, not behind, and its wake keeps cutting', () => {
  const g = calm();
  const x = g.warrior.x;
  const front = hover(g, 'rain', x + 1.2, 2);
  const back = hover(g, 'rain', x - 1.2, 2);
  g.step(DT, press({ slashPressed: true }));
  stepN(g, Math.ceil((STARTUP + ACTIVE) / DT) + 2);
  assert.equal(front.dead, true);
  assert.equal(back.dead, false);
  // Now inside the wake: a fresh drop drifting into the arc is still cut.
  assert.equal(g.katana.phase, 'wake');
  const late = hover(g, 'rain', x + 1.5, 2.2);
  g.step(DT, NO_INPUT);
  assert.equal(late.dead, true, 'the wake cut it');
  assert.equal(g.events.filter((e) => e.type === 'cut' && e.wake).length >= 1, true);
});

test('fast diagonal rain cannot tunnel through the arc or the body', () => {
  const g = calm();
  const x = g.warrior.x;
  const feet = g.feetY;
  // A drop moving 0.6 m per step, crossing the warrior between two steps.
  const d = g.spawn('rain', x - 0.5, feet + 1.0, undefined, 70, -10);
  g.step(DT, NO_INPUT);
  assert.equal(d.dead, true);
  assert.ok(g.dryness < 100, 'it hit');
  const box = makeDrop('rain', 0, 5, 0, 0);
  box.px = -2;
  box.py = 5;
  box.x = 2;
  assert.equal(sweptHits(box, -0.1, 0.1, 4.9, 5.1), true);
});

test('hail only breaks at the sweet spot; off-centre it glances', () => {
  const g = calm();
  const sweet = g.katana.arcs(g.warrior.x, g.feetY, g.stance, 1)[0].sweet;
  const centred = hover(g, 'hail', sweet, 1.9, 0.5);
  g.step(DT, press({ slashPressed: true }));
  stepN(g, 14);
  assert.equal(centred.dead, true);
  assert.equal(g.stats.perfect, 1);

  const g2 = calm();
  const sweet2 = g2.katana.arcs(g2.warrior.x, g2.feetY, g2.stance, 1)[0].sweet;
  const off = hover(g2, 'hail', sweet2 + SWEET_HALF_WIDTH + 0.5, 1.9, 0.5);
  g2.step(DT, press({ slashPressed: true }));
  stepN(g2, 14);
  assert.equal(off.dead, false);
  assert.ok(off.vx > 0, 'knocked away');
  assert.ok(g2.events.some((e) => e.type === 'clang'));
});

test('a missed slash leaves the warrior exposed through recovery: more damage, no dash', () => {
  const g = calm();
  g.step(DT, press({ slashPressed: true }));
  stepN(g, Math.ceil((STARTUP + ACTIVE) / DT) + 1);
  assert.ok(g.events.some((e) => e.type === 'whiff'));
  assert.equal(g.exposed, true);
  g.step(DT, press({ dashPressed: true }));
  assert.equal(g.warrior.rolling, false, 'cannot dash while exposed');
  // Past the wake, still recovering: a drop now lands on an exposed warrior.
  while (g.katana.phase !== 'recovery') g.step(DT, NO_INPUT);
  assert.equal(g.exposed, true);
  const before = g.dryness;
  g.spawn('rain', g.warrior.x, g.feetY + 1, undefined, 0, -1);
  g.step(DT, NO_INPUT);
  assert.ok(near(before - g.dryness, 1.2 * EXPOSED_DAMAGE, 1e-9), `took ${before - g.dryness}`);
  stepN(g, 60);
  assert.equal(g.exposed, false, 'clears when the blade is ready');
});

/* ---------------- Weather ---------------- */

test('rain falls diagonally at 35–60 degrees and over 30 m/s, slanting with the wind', () => {
  const storm = new DynamicStormSystem(3, BRIDGE_LENGTH);
  const weights = { drizzle: 0, rain: 1, snow: 0, hail: 0 };
  let sawLeft = false;
  let sawRight = false;
  for (let i = 0; i < 120 * 90; i++) {
    storm.update(DT, weights, 1, 18);
    assert.ok(storm.rainAngle >= RAIN_MIN_ANGLE - 1e-9 && storm.rainAngle <= RAIN_MAX_ANGLE + 1e-9);
    const { vx, vy } = storm.rainVelocity();
    assert.ok(Math.hypot(vx, vy) >= 30);
    if (vx < 0) sawLeft = true;
    if (vx > 0) sawRight = true;
    if (Math.abs(storm.wind) > 1) assert.equal(Math.sign(vx), Math.sign(storm.wind));
  }
  assert.ok(sawLeft && sawRight, 'the crosswind swings both ways');
  const rain = storm.drops.filter((d) => d.kind === 'rain');
  const angles = rain.slice(0, 200).map((d) => Math.atan2(Math.abs(d.vx), -d.vy));
  assert.ok(angles.every((a) => a > (30 * Math.PI) / 180 && a < (65 * Math.PI) / 180));
});

test('curtains are dense sweeping sheets compared with the steady fall', () => {
  const storm = new DynamicStormSystem(5, BRIDGE_LENGTH);
  const weights = { drizzle: 0, rain: 1, snow: 0, hail: 0 };
  let inside = 0;
  let outside = 0;
  let curtainMetres = 0;
  for (let i = 0; i < 120 * 60; i++) {
    const before = storm.drops.length;
    storm.update(DT, weights, 1, 18);
    const { vx, vy } = storm.rainVelocity();
    for (const d of storm.drops.slice(before)) {
      const land = d.x + vx * (15 / -vy);
      if (storm.curtains.some((c) => Math.abs(land - c.center) < c.width / 2 + 0.5)) inside++;
      else outside++;
    }
    curtainMetres += storm.curtains.reduce((s, c) => s + c.width, 0) * DT;
    storm.drops.length = 0;
  }
  assert.ok(storm.curtains.length >= 0);
  const insideDensity = inside / Math.max(1, curtainMetres);
  const outsideDensity = outside / (BRIDGE_LENGTH * 60 - curtainMetres);
  assert.ok(insideDensity > outsideDensity * 8, `curtain ${insideDensity.toFixed(2)} vs ${outsideDensity.toFixed(2)} per m·s`);
});

test('snow drifts with the wind and clumps into wider flakes', () => {
  const a = makeDrop('snow', 10, 10, 0, -2.5, 0.15);
  const b = makeDrop('snow', 10.15, 10.05, 0, -2.5, 0.15);
  const g = calm();
  g.storm.drops.push(a, b);
  g.storm.wind = 3;
  g.step(DT, NO_INPUT);
  const alive = g.drops.filter((d) => d.kind === 'snow');
  assert.equal(alive.length, 1);
  assert.ok(near(alive[0].r, Math.hypot(0.15, 0.15), 1e-6), 'area is kept');
  const drift = [makeDrop('snow', 5, 10, 0, -2.5)];
  for (let i = 0; i < 240; i++) moveDrops(drift, DT, 3);
  assert.ok(drift[0].vx > 1.5);
});

test('landing snow builds a drift that slows the warrior to half speed at most', () => {
  const g = calm();
  const x = g.warrior.x + 4;
  // Snow falling over a two-metre stretch.
  for (let i = 0; i < 2000 && g.snow.depthAt(x + 1) < SNOW_SLOW_DEPTH + 0.05; i++) {
    const at = x + (i % 14) * 0.15;
    g.spawn('snow', at, g.bridge.deckY(at) + 0.5, 0.18, 0, -3);
    stepN(g, 25);
  }
  assert.ok(g.snow.depthAt(x + 1) >= SNOW_SLOW_DEPTH, `depth ${g.snow.depthAt(x + 1).toFixed(2)}`);
  assert.ok(near(g.snow.slowAt(x + 1), 1 - SNOW_MAX_SLOW, 1e-6));
  // Run into the drift: by its middle the stride is down to half.
  g.warrior.x = x - 2;
  g.warrior.vx = 0;
  let speed = 0;
  for (let i = 0; i < 400 && g.warrior.x < x + 1; i++) {
    g.step(DT, press({ moveX: 1 }));
    speed = g.warrior.vx;
  }
  assert.ok(speed > 0 && speed <= MAX_SPEED * 0.5 * 1.16, `speed in drift ${speed.toFixed(2)}`);
});

test('a kick throws snow off the deck in front; a flaming cut vaporizes the drift', () => {
  const g = calm();
  const x = g.warrior.x;
  for (let i = 0; i < 40; i++) g.snow.deposit(x + 0.8, 0.05);
  const before = g.snow.depthAt(x + 0.8);
  assert.ok(before > 0.3);
  g.step(DT, press({ kickPressed: true }));
  assert.ok(g.snow.depthAt(x + 0.8) < before - 0.3 + 1e-6, 'a kick digs up to 0.35 m');
  assert.ok(g.events.some((e) => e.type === 'kick' && e.area > 0));

  const f = calm(30);
  for (let i = 0; i < 40; i++) f.snow.deposit(f.warrior.x + 1, 0.05);
  f.step(DT, press({ slashPressed: true }));
  assert.equal(f.snow.depthAt(f.warrior.x + 1), 0);
  assert.ok(f.events.some((e) => e.type === 'melt'));
  // Without the burning edge, a slash leaves the snow alone.
  const n = calm(20);
  for (let i = 0; i < 40; i++) n.snow.deposit(n.warrior.x + 1, 0.05);
  n.step(DT, press({ slashPressed: true }));
  assert.ok(n.snow.depthAt(n.warrior.x + 1) > 0.3);
});

test('drifts slump into mounds and snow cannot rest over a hole', () => {
  const s = new SnowAccumulator(10);
  for (let i = 0; i < 60; i++) s.deposit(5, 0.05);
  const peak = s.depthAt(5);
  for (let i = 0; i < 600; i++) s.update(DT, 0);
  assert.ok(s.depthAt(5) < peak, 'the peak slumps');
  assert.ok(s.depthAt(5.6) > 0, 'into a wider mound');
  const lost = s.setOpen(4.8, 5.2, true);
  assert.ok(lost > 0);
  s.deposit(5, 0.05);
  assert.equal(s.depthAt(5), 0);
});

test('hail cracks planks, breaks them, and a missing plank trips the warrior unless they roll', () => {
  const g = calm();
  const x = g.warrior.x + 3;
  for (let i = 0; i < PLANK_HEALTH; i++) {
    g.spawn('hail', x, g.bridge.deckY(x) + 0.8, 0.5, 0, -10);
    stepN(g, 20);
  }
  const plank = g.bridge.plankAt(x)!;
  assert.equal(plank.broken, true);
  const kinds = g.events.filter((e) => e.type === 'plank').map((e) => (e as { damage: string }).damage);
  assert.deepEqual(kinds, ['crack', 'crack', 'crack', 'break']);
  // Walk onto the hole: a stumble.
  let stumbled = false;
  for (let i = 0; i < 120 && !stumbled; i++) {
    g.step(DT, press({ moveX: 1 }));
    stumbled = g.events.some((e) => e.type === 'stumble');
  }
  assert.ok(stumbled);
  // Roll across a hole instead: no stumble.
  const r = calm();
  const hole = r.warrior.x + 2;
  r.bridge.damagePlank(r.bridge.plankIndex(hole), 99);
  r.step(DT, press({ moveX: 1, dashPressed: true }));
  stepN(r, 30, press({ moveX: 1 }));
  assert.ok(r.warrior.x > hole + 0.5);
  assert.equal(r.events.some((e) => e.type === 'stumble'), false);
});

test('a hailstone landing on the deck sets the bridge swaying, and the sway dies away', () => {
  const b = new SuspensionBridge();
  b.impulse(BRIDGE_LENGTH / 2, 0.4);
  let peak = 0;
  for (let i = 0; i < 120 * 2; i++) {
    b.update(DT, 0, null);
    peak = Math.max(peak, Math.abs(b.deckY(18) - b.restY(18)));
  }
  assert.ok(peak > 0.05, `peak sway ${peak.toFixed(3)} m`);
  for (let i = 0; i < 120 * 20; i++) b.update(DT, 0, null);
  assert.ok(Math.abs(b.deckY(18) - b.restY(18)) < peak * 0.15, 'damped');
});

test('the warrior weighs the deck down, and dashing rocks it', () => {
  const b = new SuspensionBridge();
  for (let i = 0; i < 120 * 30; i++) b.update(DT, 0, 18);
  const dip = b.restY(18) - b.deckY(18);
  assert.ok(dip > 0.1 && dip < 0.3, `dip ${dip.toFixed(3)}`);
  const g = calm();
  const e0 = g.bridge.energy;
  g.step(DT, press({ dashPressed: true, moveX: 1 }));
  stepN(g, 10);
  assert.ok(g.bridge.energy > e0);
});

test('the deck pitch slows running uphill and speeds it downhill', () => {
  const speedAt = (x: number, dir: number) => {
    const g = calm();
    g.warrior.x = x;
    for (let i = 0; i < 60; i++) {
      g.warrior.x = x;
      g.step(DT, press({ moveX: dir }));
    }
    return g.warrior.topSpeed;
  };
  // West half of the sag: heading east is downhill, heading west is uphill.
  const down = speedAt(6, 1);
  const up = speedAt(6, -1);
  assert.ok(down > MAX_SPEED && up < MAX_SPEED * 0.95, `down ${down.toFixed(2)}, up ${up.toFixed(2)}`);
});

test('wave durations: 30 s, 90 s at 10, 180 s at 25, 300 s at 50, never shorter', () => {
  assert.equal(waveDuration(1), 30);
  assert.equal(waveDuration(10), 90);
  assert.equal(waveDuration(25), 180);
  assert.equal(waveDuration(50), 300);
  assert.equal(waveDuration(80), 300);
  for (let w = 1; w < 60; w++) assert.ok(waveDuration(w + 1) >= waveDuration(w));
});

test('early waves teach one hazard; from 50 rain and hail never stop', () => {
  for (let w = 1; w <= 4; w++) assert.equal(planWave(w, 1)[0].kinds.length, 1);
  const d = new WaveDirector(9);
  d.wave = 50;
  d.duration = waveDuration(50);
  d.fronts = planWave(50, 9);
  d.t = 0;
  let fronts = 0;
  for (let t = 0; t < d.duration - 0.1; t += 0.5) {
    d.update(0.5);
    if (d.t < 0) break;
    assert.ok(d.weights.rain > 0 && d.weights.hail > 0, `t=${d.t}`);
    fronts += d.events.filter((e) => e.type === 'front').length;
    d.events.length = 0;
  }
  assert.ok(fronts >= 3, 'the weather keeps changing within a wave');
});

/* ---------------- Stances, levels, tiers ---------------- */

test('stance trade-offs at levels 10, 20, 30, 40 and 50', () => {
  const s1 = stanceFor(1);
  assert.deepEqual([s1.arcMul, s1.speedMul, s1.cooldown, s1.tier], [1, 1, 0.4, 1]);
  const s10 = stanceFor(10);
  assert.ok(s10.dual && near(s10.arcMul, 1.35) && near(s10.speedMul, 0.9));
  const s20 = stanceFor(20);
  assert.ok(near(incomingDamage('rain', 1.2, s20, { shieldUp: true, vulnerable: 0, exposed: false }).damage, 0.24));
  assert.ok(near(incomingDamage('drizzle', 0.45, s20, { shieldUp: true, vulnerable: 0, exposed: false }).damage, 0.09));
  assert.equal(stanceFor(30).cooldown, 0.55);
  const s40 = stanceFor(40);
  assert.ok(s40.triple && near(s40.speedMul, 0.8));
  assert.ok(stanceFor(50).focus);
  // A stance can be set aside, and its cost goes with it.
  assert.ok(near(stanceFor(40, new Set(['triple'])).speedMul, 0.9));
  assert.equal(stanceFor(40, new Set(['flame'])).cooldown, 0.4);
});

test('cosmetic tiers follow the level bands', () => {
  const expect: [number, number][] = [[1, 1], [9, 1], [10, 2], [19, 2], [20, 3], [29, 3], [30, 4], [39, 4], [40, 5], [50, 5]];
  for (const [lv, tier] of expect) assert.equal(tierFor(lv), tier, `level ${lv}`);
});

test('spirit shield: a hail hit shatters it, 3 s of +50% damage, then it reforms', () => {
  const g = calm(20);
  g.spawn('hail', g.warrior.x, g.feetY + 1, 0.45, 0, -2);
  g.step(DT, NO_INPUT);
  assert.equal(g.shieldUp, false);
  assert.ok(near(g.dryness, 75, 1e-6));
  assert.ok(g.warrior.stun > 0, 'hail stuns');
  g.spawn('rain', g.warrior.x, g.feetY + 1, undefined, 0, -1);
  g.step(DT, NO_INPUT);
  assert.ok(near(g.dryness, 75 - 1.2 * 1.5, 1e-6), 'unshielded and vulnerable');
  stepN(g, 3 * 120);
  assert.equal(g.vulnerable, 0);
  stepN(g, 10 * 120);
  assert.equal(g.shieldUp, true);
});

test('triple blades cut both ways; dual wield reaches 35% further', () => {
  const t = calm(40);
  const left = hover(t, 'rain', t.warrior.x - 1.5, 2);
  const right = hover(t, 'rain', t.warrior.x + 1.5, 2);
  t.step(DT, press({ slashPressed: true }));
  stepN(t, 12);
  assert.equal(left.dead && right.dead, true);
  const k = new KatanaSlash();
  const a1 = k.arcs(10, 0, stanceFor(1), 1)[0];
  const a10 = k.arcs(10, 0, stanceFor(10), 1)[0];
  assert.ok(near((a10.x1 - 10) / (a1.x1 - 10), 1.35));
});

test('flame edge bursts nearby rain into steam', () => {
  const g = calm(30);
  const x = g.warrior.x;
  const target = hover(g, 'rain', x + 1, 2);
  const neighbour = hover(g, 'drizzle', x + 2.7, 2);
  g.step(DT, press({ slashPressed: true }));
  stepN(g, 10);
  assert.equal(target.dead, true);
  assert.equal(neighbour.dead, true, 'beyond the blade, but not the steam');
  assert.ok(g.events.some((e) => e.type === 'steam'));
});

test('focus cut clears the sky once every 45 seconds, from level 50', () => {
  const g = calm(50);
  for (let i = 0; i < 10; i++) g.spawn('rain', 2 + i * 3, 10, undefined, 0, 0);
  g.step(DT, press({ focusPressed: true }));
  assert.equal(g.drops.length, 0);
  g.spawn('rain', 3, 10, undefined, 0, 0);
  g.step(DT, press({ focusPressed: true }));
  assert.equal(g.drops.length, 1, 'recharging');
  assert.equal(calm(49).focusReady, false);
});

test('the level curve and levelling mid-run', () => {
  for (let l = 1; l < 49; l++) assert.ok(expToNext(l + 1) > expToNext(l));
  const lm = new LevelManager();
  assert.deepEqual(lm.add(totalExpFor(10)), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  lm.add(1e9);
  assert.equal(lm.level, 50);
  const g = calm(9);
  g.levels.exp = expToNext(9) - 1;
  hover(g, 'rain', g.warrior.x + 1, 2);
  g.step(DT, press({ slashPressed: true }));
  stepN(g, 10);
  assert.equal(g.levels.level, 10);
  assert.equal(g.stance.dual, true);
  assert.ok(g.events.some((e) => e.type === 'levelup' && e.perk === 'Dual-Wield'));
});

test('a wave clear repairs the bridge and grants mastery', () => {
  const g = new Game();
  g.start(4);
  g.storm.update = () => {};
  g.bridge.damagePlank(10, 99);
  g.waves.t = g.waves.duration - DT / 2;
  g.step(DT, NO_INPUT);
  const clear = g.events.find((e) => e.type === 'clear');
  assert.ok(clear && clear.type === 'clear' && clear.repaired >= 1);
  assert.equal(g.bridge.brokenCount, 0);
  assert.ok(g.stats.exp >= 55);
});

test('an idle warrior is worn down by the weather', () => {
  const g = new Game();
  g.start(11);
  for (let i = 0; i < 120 * 900 && g.phase === 'playing'; i++) g.step(DT, NO_INPUT);
  assert.equal(g.phase, 'over');
  assert.ok(g.stats.time > 25, `lasted ${g.stats.time.toFixed(1)} s`);
});

test('hail damage scales from 25% to 40% with size', () => {
  assert.ok(near(damageOf(makeDrop('hail', 0, 0, 0, 0, 0.45)), 25));
  assert.ok(near(damageOf(makeDrop('hail', 0, 0, 0, 0, 0.75)), 40));
  assert.ok(near(damageOf(makeDrop('hail', 0, 0, 0, 0, 0.9)), 40));
});
