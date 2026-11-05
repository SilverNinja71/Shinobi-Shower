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
import { SandboxPanel } from './ui/SandboxPanel.ts';
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

const sandboxPanel = new SandboxPanel(game, save, {
  onNotify: (msg, sub) => hud.say(msg, sub, 'perk', 2800),
});

function persist(): void {
  save = {
    ...save,
    level: game.levels.level,
    exp: game.levels.exp,
    disabled: [...game.disabled],
    deaths: save.deaths || 0,
    sandboxUnlocked: save.sandboxUnlocked,
  };
  writeSave(save);
}

function enterSandbox(): void {
  game.sandbox.active = true;
  game.sandbox.godMode = true;
  game.sandbox.infiniteStamina = true;
  begin();
  sandboxPanel.open();
  hud.say('⛩️ ASCENDANT SANDBOX', 'Infinite Powers & Divine Realm Active', 'perk', 3500);
}

const screens = new Screens({
  onStart: () => begin(),
  onAgain: () => begin(),
  onResume: () => resume(),
  onQuit: () => {
    if (game.phase === 'paused' || game.phase === 'playing' || game.phase === 'celestial') {
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
  onSandbox: () => enterSandbox(),
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
  save.deaths = (save.deaths || 0) + 1;
  const unlockedSandboxNow = save.deaths === 101 && !save.sandboxUnlocked;
  if (save.deaths > 100) {
    save.sandboxUnlocked = true;
    sandboxPanel.setUnlocked(true);
  }
  save.bestWave = Math.max(save.bestWave, game.waves.wave);
  save.bestTime = Math.max(save.bestTime, game.stats.time);
  persist();
  screens.showOver(game, save, unlockedSandboxNow);
  if (unlockedSandboxNow) {
    hud.say('⛩️ IMMORTAL SANDBOX UNLOCKED', '100 Defeats Surpassed. The peak obeys you.', 'perk', 4500);
  }
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
    const timeScale = game.sandbox.active ? game.sandbox.timeScale : 1.0;
    acc += dt * timeScale;
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

  const params = new URLSearchParams(location.search);
  const w = window as unknown as Record<string, unknown>;
  if (params.get('sandbox') === '1' || Number(params.get('deaths') || 0) > 100) {
    save.deaths = Math.max(save.deaths || 0, Number(params.get('deaths') || 101));
    save.sandboxUnlocked = true;
    sandboxPanel.setUnlocked(true);
    if (params.get('sandbox') === '1') {
      sandboxPanel.open();
    }
    persist();
  }

  Object.assign(debug, {
    game,
    view,
    save,
    sandboxPanel,
    setLevel(level: number) {
      game.levels.level = level;
      game.levels.exp = 0;
      game.refreshStance();
    },
    /** Jumps to \`t\` seconds into wave \`wave\`. */
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
    setDeaths(deaths: number) {
      save.deaths = deaths;
      if (deaths > 100) {
        save.sandboxUnlocked = true;
        sandboxPanel.setUnlocked(true);
      }
      persist();
    },
    unlockSandbox() {
      save.deaths = Math.max(save.deaths || 0, 101);
      save.sandboxUnlocked = true;
      sandboxPanel.setUnlocked(true);
      persist();
      sandboxPanel.open();
    },
    toggleSandbox() {
      sandboxPanel.toggle();
    },
  });
  w.bridgeDebug = debug;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC' && !e.repeat) {
      if (game.phase === 'menu') begin();
      game.triggerAtomicCleave();
    }
  });

  if (__DEV__) {
    // The dev server stays silent until unmuted.
    toggleMute();
  }

  if (params.has('level')) (debug as unknown as { setLevel(l: number): void }).setLevel(Number(params.get('level')));
  if (params.get('autostart') === '1') {
    begin(Number(params.get('seed') ?? 3));
    const d = debug as unknown as { jumpWave(w: number, t: number): void; advance(s: number): void };
    if (params.has('wave')) d.jumpWave(Number(params.get('wave')), Number(params.get('t') ?? 5));
    if (params.has('simtime')) d.advance(Number(params.get('simtime')));
    if (params.has('x')) game.warrior.x = Number(params.get('x'));
    if (params.get('freeze') === '1') debug.frozen = true;
    if (params.get('invincible') === '1') setInterval(() => (game.dryness = 100), 250);
    if (params.get('cutscene') === '1') {
      game.triggerAtomicCleave();
      if (params.has('cuttime')) {
        const targetTime = Number(params.get('cuttime'));
        game.cutscene.time = 0;
        let t = 0;
        while (t < targetTime) {
          const dt = Math.min(0.04, targetTime - t);
          t += dt;
          game.cutscene.update(dt);
          for (const ev of game.cutscene.events) {
            if (ev.type === 'atomic_fission') game.events.push({ type: 'atomic_fission', time: ev.time, x: ev.x, y: ev.y });
            if (ev.type === 'bridge_shatter') game.events.push({ type: 'bridge_collapse', time: ev.time, x: ev.x, y: ev.y });
          }
          game.cutscene.events.length = 0;
        }
      }
    }
    if (params.get('celestial') === '1') {
      game.triggerAtomicCleave();
      game.cutscene.time = 7.0;
      game.cutscene.update(0.1);
      game.phase = 'celestial';
      game.celestial.start(game.warrior.x);
      game.events.push({ type: 'celestial_start' });
      game.celestial.spawnDemon('imp', game.warrior.x + 4.2, 3.8);
      game.celestial.spawnDemon('drake', game.warrior.x - 4.8, 5.0);
      const ang = game.celestial.spawnAngel(game.warrior.x + 2.0);
      ang.y = 1.6;
      if (params.get('lightblade') === '1') {
        game.celestial.lightBladeTimer = 10;
      }
    }
    if (params.get('sandbox') === '1') {
      enterSandbox();
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
