import { AudioEngine } from './engine/AudioEngine.ts';
import { Game, NO_INPUT } from './engine/Game.ts';
import type { FrameInput, GameEvent } from './engine/Game.ts';
import { expToNext, titleFor } from './progression/LevelManager.ts';
import { PERKS } from './progression/StanceModifiers.ts';
import type { Perk } from './progression/StanceModifiers.ts';
import { HUD } from './ui/HUD.ts';
import { Renderer } from './ui/Renderer.ts';

declare const __DEV__: boolean;

const STEP = 1 / 120;
const MAX_FRAME = 0.1;
const SAVE_KEY = 'shinobi1d.progress';

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = byId('view') as HTMLCanvasElement;
const menu = byId('menu');
const pauseScreen = byId('pause');
const overScreen = byId('over');
const muteButton = byId('mute');

interface Save {
  level: number;
  exp: number;
  disabled: Perk[];
  bestWave: number;
}

function load(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return { level: 1, exp: 0, disabled: [], bestWave: 0, ...(JSON.parse(raw) as Partial<Save>) };
  } catch {
    // Storage can be blocked; progress then lasts only for this visit.
  }
  return { level: 1, exp: 0, disabled: [], bestWave: 0 };
}

let save = load();
function persist(): void {
  save = { ...save, level: game.levels.level, exp: game.levels.exp, disabled: [...game.disabled] };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Not fatal.
  }
}

const game = new Game(save.level, save.exp, save.disabled);
const renderer = new Renderer(canvas);
const hud = new HUD();
const audio = new AudioEngine();

/* ---------- Input: held keys, plus presses buffered until the next simulation step reads them ---------- */
const held = new Set<string>();
const pressed = { dash: false, slash: false, focus: false };
const LEFT = ['KeyA', 'ArrowLeft', 'touch-left'];
const RIGHT = ['KeyD', 'ArrowRight', 'touch-right'];

function press(action: 'dash' | 'slash' | 'focus'): void {
  if (game.phase === 'playing') pressed[action] = true;
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (game.phase === 'playing') pause();
    else if (game.phase === 'paused') resume();
    return;
  }
  if (game.phase !== 'playing') return;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  held.add(e.code);
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') press('dash');
  if (e.code === 'KeyJ' || e.code === 'KeyK') press('slash');
  if (e.code === 'KeyF') press('focus');
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => {
  held.clear();
  pause();
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) press('slash');
  else if (e.button === 2) press('dash');
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

for (const b of document.querySelectorAll<HTMLButtonElement>('#touch button')) {
  const key = b.dataset.key!;
  const down = (e: PointerEvent) => {
    e.preventDefault();
    b.classList.add('on');
    if (key === 'pause') pause();
    else if (key === 'left' || key === 'right') held.add(`touch-${key}`);
    else press(key as 'dash' | 'slash' | 'focus');
  };
  const up = () => {
    b.classList.remove('on');
    held.delete(`touch-${key}`);
  };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
}

function sample(): FrameInput {
  const right = RIGHT.some((k) => held.has(k)) ? 1 : 0;
  const left = LEFT.some((k) => held.has(k)) ? 1 : 0;
  const out = { moveX: right - left, dashPressed: pressed.dash, slashPressed: pressed.slash, focusPressed: pressed.focus };
  pressed.dash = pressed.slash = pressed.focus = false;
  return out;
}

/* ---------- Screens ---------- */
function showCursor(show: boolean): void {
  document.body.classList.toggle('playing', !show);
}

function renderMenu(): void {
  const lv = game.levels;
  byId('menu-level').textContent = String(lv.level);
  byId('menu-title').textContent = titleFor(lv.level);
  byId('menu-exp').style.transform = `scaleX(${lv.progress})`;
  byId('menu-exp-text').textContent = lv.level >= 50 ? 'Max level' : `${lv.exp} / ${expToNext(lv.level)} mastery`;
  byId('menu-best').textContent = save.bestWave > 0 ? `Best: reached wave ${save.bestWave}` : '';
  const list = byId('stances');
  list.innerHTML = '';
  for (const p of PERKS) {
    const locked = lv.level < p.level;
    const row = document.createElement('div');
    row.className = 'stance';
    row.dataset.locked = String(locked);
    const lvl = document.createElement('div');
    lvl.className = 'lv';
    lvl.textContent = `Lv ${p.level}`;
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name;
    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.append(`${p.perk}. `);
    const cost = document.createElement('em');
    cost.textContent = p.cost;
    detail.append(cost);
    text.append(name, detail);
    row.append(lvl, text);
    if (locked) {
      const tag = document.createElement('span');
      tag.className = 'label';
      tag.textContent = 'Locked';
      row.append(tag);
    } else {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = `stance-${p.id}`;
      box.checked = !game.disabled.has(p.id);
      box.addEventListener('change', () => {
        if (box.checked) game.disabled.delete(p.id);
        else game.disabled.add(p.id);
        game.refreshStance();
        persist();
      });
      label.append(box, 'Use');
      row.append(label);
    }
    list.append(row);
  }
}

