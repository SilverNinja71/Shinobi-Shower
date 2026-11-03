const SLOW_SCALE = 0.2;
const LERP_RATE = 14;
const HOLD_DELAY = 0.12;
const MAX_FOCUS = 1.6;
const RECHARGE = 0.5;

/** Time dilation while slash is held in mid-air. Runs on real time, not game time. */
export class BladeTime {
  scale = 1;
  focus = MAX_FOCUS;
  private held = 0;

  get active(): boolean {
    return this.scale < 0.6;
  }

  get fraction(): number {
    return this.focus / MAX_FOCUS;
  }

  reset(): void {
    this.scale = 1;
    this.focus = MAX_FOCUS;
    this.held = 0;
  }

  update(realDt: number, slashHeld: boolean, airborne: boolean): void {
    this.held = slashHeld ? this.held + realDt : 0;
    const wanting = slashHeld && airborne && this.held >= HOLD_DELAY && this.focus > 0;
    if (wanting) this.focus = Math.max(0, this.focus - realDt);
    else if (!slashHeld) this.focus = Math.min(MAX_FOCUS, this.focus + RECHARGE * realDt);
    const target = wanting ? SLOW_SCALE : 1;
    this.scale += (target - this.scale) * (1 - Math.exp(-LERP_RATE * realDt));
  }
}
