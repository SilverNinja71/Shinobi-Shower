import * as THREE from 'three';
import type { Game } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { Anchors } from './bridge/Anchors.ts';
import { DeckSampler } from './bridge/DeckSampler.ts';
import { DeckSnow } from './bridge/DeckSnow.ts';
import { Planks } from './bridge/Planks.ts';
import { addRopes } from './bridge/Ropes.ts';

/**
 * The rope suspension bridge, following the simulation's sway model (sag, three vertical modes, lateral
 * swing and roll) every frame:
 * - Planks: weathered oak boards, instanced, cracked by hail and tumbling away when they break.
 * - Ropes: hand ropes, deck-edge ropes and suspenders, deformed on the GPU from the deck samples.
 * - Anchors: timber posts the ropes tie off on, and a swinging lantern with a warm light at each end.
 * - Snow: drifts on the deck from the simulation's snow height map.
 * Draw calls: planks 3 (+1 while halves fall), ropes 2, each anchor end in view 2, lanterns 2, snow 1
 * (only with snow on the deck): 13 at most, against a budget of 25. Lights: the two lanterns'.
 */
export class BridgeRenderer implements RenderModule {
  private readonly ctx: RenderContext;
  private readonly group = new THREE.Group();
  private readonly deck = new DeckSampler();
  private readonly planks: Planks;
  private readonly anchors: Anchors;
  private readonly snow: DeckSnow;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.group.name = 'bridge';
    ctx.scene.add(this.group);
    this.planks = new Planks(ctx, this.group);
    this.anchors = new Anchors(ctx, this.group);
    addRopes(ctx, this.group, this.deck);
    this.snow = new DeckSnow(ctx, this.group, this.deck);
  }

  update(dt: number, game: Game): void {
    this.deck.update(game.bridge);
    this.planks.update(game);
    this.anchors.update(dt, game, this.ctx.uniforms.uTime.value);
    this.snow.update(game);
  }
}
