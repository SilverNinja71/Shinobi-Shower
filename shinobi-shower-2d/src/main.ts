import { TrialAudio } from './audio/TrialAudio.ts';
import { Input } from './core/Input.ts';
import { TrialGame, rankOf } from './core/TrialGame.ts';
import type { GameEvent } from './core/TrialGame.ts';
import type { NinjaIntent } from './parkour/NinjaController.ts';
import { IDLE_INTENT } from './parkour/NinjaController.ts';
import { CanvasRenderer } from './rendering/CanvasRenderer.ts';
import { TrialHUD, clock } from './ui/TrialHUD.ts';

declare const __DEV__: boolean;

const STEP = 1 / 120;
const MAX_FRAME = 0.1;
const BEST_KEY = 'shinobi.best';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

const canvas = byId('view') as HTMLCanvasElement;
const menu = byId('menu');
const pauseScreen = byId('pause');
const failScreen = byId('fail');
const endScreen = byId('end');
const muteButton = byId('mute');

function readBest(): { time: number; rank: string } | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as { time: number; rank: string }) : null;
  } catch {
    return null;
  }
}

function writeBest(best: { time: number; rank: string }): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    // Storage can be blocked. The record just won't persist.
  }
}

const game = new TrialGame();
const input = new Input();
const hud = new TrialHUD();
const audio = new TrialAudio();
const renderer = new CanvasRenderer(canvas, game);

let accumulator = 0;
let last = performance.now();
let best = readBest();
const intent: NinjaIntent = { ...IDLE_INTENT };

/** The system cursor disappears while playing, and the reticle drawn in the game takes over. */
function showCursor(show: boolean): void {
  document.body.classList.toggle('playing', !show);
}

function enterPlay(): void {
  showCursor(false);
  input.clear();
  input.enabled = true;
  audio.start();
  audio.suspend(false);
  menu.hidden = pauseScreen.hidden = failScreen.hidden = endScreen.hidden = true;
  hud.setVisible(true);
}

function begin(): void {
  game.start((byId('hardcore') as HTMLInputElement).checked);
  enterPlay();
  hud.say(game.level.stages[0].name);
}

function retry(): void {
  game.retry();
  enterPlay();
}

function pause(): void {
  if (game.phase !== 'playing') return;
  game.phase = 'paused';
  showCursor(true);
  input.enabled = false;
  audio.suspend(true);
  pauseScreen.hidden = false;
  byId('resume').focus();
}

function resume(): void {
  if (game.phase !== 'paused') return;
  game.phase = 'playing';
  showCursor(false);
  input.clear();
  input.enabled = true;
  audio.suspend(false);
  pauseScreen.hidden = true;
}

function showFail(): void {
  showCursor(true);
  input.enabled = false;
  hud.setVisible(false);
  byId('fail-copy').textContent = game.hardcore
    ? `One drop on the robes ended the trial at ${game.level.stages[game.stage].name}.`
    : `Your robes are soaked through at ${game.level.stages[game.stage].name}. You can return to the last ledge with fresh robes.`;
  failScreen.hidden = false;
  byId('retry').focus();
}

function showEnd(): void {
  showCursor(true);
  input.enabled = false;
  hud.setVisible(false);
  const verdict = rankOf(game.stains, game.retries);
  const isBest = !best || game.elapsed < best.time;
  if (isBest) {
    best = { time: game.elapsed, rank: verdict.rank };
    writeBest(best);
  }
  byId('end-rank').textContent = verdict.rank;
  byId('end-title').textContent = verdict.title;
  byId('end-time').textContent = clock(game.elapsed);
  byId('end-stains').textContent = String(game.stains);
  byId('end-slices').textContent = String(game.slices);
  byId('end-best').textContent = isBest ? 'New best' : clock(best!.time);
  endScreen.hidden = false;
  byId('again').focus();
}

function dripPan(e: GameEvent): number {
  return Math.max(-0.9, Math.min(0.9, (e.x - game.ninja.pos.x) / 14));
}

function handleEvent(e: GameEvent): void {
  renderer.handleEvent(e, game);
  hud.handleEvent(e, game);
  switch (e.type) {
    case 'slash': audio.slash(); break;
    case 'cleave': audio.cleave(); break;
    case 'pop': audio.cleave(); break;
    case 'parry': audio.parry(); break;
    case 'hit': audio.hit(); break;
    case 'flood': audio.hit(); break;
    case 'splash': audio.splash(); break;
    case 'beat': if (game.phase === 'playing') audio.drip(dripPan(e), e.value > 0); break;
    case 'jump': audio.step('jump'); break;
    case 'land': audio.step('land', e.value); break;
    case 'slide': audio.step('slide'); break;
    case 'wall': audio.step('wall'); break;
    case 'slip': audio.step('wall'); break;
    case 'rail': audio.step('rail'); break;
    case 'dash': audio.step('dash'); break;
    case 'wire': audio.step('wire'); break;
    case 'bounce': audio.step('bounce'); break;
    case 'stage':
    case 'finished': audio.chime(); break;
    default: break;
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;

  if (game.phase === 'playing' || game.phase === 'menu') {
    const f = input.sample();
    const aim = renderer.aimFrom(input.mouseX, input.mouseY, game);
    renderer.lastAim = aim;
    Object.assign(intent, {
      moveX: f.moveX,
      aimX: aim.x,
      aimY: aim.y,
      jumpPressed: f.jumpPressed,
      jumpHeld: f.jumpHeld,
      slide: f.slide,
      dashPressed: f.dashPressed,
      wireHeld: f.wireHeld,
    });
    let pressed = f.slashPressed;
    accumulator += elapsed;
    while (accumulator >= STEP && (game.phase === 'playing' || game.phase === 'menu')) {
      game.step(STEP, intent, { pressed, held: f.slashHeld });
      // One-shot presses reach only the first step, however many run in this frame.
      intent.jumpPressed = intent.dashPressed = false;
      pressed = false;
      accumulator -= STEP;
    }
  }

  for (const e of game.events) handleEvent(e);
  game.events.length = 0;

  if (game.phase === 'failed' && failScreen.hidden) showFail();
  if (game.phase === 'finished' && endScreen.hidden) showEnd();
  if (game.phase === 'playing') {
    hud.update(game);
    audio.update(elapsed, game.ninja.speed, game.level.steamAt(game.ninja.eye), game.blade.scale);
  }
  renderer.render(game.phase === 'paused' ? 0 : elapsed, game, input.mouseX, input.mouseY, game.phase === 'playing');
}

byId('start').addEventListener('click', begin);
byId('resume').addEventListener('click', resume);
byId('retry').addEventListener('click', retry);
byId('again').addEventListener('click', begin);
input.onPause = () => (game.phase === 'paused' ? resume() : pause());
input.onRetry = () => {
  if (game.phase === 'playing') retry();
};
input.onMute = () => {
  muteButton.textContent = audio.toggleMute() ? 'Sound off' : 'Sound on';
};
muteButton.addEventListener('click', () => input.onMute());
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

if (best) byId('menu-best').textContent = `Best trial ${clock(best.time)}, rank ${best.rank}`;
hud.setVisible(false);
byId('start').focus();
requestAnimationFrame(frame);

if (__DEV__) {
  (window as unknown as { shinobi: TrialGame }).shinobi = game;
  // The dev server stays silent until unmuted.
  input.onMute();
}
