import * as THREE from 'three';
import { AudioEngine } from './audio/AudioEngine.ts';
import { Game, NO_INPUT } from './core/Game.ts';
import type { GameEvent } from './core/Game.ts';
import { Input } from './core/Input.ts';
import { loadSave, writeSave } from './core/Save.ts';
import { planWave, waveDuration } from './progression/WaveDirector.ts';
import { Assets } from './render/Assets.ts';
import { GameRenderer } from './render/GameRenderer.ts';
import type { Quality } from './render/RenderContext.ts';
import { HUD } from './ui/HUD.ts';
import { Screens } from './ui/Screens.ts';
import type { DropKind } from './weather/PrecipitationDroplet.ts';

declare const __DEV__: boolean;

const STEP = 1 / 120;
const MAX_FRAME = 0.1;

const stage = document.getElementById('stage') as HTMLElement;
let save = loadSave();
const game = new Game(save.level, save.exp, save.disabled);
const hud = new HUD();
const audio = new AudioEngine();
const input = new Input(stage);
let view: GameRenderer | null = null;

function persist(): void {
  save = { ...save, level: game.levels.level, exp: game.levels.exp, disabled: [...game.disabled] };
  writeSave(save);
}

const screens = new Screens({
  onStart: () => begin(),
  onAgain: () => begin(),
  onResume: () => resume(),
  onQuit: () => {
    if (game.phase === 'paused' || game.phase === 'playing') {
      game.phase = 'over';
      game.events.push({ type: 'over' });
    }
  },
  onMenu: () => toMenu(),
  onMute: () => toggleMute(),
  onToggleStance: (id, on) => {
    if (on) game.disabled.delete(id);
    else game.disabled.add(id);
    game.refreshStance();
    persist();
  },
});

function toggleMute(): void {
  screens.setMuted(audio.toggleMute());
}

input.onMute = toggleMute;
input.onPause = () => {
  if (game.phase === 'playing' || game.phase === 'celestial') pause();
  else if (game.phase === 'paused') resume();
};
const touch = document.getElementById('touch');
if (touch) input.bindTouch(touch);

function begin(seed?: number): void {
  game.start(seed);
  input.clear();
  input.enabled = true;
  audio.start();
  audio.suspend(false);
  screens.hideAll();
  screens.setPlaying(true);
  screens.setFocusAvailable(game.stance.focus);
  hud.setVisible(true);
}

function pause(): void {
  if (game.phase !== 'playing' && game.phase !== 'celestial') return;
  game.phase = 'paused';
  input.enabled = false;
  audio.suspend(true);
  screens.setPlaying(false);
  screens.showPause();
}

function resume(): void {
  if (game.phase !== 'paused') return;
  game.phase = game.celestial.active ? 'celestial' : 'playing';
  input.clear();
  input.enabled = true;
  audio.suspend(false);
  screens.hideAll();
  screens.setPlaying(true);
}

function toMenu(): void {
  game.phase = 'menu';
  input.enabled = false;
  hud.setVisible(false);
  screens.setPlaying(false);
  screens.showMenu(game, save);
}

function finish(): void {
  input.enabled = false;
  hud.setVisible(false);
  screens.setPlaying(false);
  save.bestWave = Math.max(save.bestWave, game.waves.wave);
  save.bestTime = Math.max(save.bestTime, game.stats.time);
  persist();
  screens.showOver(game, save);
}

function handle(e: GameEvent): void {
  view?.handleEvent(e, game);
  hud.handleEvent(e, game);
  audio.handleEvent(e, game);
  if (e.type === 'levelup') {
    persist();
    screens.setFocusAvailable(game.stance.focus);
  }
  if (e.type === 'over') finish();
}

addEventListener('blur', () => pause());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

/* ---------- Debug hook (dev builds only) ---------- */
const debug = {
  frozen: false,
  get fps() {
    return view ? Math.round(view.fps) : 0;
  },
};

let acc = 0;
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  const activePlay = game.phase === 'playing' || game.phase === 'cutscene' || game.phase === 'celestial';
  if (activePlay && !debug.frozen) {
    acc += dt;
    let f = input.sample();
    while (acc >= STEP && (game.phase === 'playing' || game.phase === 'cutscene' || game.phase === 'celestial')) {
      game.step(STEP, f);
      // A press reaches only the first step of the frame.
      f = { ...NO_INPUT, moveX: f.moveX };
      acc -= STEP;
    }
  }
  for (let i = 0; i < game.events.length; i++) handle(game.events[i]);
  game.events.length = 0;
  if (activePlay) {
    hud.update(game);
    audio.update(dt, game);
  }
  view?.render(game.phase === 'paused' ? dt * 0.25 : dt, game);
}

function chooseQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches;
  return coarse || Math.min(innerWidth, innerHeight) < 500 ? 'low' : 'high';
}

async function boot(): Promise<void> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    screens.showError('This game needs WebGL, which this browser has turned off.');
    return;
  }
  stage.prepend(renderer.domElement);
  renderer.domElement.id = 'view';
  const assets = await Assets.load(renderer, (p) => screens.showLoading(p));
  view = new GameRenderer(stage, renderer, assets, chooseQuality());
  screens.hideLoading();

  if (__DEV__) {
    // The dev server stays silent until unmuted.
    toggleMute();
    const params = new URLSearchParams(location.search);
    const w = window as unknown as Record<string, unknown>;
    Object.assign(debug, {
      game,
      view,
      setLevel(level: number) {
        game.levels.level = level;
        game.levels.exp = 0;
        game.refreshStance();
      },
      /** Jumps to `t` seconds into wave `wave`. */
      jumpWave(wave: number, t = 5) {
        game.waves.wave = wave;
        game.waves.duration = waveDuration(wave);
        game.waves.fronts = planWave(wave, game.seed);
        game.waves.t = t;
      },
      /** Runs the simulation forward without rendering, to fill the sky. */
      advance(seconds: number) {
        for (let i = 0; i < seconds / STEP && game.phase === 'playing'; i++) {
          game.step(STEP, NO_INPUT);
          if (game.dryness < 30) game.dryness = 100;
        }
        game.events.length = 0;
      },
      freeze(on: boolean) {
        debug.frozen = on;
      },
      spawn(kind: DropKind, x: number, y: number, r?: number) {
        return game.spawn(kind, x, y, r);
      },
      triggerAtomicCleave() {
        if (game.phase === 'menu') begin();
        game.triggerAtomicCleave();
      },
    });
    w.bridgeDebug = debug;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && !e.repeat) {
        if (game.phase === 'menu') begin();
        game.triggerAtomicCleave();
      }
    });
    if (params.has('level')) (debug as unknown as { setLevel(l: number): void }).setLevel(Number(params.get('level')));
    if (params.get('autostart') === '1') {
      begin(Number(params.get('seed') ?? 3));
      const d = debug as unknown as { jumpWave(w: number, t: number): void; advance(s: number): void };
      if (params.has('wave')) d.jumpWave(Number(params.get('wave')), Number(params.get('t') ?? 5));
      if (params.has('simtime')) d.advance(Number(params.get('simtime')));
      if (params.has('x')) game.warrior.x = Number(params.get('x'));
      if (params.get('freeze') === '1') debug.frozen = true;
      if (params.get('invincible') === '1') setInterval(() => (game.dryness = 100), 250);
    } else {
      screens.showMenu(game, save);
    }
  } else {
    screens.showMenu(game, save);
  }
  requestAnimationFrame(frame);
}

void boot().catch((err: unknown) => {
  console.error(err);
  screens.showError('The game could not load its art. Reload the page to try again.');
});
