import type { Game } from '../core/Game.ts';
import type { SaveData } from '../core/Save.ts';
import { isSandboxUnlocked } from '../core/Save.ts';

export interface SandboxPanelHandlers {
  onNotify?(msg: string, sub?: string): void;
}

export class SandboxPanel {
  private readonly game: Game;
  private readonly save: SaveData;
  private readonly handlers: SandboxPanelHandlers;
  private container!: HTMLElement;
  private toggleBtn!: HTMLButtonElement;
  private isOpen = false;
  private unlocked = false;

  constructor(game: Game, save: SaveData, handlers: SandboxPanelHandlers = {}) {
    this.game = game;
    this.save = save;
    this.handlers = handlers;
    this.unlocked = isSandboxUnlocked(save);
    this.mount();
    this.bindKeys();
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  setUnlocked(on: boolean): void {
    this.unlocked = on;
    this.toggleBtn.hidden = !on;
  }

  private mount(): void {
    // Inject CSS for Sandbox
    const style = document.createElement('style');
    style.textContent = `
      #sandbox-toggle {
        position: fixed;
        left: var(--gutter-l, 16px);
        bottom: calc(var(--bar, 60px) + env(safe-area-inset-bottom, 0px) + 12px);
        z-index: 50;
        background: linear-gradient(135deg, rgba(216, 180, 90, 0.95), rgba(255, 154, 74, 0.95));
        color: #120a04;
        font: 700 11px/1 "Azeret Mono", ui-monospace, monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        border: none;
        padding: 8px 14px;
        border-radius: 4px;
        cursor: pointer;
        box-shadow: 0 0 16px rgba(216, 180, 90, 0.4), 0 2px 8px rgba(0,0,0,0.6);
        transition: transform 0.15s, box-shadow 0.15s;
        display: none;
        align-items: center;
        gap: 6px;
      }
      body.playing #sandbox-toggle {
        display: flex;
      }
      #sandbox-toggle:hover {
        transform: translateY(-2px);
        box-shadow: 0 0 24px rgba(255, 154, 74, 0.6), 0 4px 12px rgba(0,0,0,0.8);
      }
      #sandbox-panel {
        position: fixed;
        right: var(--gutter-r, 16px);
        top: calc(var(--bar, 60px) + env(safe-area-inset-top, 0px) + 12px);
        bottom: calc(var(--bar, 60px) + env(safe-area-inset-bottom, 0px) + 12px);
        width: min(380px, 92vw);
        background: rgba(6, 8, 14, 0.94);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(216, 180, 90, 0.35);
        border-radius: 8px;
        z-index: 55;
        display: flex;
        flex-direction: column;
        color: #e9e4d8;
        font-family: "Zen Kaku Gothic New", system-ui, sans-serif;
        box-shadow: 0 12px 40px rgba(0,0,0,0.85), 0 0 30px rgba(216, 180, 90, 0.12);
        overflow: hidden;
      }
      #sandbox-panel[hidden] {
        display: none !important;
      }
      .sb-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        background: rgba(216, 180, 90, 0.08);
        border-bottom: 1px solid rgba(216, 180, 90, 0.2);
      }
      .sb-title {
        font: 700 15px/1.2 "Zen Antique", serif;
        color: #d8b45a;
        letter-spacing: 0.08em;
      }
      .sb-subtitle {
        font: 600 10px/1 "Azeret Mono", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #8f97a8;
        margin-top: 4px;
      }
      .sb-close {
        background: transparent;
        border: 1px solid rgba(255,255,255,0.15);
        color: #e9e4d8;
        width: 28px;
        height: 28px;
        border-radius: 4px;
        cursor: pointer;
        display: grid;
        place-content: center;
        font: 14px monospace;
      }
      .sb-close:hover {
        border-color: #d8b45a;
        color: #d8b45a;
      }
      .sb-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .sb-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .sb-sec-title {
        font: 600 10px/1 "Azeret Mono", monospace;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #d8b45a;
        margin-bottom: 2px;
      }
      .sb-grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .sb-grid-3 {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
      }
      .sb-btn {
        background: rgba(143, 151, 168, 0.12);
        border: 1px solid rgba(143, 151, 168, 0.25);
        color: #e9e4d8;
        padding: 8px 10px;
        border-radius: 4px;
        font: 500 11px/1.2 "Zen Kaku Gothic New", sans-serif;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
      }
      .sb-btn:hover {
        background: rgba(216, 180, 90, 0.18);
        border-color: #d8b45a;
      }
      .sb-btn.primary {
        background: rgba(255, 154, 74, 0.2);
        border-color: #ff9a4a;
        color: #ffb173;
        font-weight: 700;
      }
      .sb-btn.primary:hover {
        background: rgba(255, 154, 74, 0.35);
      }
      .sb-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(143, 151, 168, 0.08);
        border: 1px solid rgba(143, 151, 168, 0.18);
        padding: 7px 10px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        user-select: none;
      }
      .sb-toggle:hover {
        border-color: rgba(216, 180, 90, 0.4);
      }
      .sb-toggle input {
        accent-color: #d8b45a;
        width: 16px;
        height: 16px;
      }
      .sb-badge {
        font: 700 9px/1 "Azeret Mono", monospace;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 2px 5px;
        border-radius: 2px;
        background: #2a3342;
        color: #8f97a8;
      }
      .sb-badge.on {
        background: #d8b45a;
        color: #120a04;
      }
    `;
    document.head.appendChild(style);

    // Toggle button
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'sandbox-toggle';
    this.toggleBtn.type = 'button';
    this.toggleBtn.innerHTML = '<span>⛩️</span><span>Sandbox</span>';
    this.toggleBtn.hidden = !this.unlocked;
    this.toggleBtn.addEventListener('click', () => this.toggle());
    document.body.appendChild(this.toggleBtn);

    // Panel Window
    this.container = document.createElement('div');
    this.container.id = 'sandbox-panel';
    this.container.hidden = true;
    this.container.innerHTML = `
      <div class="sb-header">
        <div>
          <div class="sb-title">⛩️ Ascendant Sandbox</div>
          <div class="sb-subtitle">Divine Realm & Storm Architect</div>
        </div>
        <button class="sb-close" type="button" aria-label="Close Sandbox">✕</button>
      </div>
      <div class="sb-body">
        <!-- God Mode / Powers -->
        <div class="sb-section">
          <div class="sb-sec-title">Shinobi Mastery</div>
          <label class="sb-toggle">
            <span>🛡️ God Mode (Immortal)</span>
            <input type="checkbox" id="sb-opt-god">
          </label>
          <label class="sb-toggle">
            <span>⚡ Infinite Dash Stamina</span>
            <input type="checkbox" id="sb-opt-stamina">
          </label>
          <label class="sb-toggle">
            <span>🗡️ Rapid Katana (0.05s)</span>
            <input type="checkbox" id="sb-opt-rapid">
          </label>
          <label class="sb-toggle">
            <span>🔥 Permanent Flame Blade</span>
            <input type="checkbox" id="sb-opt-flame">
          </label>
          <label class="sb-toggle">
            <span>🪽 Celestial Light Blade</span>
            <input type="checkbox" id="sb-opt-light">
          </label>
          <button id="sb-act-focus" class="sb-btn primary" type="button">⚡ Instant Sky Focus Cut</button>
        </div>

        <!-- Storm & Weather -->
        <div class="sb-section">
          <div class="sb-sec-title">Storm & Elements</div>
          <div class="sb-grid-2">
            <button id="sb-weather-clear" class="sb-btn" type="button">☀️ Clear Sky</button>
            <button id="sb-weather-lightning" class="sb-btn" type="button">⚡ Lightning Bolt</button>
            <button id="sb-weather-mist" class="sb-btn" type="button">🌧️ Gentle Mist</button>
            <button id="sb-weather-storm" class="sb-btn" type="button">🌊 Downpour</button>
            <button id="sb-weather-hail" class="sb-btn" type="button">❄️ Hail Barrage</button>
            <button id="sb-weather-blizzard" class="sb-btn" type="button">🌨️ Blizzard</button>
          </div>
          <div class="sb-sec-title" style="margin-top: 6px;">Simulation Speed</div>
          <div class="sb-grid-3">
            <button data-speed="0.25" class="sb-btn sb-speed" type="button">0.25x</button>
            <button data-speed="1.0" class="sb-btn sb-speed primary" type="button">1.0x</button>
            <button data-speed="2.0" class="sb-btn sb-speed" type="button">2.0x</button>
          </div>
        </div>

        <!-- Bridge & Environment -->
        <div class="sb-section">
          <div class="sb-sec-title">Bridge & Environment</div>
          <div class="sb-grid-2">
            <button id="sb-deck-repair" class="sb-btn" type="button">🔨 Repair All Planks</button>
            <button id="sb-deck-break" class="sb-btn" type="button">💥 Shatter Planks</button>
            <button id="sb-snow-clear" class="sb-btn" type="button">🧹 Sweep Snow</button>
            <button id="sb-snow-fill" class="sb-btn" type="button">❄️ Deep Drift</button>
          </div>
        </div>

        <!-- Progress Warping -->
        <div class="sb-section">
          <div class="sb-sec-title">Wave & Level Warp</div>
          <div class="sb-grid-3">
            <button data-wave="1" class="sb-btn sb-wave" type="button">Wave 1</button>
            <button data-wave="10" class="sb-btn sb-wave" type="button">Wave 10</button>
            <button data-wave="25" class="sb-btn sb-wave" type="button">Wave 25</button>
            <button data-wave="40" class="sb-btn sb-wave" type="button">Wave 40</button>
            <button data-wave="50" class="sb-btn sb-wave primary" type="button">Wave 50</button>
            <button id="sb-lvl-50" class="sb-btn primary" type="button">Level 50</button>
          </div>
        </div>

        <!-- Mythological Realm & Cleave -->
        <div class="sb-section">
          <div class="sb-sec-title">Mythological & Cutscenes</div>
          <button id="sb-cleave" class="sb-btn primary" type="button">⚛️ Trigger Atomic Cleave</button>
          <div class="sb-grid-2">
            <button id="sb-warp-celestial" class="sb-btn" type="button">☁️ Warp: Heaven</button>
            <button id="sb-warp-peak" class="sb-btn" type="button">🌉 Warp: Peak</button>
            <button id="sb-spawn-imp" class="sb-btn" type="button">😈 Spawn Imp</button>
            <button id="sb-spawn-drake" class="sb-btn" type="button">🦇 Spawn Drake</button>
          </div>
          <button id="sb-spawn-angel" class="sb-btn" type="button">🪽 Summon Seraph Angel</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.container);

    this.bindEvents();
  }

  private bindEvents(): void {
    const el = this.container;
    const closeBtn = el.querySelector('.sb-close') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => this.close());

    // Toggles
    const godCb = el.querySelector('#sb-opt-god') as HTMLInputElement;
    godCb.addEventListener('change', () => {
      this.game.sandbox.active = true;
      this.game.sandbox.godMode = godCb.checked;
      if (godCb.checked) this.game.dryness = 100;
      this.notify(godCb.checked ? 'God Mode Enabled' : 'God Mode Disabled');
    });

    const staminaCb = el.querySelector('#sb-opt-stamina') as HTMLInputElement;
    staminaCb.addEventListener('change', () => {
      this.game.sandbox.active = true;
      this.game.sandbox.infiniteStamina = staminaCb.checked;
      this.notify(staminaCb.checked ? 'Infinite Stamina Active' : 'Infinite Stamina Off');
    });

    const rapidCb = el.querySelector('#sb-opt-rapid') as HTMLInputElement;
    rapidCb.addEventListener('change', () => {
      this.game.sandbox.active = true;
      this.game.sandbox.rapidSlash = rapidCb.checked;
      this.notify(rapidCb.checked ? 'Rapid Katana Active (0.05s)' : 'Standard Blade Rhythm');
    });

    const flameCb = el.querySelector('#sb-opt-flame') as HTMLInputElement;
    flameCb.addEventListener('change', () => {
      this.game.sandbox.active = true;
      this.game.sandbox.flameBlade = flameCb.checked;
      this.game.stance.flame = flameCb.checked;
      this.notify(flameCb.checked ? 'Flame Blade Ignited' : 'Flame Extinguished');
    });

    const lightCb = el.querySelector('#sb-opt-light') as HTMLInputElement;
    lightCb.addEventListener('change', () => {
      this.game.sandbox.active = true;
      this.game.sandbox.lightBlade = lightCb.checked;
      this.game.celestial.lightBladeTimer = lightCb.checked ? 9999 : 0;
      this.notify(lightCb.checked ? 'Celestial Light Blade Active' : 'Light Blade Expired');
    });

    // Instant actions
    el.querySelector('#sb-act-focus')?.addEventListener('click', () => {
      this.game.focusCut();
      this.notify('Focus Cut: Sky Cleared!');
    });

    el.querySelector('#sb-weather-clear')?.addEventListener('click', () => {
      this.game.clearStorm();
      this.notify('Sky Cleared of All Storm Elements');
    });

    el.querySelector('#sb-weather-lightning')?.addEventListener('click', () => {
      this.game.storm.triggerLightning(this.game.warrior.x);
      this.game.events.push({ type: 'lightning', x: this.game.warrior.x, power: 1.5 });
      this.notify('Lightning Strike Summoned');
    });

    el.querySelector('#sb-weather-mist')?.addEventListener('click', () => {
      this.game.clearStorm();
      this.game.waves.weights.rain = 1.0;
      this.game.waves.weights.hail = 0;
      this.game.waves.weights.snow = 0;
      this.game.waves.intensity = 0.6;
      this.notify('Weather: Gentle Rain Mist');
    });

    el.querySelector('#sb-weather-storm')?.addEventListener('click', () => {
      this.game.waves.weights.rain = 2.5;
      this.game.waves.intensity = 1.8;
      this.notify('Weather: Torrential Downpour');
    });

    el.querySelector('#sb-weather-hail')?.addEventListener('click', () => {
      this.game.waves.weights.hail = 2.0;
      this.game.waves.intensity = 1.5;
      for (let i = 0; i < 8; i++) {
        this.game.spawn('hail', this.game.warrior.x + (Math.random() * 12 - 6), 6 + Math.random() * 3, 0.08);
      }
      this.notify('Weather: Hail Barrage');
    });

    el.querySelector('#sb-weather-blizzard')?.addEventListener('click', () => {
      this.game.waves.weights.snow = 3.0;
      this.game.waves.intensity = 2.0;
      this.notify('Weather: Mountain Blizzard');
    });

    // Speed buttons
    el.querySelectorAll('.sb-speed').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.sb-speed').forEach((b) => b.classList.remove('primary'));
        btn.classList.add('primary');
        const sp = Number((btn as HTMLElement).dataset.speed || 1.0);
        this.game.sandbox.timeScale = sp;
        this.notify(`Game Speed: ${sp}x`);
      });
    });

    // Bridge actions
    el.querySelector('#sb-deck-repair')?.addEventListener('click', () => {
      this.game.repairBridge();
      this.notify('Suspension Bridge Fully Repaired');
    });

    el.querySelector('#sb-deck-break')?.addEventListener('click', () => {
      this.game.breakRandomPlanks(5);
      this.notify('Planks Shattered');
    });

    el.querySelector('#sb-snow-clear')?.addEventListener('click', () => {
      this.game.clearSnow();
      this.notify('Snow Drifts Swept Clean');
    });

    el.querySelector('#sb-snow-fill')?.addEventListener('click', () => {
      this.game.fillSnow(0.4);
      this.notify('Deep Snowdrifts Created');
    });

    // Wave warps
    el.querySelectorAll('.sb-wave').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = Number((btn as HTMLElement).dataset.wave || 1);
        this.game.jumpWave(w);
        this.notify(`Warped to Wave ${w}`);
      });
    });

    el.querySelector('#sb-lvl-50')?.addEventListener('click', () => {
      this.game.levels.level = 50;
      this.game.levels.exp = 0;
      this.game.refreshStance();
      this.notify('Rank: Level 50 Apex Sovereign');
    });

    // Cutscene & Celestial
    el.querySelector('#sb-cleave')?.addEventListener('click', () => {
      this.game.triggerAtomicCleave();
      this.notify('Atomic Cleave Cutscene Initiated');
    });

    el.querySelector('#sb-warp-celestial')?.addEventListener('click', () => {
      this.game.warpToCelestial();
      this.notify('Warped to Celestial Cloud Sea');
    });

    el.querySelector('#sb-warp-peak')?.addEventListener('click', () => {
      this.game.warpToPeak();
      this.notify('Warped back to Precarious Peak Bridge');
    });

    el.querySelector('#sb-spawn-imp')?.addEventListener('click', () => {
      this.game.spawnDemon('imp');
      this.notify('Diving Imp Demon Spawned');
    });

    el.querySelector('#sb-spawn-drake')?.addEventListener('click', () => {
      this.game.spawnDemon('drake');
      this.notify('Armored Drake Archdemon Spawned');
    });

    el.querySelector('#sb-spawn-angel')?.addEventListener('click', () => {
      this.game.spawnAngel();
      this.notify('Seraphic Angel Summoned');
    });
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      // Backquote (tilde ~) or KeyB toggles sandbox when unlocked
      if ((e.code === 'Backquote' || e.code === 'KeyB') && !e.repeat && this.unlocked) {
        // Only toggle if not typing in an input
        if (document.activeElement?.tagName !== 'INPUT') {
          this.toggle();
        }
      }
    });
  }

  private notify(msg: string): void {
    if (this.handlers.onNotify) {
      this.handlers.onNotify(msg, '⛩️ SANDBOX CONTROL');
    }
  }

  open(): void {
    if (!this.unlocked) return;
    this.game.sandbox.active = true;
    this.isOpen = true;
    this.container.hidden = false;
    this.toggleBtn.classList.add('active');

    // Sync checkboxes with current game state
    const el = this.container;
    const godCb = el.querySelector('#sb-opt-god') as HTMLInputElement | null;
    if (godCb) godCb.checked = this.game.sandbox.godMode;
    const staminaCb = el.querySelector('#sb-opt-stamina') as HTMLInputElement | null;
    if (staminaCb) staminaCb.checked = this.game.sandbox.infiniteStamina;
    const rapidCb = el.querySelector('#sb-opt-rapid') as HTMLInputElement | null;
    if (rapidCb) rapidCb.checked = this.game.sandbox.rapidSlash;
    const flameCb = el.querySelector('#sb-opt-flame') as HTMLInputElement | null;
    if (flameCb) flameCb.checked = this.game.sandbox.flameBlade;
    const lightCb = el.querySelector('#sb-opt-light') as HTMLInputElement | null;
    if (lightCb) lightCb.checked = this.game.sandbox.lightBlade;
  }

  close(): void {
    this.isOpen = false;
    this.container.hidden = true;
    this.toggleBtn.classList.remove('active');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }
}
