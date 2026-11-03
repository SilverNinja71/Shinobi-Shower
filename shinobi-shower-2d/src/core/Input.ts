export interface FrameInput {
  moveX: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  slide: boolean;
  dashPressed: boolean;
  wireHeld: boolean;
  slashPressed: boolean;
  slashHeld: boolean;
}

/** Keyboard and mouse. The mouse position stays in screen pixels, and the renderer turns it into a world aim. */
export class Input {
  enabled = false;
  mouseX = innerWidth * 0.75;
  mouseY = innerHeight * 0.4;
  onPause: () => void = () => {};
  onRetry: () => void = () => {};
  onMute: () => void = () => {};

  private readonly keys = new Set<string>();
  private jump = false;
  private dash = false;
  private slash = false;
  private mouseSlash = false;

  constructor() {
    addEventListener('keydown', (e) => this.keyDown(e));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseSlash = false;
    });
    addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.button === 0) {
        this.slash = true;
        this.mouseSlash = true;
      } else if (e.button === 2) {
        this.dash = true;
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseSlash = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.code === 'KeyM') this.onMute();
    if (e.code === 'Escape' || e.code === 'KeyP') this.onPause();
    if (!this.enabled) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') this.jump = true;
    if (e.code === 'KeyQ') this.dash = true;
    if (e.code === 'KeyJ') this.slash = true;
    if (e.code === 'KeyR') this.onRetry();
  }

  clear(): void {
    this.keys.clear();
    this.jump = this.dash = this.slash = this.mouseSlash = false;
  }

  /** Reads this frame's input and consumes the one-shot presses. */
  sample(): FrameInput {
    const k = this.keys;
    const out: FrameInput = {
      moveX: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      jumpPressed: this.jump,
      jumpHeld: k.has('Space') || k.has('KeyW') || k.has('ArrowUp'),
      slide: k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyS') || k.has('ArrowDown'),
      dashPressed: this.dash,
      wireHeld: k.has('KeyE'),
      slashPressed: this.slash,
      slashHeld: this.mouseSlash || k.has('KeyJ'),
    };
    this.jump = this.dash = this.slash = false;
    return out;
  }
}
