import assert from 'node:assert/strict';
import { test } from 'node:test';

// Input only needs window-level events, so a bare EventTarget can stand in for the browser.
const win = new EventTarget();
const g = globalThis as unknown as Record<string, unknown>;
g.addEventListener = win.addEventListener.bind(win);
g.document = new EventTarget();
const { Input } = await import('../src/core/Input.ts');

class Key extends Event {
  code: string;
  repeat = false;
  constructor(type: string, code: string) {
    super(type);
    this.code = code;
  }
}

function pressed(code: string) {
  const input = new Input(new EventTarget() as unknown as HTMLElement);
  input.enabled = true;
  win.dispatchEvent(new Key('keydown', code));
  win.dispatchEvent(new Key('keyup', code));
  return input.sample(0).dashPressed;
}

test('Q dashes and K no longer does', () => {
  assert.equal(pressed('KeyQ'), true);
  assert.equal(pressed('KeyK'), false);
});

test('right click still dashes, once per press', () => {
  const input = new Input(new EventTarget() as unknown as HTMLElement);
  input.enabled = true;
  const click = new Event('mousedown') as Event & { button: number };
  click.button = 2;
  win.dispatchEvent(click);
  assert.equal(input.sample(0).dashPressed, true);
  assert.equal(input.sample(0).dashPressed, false);
});
