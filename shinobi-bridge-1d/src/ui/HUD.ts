import type { Game, GameEvent } from '../core/Game.ts';
import { titleFor } from '../progression/LevelManager.ts';
import { FOCUS_CUT_COOLDOWN } from '../progression/StanceModifiers.ts';
import { DASH_COST, KICK_COOLDOWN, STAMINA_MAX } from '../warrior/WarriorController.ts';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The HUD set into the letterbox bars: rank and mastery, the weather front and the wave's time left,
 * robe dryness and the spirit shield above; the blade's rhythm, dash, kick, focus cut and any snow
 * slowing the stride below. Writes to the DOM only when a value changes.
 */
export class HUD {
  private readonly root = byId('hud');
  private readonly toast = byId('toast');
  private readonly el = {
    level: byId('hud-level'),
    title: byId('hud-title'),
    exp: byId('hud-exp'),
    front: byId('hud-front'),
    wave: byId('hud-wave'),
    waveFill: byId('hud-wave-fill'),
    dry: byId('hud-dry'),
    dryFill: byId('hud-dry-fill'),
    guard: byId('hud-guard'),
    blade: byId('m-blade'),
    bladeTime: byId('hud-blade-time'),
    bladeFill: byId('hud-blade-fill'),
    stamina: byId('hud-stamina-fill'),
    dashCost: byId('hud-dash-cost'),
    kick: byId('m-kick'),
    kickFill: byId('hud-kick-fill'),
    focus: byId('m-focus'),
    focusTime: byId('hud-focus-time'),
    focusFill: byId('hud-focus-fill'),
    snow: byId('m-snow'),
    combo: byId('hud-combo'),
  };
  private readonly last = new Map<string, string>();
  private toastTimer = 0;

  constructor() {
    this.el.dashCost.style.left = `${(DASH_COST / STAMINA_MAX) * 100}%`;
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.toast.classList.remove('show');
  }

  private text(key: keyof HUD['el'], value: string): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    this.el[key].textContent = value;
  }

  private fill(key: keyof HUD['el'], fraction: number): void {
    const v = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(3)})`;
    if (this.last.get(key) === v) return;
    this.last.set(key, v);
    this.el[key].style.transform = v;
  }

  private data(key: keyof HUD['el'], name: string, value: string): void {
    const k = `${key}.${name}`;
    if (this.last.get(k) === value) return;
    this.last.set(k, value);
    this.el[key].dataset[name] = value;
  }

  private show(key: keyof HUD['el'], on: boolean): void {
    if (this.el[key].hidden === !on) return;
    this.el[key].hidden = !on;
  }

  say(main: string, sub = '', tone = '', ms = 2600): void {
    this.toast.replaceChildren();
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
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), ms);
  }

  handleEvent(e: GameEvent, _game: Game): void {
    switch (e.type) {
      case 'wave':
        this.say(`Wave ${e.wave}`, `${e.name} · ${clock(e.duration)}`, '', 3200);
        break;
      case 'front':
        this.say(e.name, 'The front shifts', 'small', 2000);
        break;
      case 'clear':
        this.say('The storm draws breath', e.repaired > 0 ? `+${e.exp} mastery · ${e.repaired} planks re-lashed` : `+${e.exp} mastery`, '', 3000);
        break;
      case 'levelup':
        this.say(`Level ${e.level}`, e.perk ?? titleFor(e.level), e.perk ? 'perk' : '', 3000);
        break;
      default:
        break;
    }
  }

  update(game: Game): void {
    const lv = game.levels;
    this.text('level', String(lv.level));
    this.text('title', titleFor(lv.level));
    this.fill('exp', lv.progress);

    const w = game.waves;
    if (w.t < 0) {
      this.text('front', 'The storm draws breath');
      this.text('wave', `Wave ${w.wave} in ${Math.ceil(-w.t)}`);
      this.fill('waveFill', 0);
    } else {
      this.text('front', w.frontNow || w.title);
      this.text('wave', `Wave ${w.wave} · ${clock(w.duration - w.t)}`);
      this.fill('waveFill', 1 - w.t / w.duration);
    }

    const dry = Math.max(0, game.dryness);
    this.text('dry', `${Math.ceil(dry)}%`);
    this.fill('dryFill', dry / 100);
    this.data('dryFill', 'low', String(dry < 30));

    const s = game.stance;
    if (game.vulnerable > 0) {
      this.text('guard', `Vulnerable ${game.vulnerable.toFixed(1)}s`);
      this.data('guard', 'state', 'broken');
    } else if (s.aura) {
      this.text('guard', game.shieldUp ? 'Spirit shield' : `Shield reforms ${Math.ceil(game.shieldReform)}s`);
      this.data('guard', 'state', game.shieldUp ? 'up' : 'down');
    } else {
      this.text('guard', '');
    }

    const k = game.katana;
    const state = game.exposed ? 'exposed' : k.ready ? 'ready' : 'recovering';
    this.data('blade', 'state', state);
    this.data('blade', 'flame', String(s.flame));
    this.text('bladeTime', state === 'exposed' ? 'Exposed' : k.ready ? `${s.cooldown.toFixed(2)}s` : `${k.cooldown.toFixed(2)}s`);
    this.fill('bladeFill', k.ready ? 1 : 1 - k.cooldown / k.cooldownLength);

    const wr = game.warrior;
    this.fill('stamina', wr.stamina / STAMINA_MAX);
    this.data('stamina', 'ready', String(wr.stamina >= DASH_COST && !game.exposed));
    this.fill('kickFill', 1 - wr.kickCooldown / KICK_COOLDOWN);
    this.data('kick', 'ready', String(wr.kickCooldown <= 0 && !game.exposed));

    this.show('focus', s.focus);
    if (s.focus) {
      this.text('focusTime', game.focusReady ? 'Ready · F' : `${Math.ceil(game.focusCooldown)}s`);
      this.fill('focusFill', 1 - game.focusCooldown / FOCUS_CUT_COOLDOWN);
      this.data('focus', 'ready', String(game.focusReady));
    }

    const slowed = wr.snowSlow < 0.95;
    this.show('snow', slowed);
    if (slowed) this.text('snow', `Snowbound −${Math.round((1 - wr.snowSlow) * 100)}%`);

    this.text('combo', game.combo >= 8 ? `${game.combo} cuts` : '');
  }
}
