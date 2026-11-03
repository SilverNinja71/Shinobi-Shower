import type { Game } from '../core/Game.ts';
import type { SaveData } from '../core/Save.ts';
import { expToNext, titleFor } from '../progression/LevelManager.ts';
import { PERKS, tierFor } from '../progression/StanceModifiers.ts';
import type { Perk } from '../progression/StanceModifiers.ts';

export interface ScreenHandlers {
  onStart(): void;
  onResume(): void;
  onQuit(): void;
  onAgain(): void;
  onMenu(): void;
  onMute(): void;
  onToggleStance(id: Perk, on: boolean): void;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;

const TIERS = [
  { levels: '1–9', name: 'The Wandering Exile', look: 'Burlap poncho, frayed straw kasa, one chipped katana' },
  { levels: '10–19', name: 'The Dual Ronin', look: 'Indigo silk haori, leather guards, two katanas, cloth mask' },
  { levels: '20–29', name: 'The Armored Kenshi', look: 'Black-and-gold sode, purple spirit ribbons, a blade in spirit mist' },
  { levels: '30–39', name: 'The Ashen Warlord', look: 'Scarred fur cloak, an ember-etched katana that ignites when drawn' },
  { levels: '40–50', name: 'The Apex Sovereign', look: 'Crimson cape, celestial eye, black blades in crimson lightning' },
];

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Loading, title, pause and game-over screens. */
export class Screens {
  private readonly handlers: ScreenHandlers;
  private readonly screens = ['menu', 'pause', 'over'].map(byId);

  constructor(handlers: ScreenHandlers) {
    this.handlers = handlers;
    byId('start').addEventListener('click', () => handlers.onStart());
    byId('again').addEventListener('click', () => handlers.onAgain());
    byId('resume').addEventListener('click', () => handlers.onResume());
    byId('quit').addEventListener('click', () => handlers.onQuit());
    byId('to-menu').addEventListener('click', () => handlers.onMenu());
    byId('mute').addEventListener('click', () => handlers.onMute());
  }

  showLoading(progress: number): void {
    byId('loading').hidden = false;
    byId('loading-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
  }

  hideLoading(): void {
    byId('loading').hidden = true;
  }

  private only(id: string | null): void {
    for (const s of this.screens) s.hidden = s.id !== id;
  }

  showMenu(game: Game, save: SaveData): void {
    const lv = game.levels;
    byId('menu-level').textContent = String(lv.level);
    byId('menu-title').textContent = titleFor(lv.level);
    byId('menu-exp').style.transform = `scaleX(${lv.progress})`;
    byId('menu-exp-text').textContent = lv.level >= 50 ? 'Grandmaster' : `${lv.exp} / ${expToNext(lv.level)} mastery`;
    byId('menu-best').textContent = save.bestWave > 0 ? `Best: wave ${save.bestWave} · ${clock(save.bestTime)}` : '';
    this.renderStances(game);
    this.renderTiers(lv.level);
    this.only('menu');
    byId('start').focus({ preventScroll: true });
  }

  private renderStances(game: Game): void {
    const list = byId('stances');
    list.replaceChildren();
    for (const p of PERKS) {
      const locked = game.levels.level < p.level;
      const row = document.createElement('div');
      row.className = 'row-item';
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
        box.addEventListener('change', () => this.handlers.onToggleStance(p.id, box.checked));
        label.append(box, 'Use');
        row.append(label);
      }
      list.append(row);
    }
  }

  private renderTiers(level: number): void {
    const list = byId('tiers');
    list.replaceChildren();
    const current = tierFor(level);
    TIERS.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'row-item';
      row.dataset.locked = String(i + 1 > current);
      row.dataset.current = String(i + 1 === current);
      const lvl = document.createElement('div');
      lvl.className = 'lv';
      lvl.textContent = t.levels;
      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = t.name;
      const look = document.createElement('div');
      look.className = 'detail';
      look.textContent = t.look;
      text.append(name, look);
      const tag = document.createElement('span');
      tag.className = 'label';
      tag.textContent = i + 1 === current ? 'You' : '';
      row.append(lvl, text, tag);
      list.append(row);
    });
  }

  showPause(): void {
    this.only('pause');
    byId('resume').focus({ preventScroll: true });
  }

  showOver(game: Game, _save: SaveData): void {
    const st = game.stats;
    const wave = game.waves.wave;
    const front = game.waves.frontNow || game.waves.title || 'storm';
    byId('over-title').textContent = `Swept from the peak at wave ${wave}`;
    const gained = game.levels.level - st.startLevel;
    byId('over-levels').textContent =
      game.levels.level >= 50
        ? 'Apex Sovereign, level 50'
        : gained > 0
          ? `Level ${st.startLevel} → ${game.levels.level} · ${titleFor(game.levels.level)}`
          : `The ${front.toLowerCase()} took you. ${expToNext(game.levels.level) - game.levels.exp} mastery to level ${game.levels.level + 1}.`;
    byId('over-time').textContent = clock(st.time);
    byId('over-waves').textContent = String(st.wavesCleared);
    byId('over-cut').textContent = String(st.cut);
    byId('over-perfect').textContent = String(st.perfect);
    byId('over-combo').textContent = String(st.bestCombo);
    byId('over-planks').textContent = String(st.planksLost);
    byId('over-exp').textContent = `+${st.exp}`;
    this.only('over');
    byId('again').focus({ preventScroll: true });
  }

  hideAll(): void {
    this.only(null);
  }

  setMuted(muted: boolean): void {
    byId('mute').textContent = muted ? 'Sound off' : 'Sound on';
  }

  setPlaying(on: boolean): void {
    document.body.classList.toggle('playing', on);
  }

  setFocusAvailable(on: boolean): void {
    const b = document.querySelector<HTMLElement>('#touch [data-key="focus"]');
    if (b) b.hidden = !on;
  }

  showError(message: string): void {
    this.only(null);
    byId('loading').hidden = false;
    byId('loading-fill').parentElement!.hidden = true;
    byId('loading-note').textContent = message;
  }
}
