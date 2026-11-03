import type { Game, GameEvent } from '../../core/Game.ts';
import { worldX } from '../../render/RenderContext.ts';
import { MARK, snowSurface } from './StormMarks.ts';
import type { StormMarks } from './StormMarks.ts';

type LandEvent = Extract<GameEvent, { type: 'land' }>;

const RIPPLE_LIFE = 0.55;
const CROWN_LIFE = 0.3;
const PUFF_LIFE = 0.5;

/**
 * Where drops land: rain throws a tiny crown of droplets and spreads a ripple ring on the planks (or
 * pocks the snow), snow lands in a small puff, mist settles silently. A fixed ring buffer of
 * short-lived splashes, drawn through StormMarks and kept on the swaying deck every frame.
 */
export class Splashes {
  private readonly capacity: number;
  private readonly type: Uint8Array;
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly power: Float32Array;
  private readonly seed: Float32Array;
  private head = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.type = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.power = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
  }

  private add(type: number, x: number, z: number, life: number, size: number, power: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.type[i] = type;
    this.x[i] = x;
    this.z[i] = z;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.power[i] = power;
    this.seed[i] = Math.random();
  }

  land(e: LandEvent): void {
    if (e.kind === 'rain') {
      // Snow swallows most of the splash: a smaller crown, a faint pock.
      const soft = e.onSnow ? 0.55 : 1;
      this.add(MARK.CROWN, e.x, e.z, CROWN_LIFE, 0.13 * soft, soft);
      this.add(MARK.RIPPLE, e.x, e.z, RIPPLE_LIFE * soft, 0.26 * soft, e.onSnow ? 0.35 : 1);
    } else if (e.kind === 'snow') {
      this.add(MARK.PUFF, e.x, e.z, PUFF_LIFE * (0.8 + e.r), 0.12 + e.r * 0.9, 1);
    }
  }

  update(dt: number, game: Game, marks: StormMarks): void {
    const b = game.bridge;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        continue;
      }
      const x = this.x[i];
      const z = this.z[i];
      const surface = snowSurface(game, x, z);
      const s = this.size[i];
      switch (this.type[i]) {
        case MARK.RIPPLE:
          marks.onDeck(game, MARK.RIPPLE, x, z, surface + 0.02, s, s, t, this.power[i]);
          break;
        case MARK.CROWN:
          marks.upright(MARK.CROWN, worldX(x), b.deckY(x) + surface, b.lateral(x) + z, s, s * 1.2, true, t, this.power[i], this.seed[i]);
          break;
        default:
          marks.upright(MARK.PUFF, worldX(x), b.deckY(x) + surface - 0.03, b.lateral(x) + z, s, s, true, t, this.power[i], this.seed[i]);
          break;
      }
    }
  }
}
