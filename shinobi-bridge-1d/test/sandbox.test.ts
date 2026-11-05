import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/Game.ts';
import { isSandboxUnlocked } from '../src/core/Save.ts';
import type { SaveData } from '../src/core/Save.ts';

test('Sandbox is locked at 100 deaths or fewer, and unlocks at 101+ deaths', () => {
  const saveUnder: SaveData = { level: 1, exp: 0, disabled: [], bestWave: 0, bestTime: 0, deaths: 100 };
  assert.equal(isSandboxUnlocked(saveUnder), false, '100 deaths should NOT unlock sandbox');

  const saveUnlocked: SaveData = { level: 1, exp: 0, disabled: [], bestWave: 0, bestTime: 0, deaths: 101 };
  assert.equal(isSandboxUnlocked(saveUnlocked), true, '101 deaths MUST unlock sandbox');

  const saveExplicit: SaveData = { level: 1, exp: 0, disabled: [], bestWave: 0, bestTime: 0, deaths: 5, sandboxUnlocked: true };
  assert.equal(isSandboxUnlocked(saveExplicit), true, 'explicit flag unlocks sandbox');
});

test('God Mode prevents warrior from taking dryness damage and dying', () => {
  const game = new Game();
  game.start(123);
  game.sandbox.active = true;
  game.sandbox.godMode = true;

  // Simulate damage delta
  game.dryness = 5;
  game.step(0.016, { moveX: 0, dashPressed: false, slashPressed: false, kickPressed: false, focusPressed: false });

  assert.equal(game.dryness, 100, 'God mode instantly restores and locks dryness to 100%');
  assert.equal(game.phase, 'playing', 'Warrior does not die in God mode');
});

test('Infinite Stamina maintains maximum dash energy', () => {
  const game = new Game();
  game.start(123);
  game.sandbox.active = true;
  game.sandbox.infiniteStamina = true;

  // Execute a dash
  game.step(0.016, { moveX: 1, dashPressed: true, slashPressed: false, kickPressed: false, focusPressed: false });
  assert.equal(game.warrior.stamina, 100, 'Stamina is held at 100 during infinite stamina sandbox');
});

test('Rapid Katana clamps blade cooldown to 0.05s', () => {
  const game = new Game();
  game.start(123);
  game.sandbox.active = true;
  game.sandbox.rapidSlash = true;

  game.step(0.016, { moveX: 0, dashPressed: false, slashPressed: true, kickPressed: false, focusPressed: false });
  // Normal cooldown is 0.4s
  game.step(0.016, { moveX: 0, dashPressed: false, slashPressed: false, kickPressed: false, focusPressed: false });
  assert.ok(game.katana.cooldown <= 0.05, `Cooldown was clamped to ${game.katana.cooldown}`);
});

test('Sandbox bridge repair and snow manipulation', () => {
  const game = new Game();
  game.start(123);

  // Break planks and add snow
  game.breakRandomPlanks(8);
  const brokenCount = game.bridge.planks.filter((p) => p.broken).length;
  assert.ok(brokenCount > 0, 'Planks were broken');

  game.repairBridge();
  const brokenAfterRepair = game.bridge.planks.filter((p) => p.broken).length;
  assert.equal(brokenAfterRepair, 0, 'All planks restored to 0 broken');
  assert.ok(game.bridge.planks.every((p) => p.health === 4), 'All planks restored to full 4 health');

  game.fillSnow(0.5);
  assert.ok(game.snow.depth.every((d) => d === 0.5), 'Snow filled to 0.5m');

  game.clearSnow();
  assert.ok(game.snow.depth.every((d) => d === 0), 'Snow cleared to 0');
});

test('Sandbox wave and celestial warping', () => {
  const game = new Game();
  game.start(123);

  game.jumpWave(42);
  assert.equal(game.waves.wave, 42, 'Wave jumped to 42');

  game.warpToCelestial();
  assert.equal(game.phase, 'celestial', 'Phase transitioned to celestial');
  assert.equal(game.celestial.active, true, 'Celestial battle is active');

  const imp = game.spawnDemon('imp');
  assert.equal(imp.kind, 'imp');
  assert.equal(game.celestial.demons.length, 1);

  const angel = game.spawnAngel();
  assert.ok(angel.id > 0);
  assert.equal(game.celestial.angels.length, 1);

  game.warpToPeak();
  assert.equal(game.phase, 'playing', 'Phase transitioned back to playing on peak bridge');
  assert.equal(game.celestial.active, false, 'Celestial battle deactivated');
});
