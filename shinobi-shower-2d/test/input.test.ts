import assert from 'node:assert/strict';
import { test } from 'node:test';

// Input only needs window-level events and the viewport size, so a bare EventTarget stands in for the browser.
const win = new EventTarget();
const g = globalThis as unknown as Record<string, unknown>;
g.addEventListener = win.addEventListener.bind(win);
g.innerWidth = 1280;
g.innerHeight = 720;
const { Input } = await import('../src/core/Input.ts');

class Key extends Event {
  code: string;
  repeat = false;
  constructor(type: string, code: string) {
    super(type);
    this.code = code;
  }
}

function mouse(type: string, button: number) {
  const e = new Event(type, { cancelable: true }) as Event & { button: number };
  e.button = button;
  return e;
}

function makeInput() {
  const input = new Input();
  input.enabled = true;
  return input;
}

function pressed(code: string) {
  const input = makeInput();
  win.dispatchEvent(new Key('keydown', code));
  win.dispatchEvent(new Key('keyup', code));
  const dash = input.sample().dashPressed;
  input.enabled = false;
  return dash;
}

test('Q dashes and K does not', () => {
  assert.equal(pressed('KeyQ'), true);
  assert.equal(pressed('KeyK'), false);
});

test('right click dashes, once per press', () => {
  const input = makeInput();
  win.dispatchEvent(mouse('mousedown', 2));
  assert.equal(input.sample().dashPressed, true);
  assert.equal(input.sample().dashPressed, false);
  input.enabled = false;
});

test('nothing registers while disabled', () => {
  const input = new Input();
  win.dispatchEvent(new Key('keydown', 'KeyQ'));
  win.dispatchEvent(mouse('mousedown', 2));
  assert.equal(input.sample().dashPressed, false);
});
