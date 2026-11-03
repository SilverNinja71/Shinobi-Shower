import type { Game } from '../core/Game.ts';
import type { RenderContext, RenderModule } from './RenderContext.ts';

/**
 * STUB (to be replaced): renders the frame. The real module runs an EffectComposer with bloom and
 * a lens pass (fogged, rain-streaked lens from mist; vignette; lightning exposure). It must be the
 * last module updated each frame, since its update draws the picture.
 */
export class PostFX implements RenderModule {
  private readonly ctx: RenderContext;
  constructor(ctx: RenderContext) {
    this.ctx = ctx;
  }
  resize(_width: number, _height: number, _pixelRatio: number): void {}
  update(_dt: number, _game: Game): void {
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  }
}
