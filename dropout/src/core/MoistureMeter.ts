import type { Surface } from '../player/FloorInteraction.ts';

/** Seconds without a hit before a dry tile starts drying the player out. */
const DRY_DELAY = 1;
const DRY_RATE = 10;
/** Going unhit for a while dries the player slowly anywhere but on soap. */
const AIR_DRY_DELAY = 3;
const AIR_DRY_RATE = 1.5;

/** Health for a character made of soap: 0 is bone dry, 100 means dissolved. */
export class MoistureMeter {
  value = 0;
  sinceHit = Infinity;

  reset(): void {
    this.value = 0;
    this.sinceHit = Infinity;
  }

  /** Adds moisture from a hit. Pass `quiet` for costs that should not stop drying. */
  add(amount: number, quiet = false): void {
    this.value = Math.min(100, this.value + amount);
    if (!quiet) this.sinceHit = 0;
  }

  update(dt: number, surface: Surface, humidity: number): void {
    this.sinceHit += dt;
    let rate = humidity;
    if (surface === 'dry' && this.sinceHit >= DRY_DELAY) rate -= DRY_RATE;
    else if (surface !== 'soapy' && this.sinceHit >= AIR_DRY_DELAY) rate -= AIR_DRY_RATE;
    this.value = Math.max(0, Math.min(100, this.value + rate * dt));
  }

  get dissolved(): boolean {
    return this.value >= 100;
  }
}
