import type { Perk } from '../progression/StanceModifiers.ts';

const KEY = 'shinobibridge.progress';

export interface SaveData {
  level: number;
  exp: number;
  /** Unlocked stances the player has switched off. */
  disabled: Perk[];
  bestWave: number;
  bestTime: number;
  /** Total times the warrior has fallen in battle. */
  deaths: number;
  /** Explicit unlock flag for the hidden sandbox. */
  sandboxUnlocked?: boolean;
}

const FRESH: SaveData = { level: 1, exp: 0, disabled: [], bestWave: 0, bestTime: 0, deaths: 0, sandboxUnlocked: false };

/** Returns true if the player has unlocked the secret sandbox (>100 deaths or explicit unlock). */
export function isSandboxUnlocked(save: SaveData): boolean {
  return (save.deaths || 0) > 100 || !!save.sandboxUnlocked;
}

/** Progress lives in this browser only. Storage can be blocked; then it lasts for the visit. */
export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...FRESH, ...(JSON.parse(raw) as Partial<SaveData>) };
  } catch {
    // Unreadable or blocked: start fresh.
  }
  return { ...FRESH };
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Not fatal.
  }
}
