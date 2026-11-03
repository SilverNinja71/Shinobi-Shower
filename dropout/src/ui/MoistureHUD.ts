import { CYCLES, SHOWER_LENGTH, cycleIndexAt } from '../core/GameLoop.ts';
import type { GameEvent, GameLoop } from '../core/GameLoop.ts';
import { DASH_COOLDOWN } from '../player/PlayerController.ts';
import type { Surface } from '../player/FloorInteraction.ts';

const SURFACE_LABELS: Record<Surface, string> = {
  dry: 'Dry tile: full grip, drying off',
  wet: 'Wet tile: sliding',
  soapy: 'Soapy tile: no grip',
};

const TOAST_TIME = 1.6;

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The DOM overlay. Writes only values that changed, to avoid needless layout. */
export class MoistureHUD {
  private readonly root = byId('hud');
  private readonly soapBar = byId('soap-bar');
  private readonly water = byId('soap-water');
  private readonly moisture = byId('moisture-value');
  private readonly timer = byId('timer');
  private readonly cycle = byId('cycle-name');
  private readonly segments = Array.from(document.querySelectorAll<HTMLElement>('.cycle-seg > i'));
  private readonly mercury = byId('mercury');
  private readonly degrees = byId('degrees');
  private readonly score = byId('score');
  private readonly surface = byId('surface');
  private readonly dashFill = byId('dash-fill');
  private readonly mash = byId('mash');
  private readonly mashCount = byId('mash-count');
  private readonly toast = byId('toast');
  private toastLeft = 0;
  private last = new Map<HTMLElement, string>();

  private text(el: HTMLElement, value: string): void {
    if (this.last.get(el) !== value) {
      this.last.set(el, value);
      el.textContent = value;
    }
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  say(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
    this.toastLeft = TOAST_TIME;
  }

  handleEvent(e: GameEvent): void {
    if (e.type === 'closeShave') this.say('Close shave +100');
    if (e.type === 'cycle') this.say(CYCLES[e.size].name);
    if (e.type === 'encase') this.say('Soap bubble! Burst it before the drain');
  }

  update(dt: number, game: GameLoop): void {
    const m = game.moisture.value;
    this.text(this.moisture, `${Math.floor(m)}%`);
    // The bar of soap wears down and fills with water as he gets wetter.
    this.soapBar.style.transform = `scale(${(1 - (m / 100) * 0.42).toFixed(3)})`;
    this.water.style.transform = `scaleY(${(m / 100).toFixed(3)})`;
    this.root.classList.toggle('danger', m >= 70);

    this.text(this.timer, clock(SHOWER_LENGTH - game.time));
    const index = cycleIndexAt(game.time);
    this.text(this.cycle, CYCLES[index].name);
    CYCLES.forEach((c, i) => {
      const end = i + 1 < CYCLES.length ? CYCLES[i + 1].start : SHOWER_LENGTH;
      const fill = Math.max(0, Math.min(1, (game.time - c.start) / (end - c.start)));
      this.segments[i].style.transform = `scaleX(${fill.toFixed(3)})`;
    });

    const heat = Math.max(0, Math.min(1, (game.heat - 30) / 25));
    this.mercury.style.transform = `scaleY(${heat.toFixed(3)})`;
    this.text(this.degrees, `${Math.round(game.heat)}°C`);
    this.text(this.score, Math.floor(game.score).toLocaleString('en-US'));

    this.text(this.surface, SURFACE_LABELS[game.surface]);
    if (this.surface.dataset.kind !== game.surface) this.surface.dataset.kind = game.surface;
    this.dashFill.style.transform = `scaleX(${(1 - game.player.dashCooldown / DASH_COOLDOWN).toFixed(3)})`;

    const p = game.player;
    this.mash.hidden = !p.encased;
    if (p.encased) this.text(this.mashCount, String(Math.max(1, p.mashLeft)));

    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toast.classList.remove('show');
    }
  }
}
