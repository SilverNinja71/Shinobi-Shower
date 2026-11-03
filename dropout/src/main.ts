import { ShowerAudio } from './audio/ShowerAudio.ts';
import { GameLoop } from './core/GameLoop.ts';
import type { GameEvent } from './core/GameLoop.ts';
import { Input } from './core/Input.ts';
import { NO_INTENT } from './player/PlayerController.ts';
import type { PlayerIntent } from './player/PlayerController.ts';
import { SceneRenderer } from './rendering/SceneRenderer.ts';
import { MoistureHUD } from './ui/MoistureHUD.ts';

declare const __DEV__: boolean;

const STEP = 1 / 120;
const MAX_FRAME = 0.1;
const BEST_KEY = 'dropout.best';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = byId<HTMLCanvasElement>('stage');
const menu = byId('menu');
const endScreen = byId('end');
const pauseScreen = byId('pause');
const muteButton = byId('mute');

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(Math.floor(score)));
  } catch {
    // Private windows can refuse storage. The best score just won't persist.
  }
}

const game = new GameLoop();
const input = new Input(canvas);
const hud = new MoistureHUD();
const audio = new ShowerAudio();
let renderer: SceneRenderer;

try {
  renderer = new SceneRenderer(canvas);
} catch {
  byId('no-webgl').hidden = false;
  menu.hidden = true;
  throw new Error('WebGL is unavailable');
}

const intent: PlayerIntent = { ...NO_INTENT };
let best = readBest();
let accumulator = 0;
let lastFrame = performance.now();

function start(): void {
  game.start();
  audio.start();
  input.clear();
  input.enabled = true;
  menu.hidden = true;
  endScreen.hidden = true;
  pauseScreen.hidden = true;
  hud.setVisible(true);
}

function setPaused(paused: boolean): void {
  if (paused ? game.state !== 'playing' : game.state !== 'paused') return;
  game.state = paused ? 'paused' : 'playing';
  pauseScreen.hidden = !paused;
  input.enabled = !paused;
  input.clear();
  audio.pause(paused);
  if (paused) byId('resume').focus();
}

function showEnd(): void {
  input.enabled = false;
  const won = game.state === 'won';
  const score = Math.floor(game.score);
  const isBest = score > best;
  if (isBest) {
    best = score;
    writeBest(best);
  }
  byId('end-title').textContent = won ? 'Water off' : game.lossCause === 'drained' ? 'Down the drain' : 'Dissolved';
  byId('end-copy').textContent = won
    ? 'You outlasted the full three-minute shower, and there is still some soap left.'
    : game.lossCause === 'drained'
      ? 'The drain got you. Keep moving outward, and hop or dash when the floor turns soapy.'
      : 'You reached 100% moisture. Stand on dry tile to dry off, and dash only when you have to.';
  const minutes = Math.floor(game.time / 60);
  const seconds = String(Math.floor(game.time % 60)).padStart(2, '0');
  byId('end-time').textContent = `${minutes}:${seconds}`;
  byId('end-score').textContent = score.toLocaleString('en-US');
  byId('end-best').textContent = isBest ? 'New best' : best.toLocaleString('en-US');
  endScreen.hidden = false;
  hud.setVisible(false);
  byId('again').focus();
}

function handleEvent(e: GameEvent): void {
  renderer.handleEvent(e);
  hud.handleEvent(e);
  switch (e.type) {
    case 'plink':
      audio.plink(e.size);
      break;
    case 'impact':
      audio.thud(0.32);
      break;
    case 'crush':
      audio.thud(0.7);
      break;
    case 'hit':
      audio.blip(520, 180);
      break;
    case 'dash':
      audio.whoosh();
      break;
    case 'hop':
      audio.blip(280, 620, 0.1);
      break;
    case 'land':
      audio.thud(0.1 * e.size);
      break;
    case 'wall':
      audio.thud(0.16 * e.size);
      break;
    case 'closeShave':
      audio.blip(880, 1320);
      break;
    case 'encase':
      audio.blip(180, 640, 0.18);
      break;
    case 'burst':
      audio.blip(1400, 300, 0.2);
      break;
    case 'lost':
      audio.thud(0.6);
      break;
    default:
      break;
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = Math.min(MAX_FRAME, (now - lastFrame) / 1000);
  lastFrame = now;

  if (game.state === 'playing' || game.state === 'attract') {
    if (game.state === 'playing') input.sample(intent);
    else Object.assign(intent, NO_INTENT);
    accumulator += elapsed;
    // One-shot presses go to the first step only, so they fire once however many steps run.
    let first = true;
    while (accumulator >= STEP && (game.state === 'playing' || game.state === 'attract')) {
      game.step(STEP, intent);
      if (first) {
        intent.hopPressed = intent.dashPressed = false;
        intent.mash = 0;
        first = false;
      }
      accumulator -= STEP;
    }
  }

  for (const e of game.events) handleEvent(e);
  game.events.length = 0;

  if (game.state === 'won' || game.state === 'lost') {
    if (endScreen.hidden) showEnd();
  } else if (game.state === 'playing') {
    hud.update(elapsed, game);
    const skid = game.player.sliding || game.surface !== 'dry' ? game.player.drift : 0;
    audio.update(elapsed, (game.heat - 37) / 15, skid, game.moisture.value);
  }
  renderer.render(game.state === 'paused' ? 0 : elapsed, game);
}

byId('start').addEventListener('click', start);
byId('again').addEventListener('click', start);
byId('resume').addEventListener('click', () => setPaused(false));
input.onPause = () => setPaused(game.state === 'playing');
input.onMute = () => {
  muteButton.setAttribute('aria-pressed', String(audio.toggleMute()));
  muteButton.textContent = audio.muted ? 'Sound off' : 'Sound on';
};
muteButton.addEventListener('click', () => input.onMute());
addEventListener('blur', () => setPaused(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

if (best > 0) byId('menu-best').textContent = `Best score ${best.toLocaleString('en-US')}`;
hud.setVisible(false);
byId('start').focus();
requestAnimationFrame(frame);

if (__DEV__) (window as unknown as { dropout: GameLoop }).dropout = game;
