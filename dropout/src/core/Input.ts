import type { PlayerIntent } from '../player/PlayerController.ts';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const SLIDE_KEYS = ['ShiftLeft', 'ShiftRight'];
const DASH_KEYS = ['KeyE', 'KeyJ'];
const STICK_DEADZONE = 0.18;
const JOYSTICK_RADIUS = 56;

/** Merges keyboard, mouse, touch and gamepad into one intent per frame. */
export class Input {
  private readonly keys = new Set<string>();
  private hop = false;
  private dash = false;
  private mash = 0;
  private touchSlide = false;
  private touchX = 0;
  private touchZ = 0;
  private joystickId: number | null = null;
  private joystickX = 0;
  private joystickY = 0;
  private padButtons: boolean[] = [];
  /** Set while the game is taking input, so menus keep their own keys. */
  enabled = false;
  /** Called on Escape or P. */
  onPause: () => void = () => {};
  onMute: () => void = () => {};

  constructor(surface: HTMLElement) {
    addEventListener('keydown', (e) => this.onKeyDown(e));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 2) this.pressDash();
    });
    this.bindTouch(surface);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape' || e.code === 'KeyP') this.onPause();
    if (e.code === 'KeyM') this.onMute();
    if (!this.enabled) return;
    if (e.code in MOVE_KEYS || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space') this.pressHop();
    else if (DASH_KEYS.includes(e.code)) this.pressDash();
    else if (e.code in MOVE_KEYS) this.mash++;
  }

  private pressHop(): void {
    this.hop = true;
    this.mash++;
  }

  private pressDash(): void {
    this.dash = true;
    this.mash++;
  }

  private bindTouch(surface: HTMLElement): void {
    const knob = document.getElementById('stick-knob');
    const stick = document.getElementById('stick');
    const press = (id: string, down: () => void, up?: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        down();
      });
      if (up) {
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
      }
    };
    press('btn-hop', () => this.pressHop());
    press('btn-dash', () => this.pressDash());
    press('btn-slide', () => (this.touchSlide = true), () => (this.touchSlide = false));

    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || this.joystickId !== null) return;
      if (e.clientX > innerWidth * 0.55) return;
      this.joystickId = e.pointerId;
      this.joystickX = e.clientX;
      this.joystickY = e.clientY;
      if (stick) {
        stick.style.left = `${e.clientX}px`;
        stick.style.top = `${e.clientY}px`;
        stick.hidden = false;
      }
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joystickId) return;
      const dx = (e.clientX - this.joystickX) / JOYSTICK_RADIUS;
      const dy = (e.clientY - this.joystickY) / JOYSTICK_RADIUS;
      const len = Math.max(1, Math.hypot(dx, dy));
      this.touchX = dx / len;
      this.touchZ = dy / len;
      if (knob) {
        knob.style.transform = `translate(${this.touchX * JOYSTICK_RADIUS}px, ${this.touchZ * JOYSTICK_RADIUS}px)`;
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.joystickId) return;
      this.joystickId = null;
      this.touchX = this.touchZ = 0;
      if (stick) stick.hidden = true;
      if (knob) knob.style.transform = '';
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  }

  /** Drops any input queued while the game was not listening. */
  clear(): void {
    this.hop = this.dash = false;
    this.mash = 0;
    this.keys.clear();
  }

  /** Reads this frame's intent and consumes the one-shot presses. */
  sample(out: PlayerIntent): void {
    let x = this.touchX;
    let z = this.touchZ;
    for (const code of this.keys) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        x += dir[0];
        z += dir[1];
      }
    }
    let slide = this.touchSlide || SLIDE_KEYS.some((k) => this.keys.has(k));

    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const az = pad.axes[1] ?? 0;
      if (Math.hypot(ax, az) > STICK_DEADZONE) {
        x += ax;
        z += az;
      }
      slide = slide || (pad.buttons[7]?.value ?? 0) > 0.2 || (pad.buttons[6]?.value ?? 0) > 0.2;
      const pressed = (i: number) => {
        const now = pad.buttons[i]?.pressed ?? false;
        const edge = now && !this.padButtons[i];
        this.padButtons[i] = now;
        return edge;
      };
      if (pressed(0)) this.pressHop();
      if (pressed(2)) this.pressDash();
    }

    const len = Math.hypot(x, z);
    const k = len > 1 ? 1 / len : 1;
    out.moveX = x * k;
    out.moveZ = z * k;
    out.slide = slide;
    out.hopPressed = this.hop;
    out.dashPressed = this.dash;
    out.mash = this.mash;
    this.hop = this.dash = false;
    this.mash = 0;
  }
}
