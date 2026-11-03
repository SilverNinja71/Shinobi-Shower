import type { Game } from '../core/Game.ts';
import type { SaveData } from '../core/Save.ts';
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

const byId = (id: string) => document.getElementById(id);

/**
 * STUB (to be replaced): the loading, title, pause and game-over screens. Only the loading text and
 * a start button work here.
 */
export class Screens {
  constructor(handlers: ScreenHandlers) {
    byId('start')?.addEventListener('click', () => handlers.onStart());
  }
  showLoading(progress: number): void {
    const el = byId('loading');
    if (el) el.textContent = `Loading ${Math.round(progress * 100)}%`;
  }
  hideLoading(): void {
    const el = byId('loading');
    if (el) el.hidden = true;
  }
  showMenu(_game: Game, _save: SaveData): void {
    const m = byId('menu');
    if (m) m.hidden = false;
  }
  showPause(): void {}
  showOver(_game: Game, _save: SaveData): void {
    const m = byId('menu');
    if (m) m.hidden = false;
  }
  hideAll(): void {
    const m = byId('menu');
    if (m) m.hidden = true;
  }
  setMuted(_muted: boolean): void {}
  setPlaying(on: boolean): void {
    document.body.classList.toggle('playing', on);
  }
  setFocusAvailable(_on: boolean): void {}
  showError(message: string): void {
    const el = byId('loading');
    if (el) {
      el.hidden = false;
      el.textContent = message;
    }
  }
}
