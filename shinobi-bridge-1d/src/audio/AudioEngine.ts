import type { Game, GameEvent } from '../core/Game.ts';

/**
 * STUB (to be replaced): synthesized Web Audio. Storm bed (rain, wind, mist), thunder after each
 * lightning flash, bridge creaks from sway, the blade, hail, splintering wood, steam, kicks.
 * Master volume 0.35. Starts only after a user gesture.
 */
export class AudioEngine {
  muted = false;
  start(): void {}
  suspend(_on: boolean): void {}
  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
  update(_dt: number, _game: Game): void {}
  handleEvent(_e: GameEvent, _game: Game): void {}
}
