import type { DropKind } from '../engine/DropletPhysics.ts';

/** The base time from one slash to the next, before any stance changes it. */
export const BASE_COOLDOWN = 0.35;
export const FOCUS_CUT_COOLDOWN = 45;
export const VULNERABLE_TIME = 3;
export const SHIELD_REFORM_TIME = 12;

export type Perk = 'dual' | 'aura' | 'flame' | 'triple' | 'focus';

export interface PerkInfo {
  id: Perk;
  level: number;
  name: string;
  perk: string;
  cost: string;
}

/** Each stance unlocks at a fixed level and always brings its trade-off with it. */
export const PERKS: readonly PerkInfo[] = [
  { id: 'dual', level: 10, name: 'Dual-Wield Stance', perk: 'Slash arc 35% wider', cost: 'Run speed −10%' },
  { id: 'aura', level: 20, name: 'Spirit Armor', perk: 'Drizzle and rain do 80% less', cost: 'Hail shatters it: +50% damage for 3s' },
  { id: 'flame', level: 30, name: 'Flame-Wreathed Edge', perk: 'Each cut bursts into steam, clearing drops nearby', cost: 'Blade cooldown +25%' },
  { id: 'triple', level: 40, name: 'Triple-Blade Stance', perk: 'Cuts left and right at once', cost: 'Run speed −10% more, dash costs double' },
  { id: 'focus', level: 50, name: 'Focus Cut', perk: 'F: one cut across the whole sky', cost: 'Once every 45 seconds' },
];

export interface Stance {
  level: number;
  dual: boolean;
  aura: boolean;
  flame: boolean;
  triple: boolean;
  focus: boolean;
  /** Horizontal reach multiplier for the slash arc. */
  arcMul: number;
  speedMul: number;
  cooldown: number;
  dashCostMul: number;
  /** Cosmetic tier 1 to 5. */
  tier: number;
}

export function unlocked(level: number): PerkInfo[] {
  return PERKS.filter((p) => level >= p.level);
}

export function tierFor(level: number): number {
  if (level >= 50) return 5;
  if (level >= 30) return 4;
  if (level >= 20) return 3;
  if (level >= 10) return 2;
  return 1;
}

/** A player may set aside an unlocked stance to avoid its trade-off. */
export function stanceFor(level: number, disabled: ReadonlySet<Perk> = new Set()): Stance {
  const has = (id: Perk) => unlocked(level).some((p) => p.id === id) && !disabled.has(id);
  const dual = has('dual');
  const triple = has('triple');
  const flame = has('flame');
  return {
    level,
    dual,
    aura: has('aura'),
    flame,
    triple,
    focus: has('focus'),
    arcMul: dual ? 1.35 : 1,
    speedMul: 1 - (dual ? 0.1 : 0) - (triple ? 0.1 : 0),
    cooldown: BASE_COOLDOWN * (flame ? 1.25 : 1),
    dashCostMul: triple ? 2 : 1,
    tier: tierFor(level),
  };
}

export interface Guard {
  shieldUp: boolean;
  vulnerable: number;
}

/** The dryness a hit costs, and whether it breaks the spirit armor. */
export function incomingDamage(kind: DropKind, base: number, stance: Stance, guard: Guard): { damage: number; shatter: boolean } {
  let damage = base;
  let shatter = false;
  if (stance.aura && guard.shieldUp) {
    if (kind === 'drizzle' || kind === 'rain') damage *= 0.2;
    if (kind === 'hail') shatter = true;
  }
  if (guard.vulnerable > 0) damage *= 1.5;
  return { damage, shatter };
}
