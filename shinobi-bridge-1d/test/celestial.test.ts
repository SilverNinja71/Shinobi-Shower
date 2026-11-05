import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/Game.ts';
import { CelestialBattle } from '../src/celestial/CelestialBattle.ts';
import { AtomicCutsceneSim } from '../src/cinematic/AtomicCutsceneSim.ts';
import { WarriorController } from '../src/warrior/WarriorController.ts';
import { KatanaSlash } from '../src/warrior/KatanaSlash.ts';
import { stanceFor } from '../src/progression/StanceModifiers.ts';

test('AtomicCutsceneSim transitions through all dramatic phases and completes', () => {
  const cutscene = new AtomicCutsceneSim();
  cutscene.start(30, 2);
  assert.equal(cutscene.phase, 'freeze');
  assert.equal(cutscene.events[0].type, 'atomic_freeze');

  // Step to atom zoom (1.3s)
  cutscene.update(1.3);
  assert.equal(cutscene.phase, 'atom_zoom');

  // Step to slice (2.9s)
  cutscene.update(1.6);
  assert.equal(cutscene.phase, 'slice');

  // Step to fission (3.9s)
  cutscene.update(1.0);
  assert.equal(cutscene.phase, 'fission');

  // Step to explosion (4.8s)
  cutscene.update(0.9);
  assert.equal(cutscene.phase, 'explosion');

  // Step to ascend (6.3s)
  cutscene.update(1.5);
  assert.equal(cutscene.phase, 'ascend');

  // Step to finish (7.0s)
  const done = cutscene.update(0.8);
  assert.ok(done, 'cutscene completes');
  assert.equal(cutscene.phase, 'done');
});

test('Clearing wave 50 automatically triggers the Atomic Cleave cutscene', () => {
  const game = new Game();
  game.start(42);
  game.waves.wave = 50;
  game.waves.duration = 10;
  game.waves.t = 9.99;

  // Step across the wave duration boundary
  game.step(0.02, { moveX: 0, dashPressed: false, slashPressed: false, kickPressed: false, focusPressed: false });

  assert.equal(game.phase, 'cutscene');
  assert.ok(game.cutscene.active);
  assert.ok(game.events.some((e) => e.type === 'atomic_trigger'));
});

test('Direct call to triggerAtomicCleave initiates the cutscene cleanly', () => {
  const game = new Game();
  game.start(7);
  game.triggerAtomicCleave();
  assert.equal(game.phase, 'cutscene');
  assert.ok(game.cutscene.active);
});

test('Celestial battle: Demons spawn, dive, and can be sliced by katana for points', () => {
  const battle = new CelestialBattle();
  battle.start(0);
  assert.ok(battle.active);

  const demon = battle.spawnDemon('imp', 2.0, 1.0);
  assert.equal(battle.demons.length, 1);
  assert.equal(demon.health, 1);

  const warrior = new WarriorController();
  warrior.x = 1.0;
  warrior.facing = 1;
  const katana = new KatanaSlash();
  const stance = stanceFor(50);

  // Trigger slash: first step starts it, second step advances past STARTUP into active frames
  katana.press();
  katana.update(0.01, stance, 1, true);
  katana.update(0.08, stance, 1, true);
  assert.ok(katana.cutting);

  battle.update(0.05, warrior, katana, stance);

  // Demon should be slain
  assert.equal(battle.stats.demonsSlain, 1);
  assert.ok(battle.stats.score > 0);
  assert.ok(battle.events.some((e) => e.type === 'demon_slain'));
});

test('Celestial battle: Ascending Angels grant Angelic Blessing and Light Blade', () => {
  const battle = new CelestialBattle();
  battle.start(0);

  const angel = battle.spawnAngel(1.0);
  angel.y = 0.5; // Near feet height

  const warrior = new WarriorController();
  warrior.x = 1.0;
  const katana = new KatanaSlash();
  const stance = stanceFor(50);

  let drynessHealed = 0;
  battle.update(0.05, warrior, katana, stance, (delta) => {
    drynessHealed += delta;
  });

  assert.ok(angel.blessed, 'angel blessed warrior');
  assert.equal(battle.stats.angelsBlessed, 1);
  assert.ok(battle.lightBladeActive, 'light blade activated');
  assert.ok(drynessHealed >= 100, 'warrior healed to full');
  assert.ok(battle.events.some((e) => e.type === 'angel_bless'));
});

test('Celestial battle: Striking an Angel cancels Light Blade and inflicts holy blindness penalty', () => {
  const battle = new CelestialBattle();
  battle.start(0);

  const angel = battle.spawnAngel(1.8);
  angel.y = 1.0;

  // Pre-activate light blade
  battle.lightBladeTimer = 10;
  assert.ok(battle.lightBladeActive);

  const warrior = new WarriorController();
  warrior.x = 1.0;
  warrior.facing = 1;
  const katana = new KatanaSlash();
  const stance = stanceFor(50);

  katana.press();
  katana.update(0.01, stance, 1, true);
  katana.update(0.08, stance, 1, true); // Cutting
  assert.ok(katana.cutting);

  battle.update(0.05, warrior, katana, stance);

  assert.equal(battle.stats.angelsStruck, 1);
  assert.equal(battle.lightBladeActive, false, 'light blade cancelled');
  assert.ok(battle.holyBlindnessTimer > 0, 'holy blindness triggered');
  assert.ok(battle.events.some((e) => e.type === 'angel_struck'));
});
