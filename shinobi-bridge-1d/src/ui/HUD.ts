import type { Game, GameEvent } from '../core/Game.ts';

/**
 * STUB (to be replaced): the cinematic letterbox HUD: level badge and mastery, wave and front with
 * time left, robe dryness, shield and vulnerability, blade cooldown, dash stamina, kick, focus cut,
 * snow slow, and toasts for waves, fronts and level-ups.
 */
export class HUD {
  setVisible(_on: boolean): void {}
  update(_game: Game): void {}
  handleEvent(_e: GameEvent, _game: Game): void {}
}
