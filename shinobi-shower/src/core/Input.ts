const SENSITIVITY = 0.0022;
const KEY_LOOK_RATE = 2.2;
const MAX_PITCH = 1.5;

export interface FrameInput {
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  jumpPressed: boolean;
  slide: boolean;
  dashPressed: boolean;
  wireHeld: boolean;
  slashPressed: boolean;
  slashHeld: boolean;
}

/** Keyboard and mouse. Pointer lock is used when the browser allows it, and plain mouse movement otherwise. */
export class Input {
  yaw = 0;
  pitch = 0;
  enabled = false;
  onLockLost: () => void = () => {};
  onRetry: () => void = () => {};
  onMute: () => void = () => {};

  private readonly keys = new Set<string>();
  private readonly surface: HTMLElement;
  private jump = false;
  private dash = false;
  private slash = false;
  private mouseSlash = false;
  private hadLock = false;

  constructor(surface: HTMLElement) {
    this.surface = surface;
    addEventListener('keydown', (e) => this.keyDown(e));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseSlash = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - e.movementY * SENSITIVITY));
    });
    addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      // A click on the game always asks for the lock again, since the browser can refuse it right after Esc.
      if (e.target === this.surface && document.pointerLockElement !== this.surface) this.lock();
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
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.surface;
      if (!locked && this.hadLock && this.enabled) this.onLockLost();
      this.hadLock = locked;
    });
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.code === 'KeyM') this.onMute();
    if (!this.enabled) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space') this.jump = true;
    if (e.code === 'KeyQ') this.dash = true;
    if (e.code === 'KeyJ') this.slash = true;
    if (e.code === 'KeyR') this.onRetry();
    if (e.code === 'KeyP') this.onLockLost();
  }

  /** Must be called from a click. A refusal is fine, because plain mouse movement still works. */
  lock(): void {
    try {
      const result = this.surface.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch?.(() => {});
    } catch {
      // Some embedded views refuse pointer lock.
    }
  }

  unlock(): void {
    this.hadLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear(): void {
    this.keys.clear();
    this.jump = this.dash = this.slash = this.mouseSlash = false;
  }

  /** Reads this frame's input and consumes the one-shot presses. */
  sample(dt: number): FrameInput {
    const k = this.keys;
    if (k.has('ArrowLeft')) this.yaw += KEY_LOOK_RATE * dt;
    if (k.has('ArrowRight')) this.yaw -= KEY_LOOK_RATE * dt;
    if (k.has('ArrowUp')) this.pitch = Math.min(MAX_PITCH, this.pitch + KEY_LOOK_RATE * dt);
    if (k.has('ArrowDown')) this.pitch = Math.max(-MAX_PITCH, this.pitch - KEY_LOOK_RATE * dt);
    const out: FrameInput = {
      moveX: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      moveZ: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      yaw: this.yaw,
      pitch: this.pitch,
      jumpPressed: this.jump,
      slide: k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC'),
      dashPressed: this.dash,
      wireHeld: k.has('KeyE'),
      slashPressed: this.slash,
      slashHeld: this.mouseSlash || k.has('KeyJ'),
    };
    this.jump = this.dash = this.slash = false;
    return out;
  }
}
