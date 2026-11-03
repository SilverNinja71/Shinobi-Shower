import type { Perk } from '../progression/StanceModifiers.ts';

const KEY = 'shinobibridge.progress';

export interface SaveData {
  level: number;
  exp: number;
  /** Unlocked stances the player has switched off. */
  disabled: Perk[];
  bestWave: number;
  bestTime: number;
}

const FRESH: SaveData = { level: 1, exp: 0, disabled: [], bestWave: 0, bestTime: 0 };

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
