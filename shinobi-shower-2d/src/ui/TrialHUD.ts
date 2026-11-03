import type { GameEvent, TrialGame } from '../core/TrialGame.ts';

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** The DOM overlay: the robe's dryness, the time and stage, and the blade's state. */
export class TrialHUD {
  private readonly root = byId('hud');
  private readonly fill = byId('dry-fill');
  private readonly percent = byId('dry-value');
  private readonly stains = byId('stains');
  private readonly time = byId('time');
  private readonly stage = byId('stage-name');
  private readonly stagePips = Array.from(document.querySelectorAll<HTMLElement>('.stage-pip'));
  private readonly focus = byId('focus-fill');
  private readonly dash = byId('dash-pip');
  private readonly toast = byId('toast');

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  say(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }

  handleEvent(e: GameEvent, game: TrialGame): void {
    if (e.type === 'stage') this.say(game.level.stages[e.value].name);
    if (e.type === 'flood') this.say('Into the basin. Back to the last ledge');
  }

  update(game: TrialGame): void {
    const d = game.dryness;
    this.fill.style.transform = `scaleX(${(d / 100).toFixed(3)})`;
    this.percent.textContent = game.hardcore ? 'One drop' : `${Math.ceil(d)}%`;
    this.root.classList.toggle('low', d <= 30);
    this.stains.textContent = game.stains === 0 ? 'Spotless' : `${game.stains} ${game.stains === 1 ? 'stain' : 'stains'}`;
    this.time.textContent = clock(game.elapsed);
    this.stage.textContent = game.level.stages[game.stage].name;
    this.stagePips.forEach((p, i) => p.classList.toggle('on', i <= game.stage));
    this.focus.style.transform = `scaleX(${game.blade.fraction.toFixed(3)})`;
    this.dash.classList.toggle('on', game.ninja.grounded || game.ninja.airDashes > 0);
  }
}