function begin(): void {
  game.start();
  showCursor(false);
  held.clear();
  audio.start();
  audio.suspend(false);
  menu.hidden = pauseScreen.hidden = overScreen.hidden = true;
  (byId('touch').querySelector('[data-key="focus"]') as HTMLElement).hidden = !game.stance.focus;
  hud.setVisible(true);
  hud.say('Drizzle', 'Wave 1 begins in 3');
}

function pause(): void {
  if (game.phase !== 'playing') return;
  game.phase = 'paused';
  showCursor(true);
  audio.suspend(true);
  pauseScreen.hidden = false;
  byId('resume').focus({ preventScroll: true });
}

function resume(): void {
  if (game.phase !== 'paused') return;
  game.phase = 'playing';
  held.clear();
  showCursor(false);
  audio.suspend(false);
  pauseScreen.hidden = true;
}

function toMenu(): void {
  game.phase = 'menu';
  showCursor(true);
  hud.setVisible(false);
  pauseScreen.hidden = overScreen.hidden = true;
  renderMenu();
  menu.hidden = false;
  byId('start').focus({ preventScroll: true });
}

function fmt(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function showOver(): void {
  showCursor(true);
  hud.setVisible(false);
  const st = game.stats;
  const wave = game.weather.wave;
  save.bestWave = Math.max(save.bestWave, wave);
  persist();
  byId('over-title').textContent = `The ${game.weather.season.name.toLowerCase()} won at wave ${wave}`;
  const gained = game.levels.level - st.startLevel;
  byId('over-levels').textContent = gained > 0 ? `Level ${st.startLevel} → ${game.levels.level}` : `${expToNext(game.levels.level) - game.levels.exp} mastery to level ${game.levels.level + 1}`;
  if (game.levels.level >= 50) byId('over-levels').textContent = 'Ascendant Grandmaster';
  byId('over-time').textContent = fmt(st.time);
  byId('over-sliced').textContent = String(st.sliced);
  byId('over-perfect').textContent = String(st.perfect);
  byId('over-combo').textContent = String(st.bestCombo);
  byId('over-exp').textContent = `+${st.exp}`;
  overScreen.hidden = false;
  byId('again').focus({ preventScroll: true });
}

function toggleMute(): void {
  muteButton.textContent = audio.toggleMute() ? 'Sound off' : 'Sound on';
}

/* ---------- Events and the loop ---------- */
function handle(e: GameEvent): void {
  renderer.handleEvent(e, game);
  hud.handleEvent(e, game);
  switch (e.type) {
    case 'slash': audio.slash(game.stance.flame); break;
    case 'slice': audio.slice(e.kind); break;
    case 'perfect': audio.perfect(); break;
    case 'clang': audio.clang(); break;
    case 'steam': audio.steam(); break;
    case 'hit': audio.hit(e.kind); break;
    case 'shatter': audio.shatter(); break;
    case 'splash': audio.splash(e.kind); break;
    case 'dash': audio.dash(); break;
    case 'clear': audio.chime(false); break;
    case 'levelup':
      audio.chime(true);
      persist();
      (byId('touch').querySelector('[data-key="focus"]') as HTMLElement).hidden = !game.stance.focus;
      break;
    case 'focus': audio.focus(); break;
    default: break;
  }
}

let acc = 0;
let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  if (game.phase === 'playing') {
    acc += dt;
    let input = sample();
    while (acc >= STEP && game.phase === 'playing') {
      game.step(STEP, input);
      // A press reaches only the first step of the frame.
      input = { ...NO_INPUT, moveX: input.moveX };
      acc -= STEP;
    }
    hud.update(game);
    audio.update(dt, game.drops.length, game.weather.season.kinds.includes('snow'));
  }
  for (const e of game.events) handle(e);
  game.events.length = 0;
  if (game.phase === 'over' && overScreen.hidden) showOver();
  renderer.render(game.phase === 'paused' ? 0 : dt, game, game.phase !== 'menu');
}

/* ---------- Menu backdrop: weather keeps falling behind the title ---------- */
function idleWeather(): void {
  if (game.phase !== 'menu') return;
  game.weather.update(1 / 30, game.drops, game.ninja.x);
  game.weather.events.length = 0;
  for (const d of game.drops) {
    d.y += d.vy / 30;
    d.x += d.vx / 30;
    if (d.y < 0) d.dead = true;
  }
  game.drops = game.drops.filter((d) => !d.dead);
}
game.weather.t = 0;
game.weather.wave = 2;
setInterval(idleWeather, 1000 / 30);

byId('start').addEventListener('click', begin);
byId('again').addEventListener('click', begin);
byId('resume').addEventListener('click', resume);
byId('quit').addEventListener('click', () => {
  game.phase = 'over';
  pauseScreen.hidden = true;
});
byId('to-menu').addEventListener('click', toMenu);
muteButton.addEventListener('click', toggleMute);

renderMenu();
byId('start').focus({ preventScroll: true });
requestAnimationFrame(frame);

if (__DEV__) {
  const w = window as unknown as Record<string, unknown>;
  w.shinobi1d = {
    game,
    setLevel(level: number) {
      game.levels.level = level;
      game.levels.exp = 0;
      game.refreshStance();
      renderMenu();
    },
  };
  // The dev server stays silent until unmuted.
  toggleMute();
}
