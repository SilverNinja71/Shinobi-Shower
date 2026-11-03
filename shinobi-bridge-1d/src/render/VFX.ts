import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from './RenderContext.ts';

/**
 * STUB (to be replaced): one-shot effects driven by game events: ice shards, wood shrapnel, steam,
 * sparks and embers, kicked snow, cut-water spray.
 */
export class VFX implements RenderModule {
  constructor(_ctx: RenderContext) {}
  update(_dt: number, _game: Game): void {}
  handleEvent(_e: GameEvent, _game: Game): void {}
}
