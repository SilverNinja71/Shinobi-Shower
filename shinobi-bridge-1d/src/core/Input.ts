import type { FrameInput } from './Game.ts';

const LEFT = ['KeyA', 'ArrowLeft', 'touch-left'];
const RIGHT = ['KeyD', 'ArrowRight', 'touch-right'];

/**
 * Keyboard, mouse and touch, turned into one FrameInput per simulation frame. Presses are latched
 * until the next sample so a tap shorter than a frame still counts.
 */
export class Input {
  enabled = false;
  onPause: () => void = () => {};
  onMute: () => void = () => {};
  private readonly held = new Set<string>();
  private readonly pressed = { dash: false, slash: false, kick: false, focus: false };

  constructor(stage: HTMLElement) {
    addEventListener('keydown', (e) => this.keyDown(e));
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());
    stage.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.button === 0) this.press('slash');
      else if (e.button === 2) this.press('dash');
    });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private press(action: keyof Input['pressed']): void {
    if (this.enabled) this.pressed[action] = true;
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.code === 'KeyM') this.onMute();
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onPause();
      return;
    }
    if (!this.enabled) return;
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.held.add(e.code);
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.press('dash');
    if (e.code === 'KeyJ' || e.code === 'KeyK') this.press('slash');
    if (e.code === 'KeyS' || e.code === 'ArrowDown' || e.code === 'KeyL') this.press('kick');
    if (e.code === 'KeyF') this.press('focus');
  }

  /** Wires on-screen buttons: each `[data-key]` of left, right, dash, slash, kick, focus or pause. */
  bindTouch(root: HTMLElement): void {
    for (const b of root.querySelectorAll<HTMLElement>('[data-key]')) {
      const key = b.dataset.key!;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        b.classList.add('on');
        if (key === 'pause') this.onPause();
        else if (key === 'left' || key === 'right') this.held.add(`touch-${key}`);
        else if (key === 'dash' || key === 'slash' || key === 'kick' || key === 'focus') this.press(key);
      };
      const up = () => {
        b.classList.remove('on');
        this.held.delete(`touch-${key}`);
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  }

  clear(): void {
    this.held.clear();
    this.pressed.dash = this.pressed.slash = this.pressed.kick = this.pressed.focus = false;
  }

  sample(): FrameInput {
    const right = RIGHT.some((k) => this.held.has(k)) ? 1 : 0;
    const left = LEFT.some((k) => this.held.has(k)) ? 1 : 0;
    const out: FrameInput = {
      moveX: right - left,
      dashPressed: this.pressed.dash,
      slashPressed: this.pressed.slash,
      kickPressed: this.pressed.kick,
      focusPressed: this.pressed.focus,
    };
    this.pressed.dash = this.pressed.slash = this.pressed.kick = this.pressed.focus = false;
    return out;
  }
}
