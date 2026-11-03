import type { Game, GameEvent } from '../engine/Game.ts';
import { LULL_TIME, WAVE_TIME } from '../engine/WeatherSystem.ts';
import { expToNext, titleFor } from '../progression/LevelManager.ts';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

/** The arcade overlay: level badge, dryness, the blade's cooldown, stamina and the weather report. */
export class HUD {
  private readonly root = byId('hud');
  private readonly level = byId('hud-level');
  private readonly title = byId('hud-title');
  private readonly exp = byId('hud-exp');
  private readonly season = byId('hud-season');
  private readonly wave = byId('hud-wave');
  private readonly waveFill = byId('hud-wave-fill');
  private readonly dry = byId('hud-dry');
  private readonly dryFill = byId('hud-dry-fill');
  private readonly armor = byId('hud-armor');
  private readonly blade = byId('hud-blade');
  private readonly bladeFill = byId('hud-blade-fill');
  private readonly bladeTime = byId('hud-blade-time');
  private readonly stamina = byId('hud-stamina-fill');
  private readonly dashCost = byId('hud-dash-cost');
  private readonly focus = byId('hud-focus');
  private readonly focusTime = byId('hud-focus-time');
  private readonly combo = byId('hud-combo');
  private readonly toast = byId('toast');
  private toastTimer = 0;

  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }

  say(main: string, sub = '', tone = ''): void {
    this.toast.innerHTML = '';
    const a = document.createElement('div');
    a.className = 'toast-main';
    a.textContent = main;
    this.toast.append(a);
    if (sub) {
      const b = document.createElement('div');
      b.className = 'toast-sub';
      b.textContent = sub;
      this.toast.append(b);
    }
    this.toast.dataset.tone = tone;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 2200);
  }

  handleEvent(e: GameEvent, game: Game): void {
    if (e.type === 'wave') this.say(game.weather.season.name, `Wave ${e.wave}`);
    if (e.type === 'clear') this.say('Weather breaks', `+${e.exp} mastery`);
    if (e.type === 'levelup') this.say(`Level ${e.level}`, e.perk ?? titleFor(e.level), e.perk ? 'perk' : 'level');
  }

  update(game: Game): void {
    const lv = game.levels;
    this.level.textContent = String(lv.level);
    this.title.textContent = titleFor(lv.level);
    this.exp.style.transform = `scaleX(${lv.progress})`;
    this.exp.parentElement!.title = lv.level >= 50 ? 'Max level' : `${lv.exp} / ${expToNext(lv.level)} mastery`;

    const w = game.weather;
    this.season.textContent = w.t < 0 ? 'Clearing' : w.season.name;
    this.wave.textContent = w.t < 0 ? `Wave ${w.wave} in ${Math.ceil(-w.t)}` : `Wave ${w.wave}`;
    this.waveFill.style.transform = `scaleX(${w.t < 0 ? 1 + w.t / LULL_TIME : 1 - w.t / WAVE_TIME})`;

    const dry = Math.max(0, game.dryness);
    this.dry.textContent = `${Math.ceil(dry)}%`;
    this.dryFill.style.transform = `scaleX(${dry / 100})`;
    this.dryFill.dataset.low = String(dry < 30);

    const s = game.stance;
    this.armor.hidden = !s.aura && game.vulnerable <= 0;
    if (game.vulnerable > 0) {
      this.armor.textContent = `Vulnerable ${game.vulnerable.toFixed(1)}s`;
      this.armor.dataset.state = 'broken';
    } else if (s.aura) {
      this.armor.textContent = game.shieldUp ? 'Spirit armor' : `Armor reforms ${Math.ceil(game.shieldReform)}s`;
      this.armor.dataset.state = game.shieldUp ? 'up' : 'down';
    }

    const k = game.katana;
    const ready = k.ready;
    this.blade.dataset.ready = String(ready);
    this.blade.dataset.flame = String(s.flame);
    this.bladeFill.style.transform = `scaleX(${ready ? 1 : 1 - k.cooldown / k.cooldownLength})`;
    this.bladeTime.textContent = `${s.cooldown.toFixed(2)}s`;

    const cost = game.ninja.dashCost(s);
    this.stamina.style.transform = `scaleX(${game.ninja.stamina / 100})`;
    this.stamina.dataset.ready = String(game.ninja.stamina >= cost);
    this.dashCost.style.left = `${cost}%`;

    this.focus.hidden = !s.focus;
    this.focus.dataset.ready = String(game.focusReady);
    this.focusTime.textContent = game.focusReady ? 'Ready · F' : `${Math.ceil(game.focusCooldown)}s`;

    this.combo.textContent = game.combo >= 5 ? `${game.combo} cuts` : '';
  }
}
