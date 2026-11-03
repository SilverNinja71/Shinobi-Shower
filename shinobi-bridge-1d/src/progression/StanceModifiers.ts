import type { DropKind } from '../weather/PrecipitationDroplet.ts';

/** The blade's strict rhythm, and the slower one a burning edge forces. */
export const BASE_COOLDOWN = 0.4;
export const FLAME_COOLDOWN = 0.55;
export const FOCUS_CUT_COOLDOWN = 45;
export const VULNERABLE_TIME = 3;
export const SHIELD_REFORM_TIME = 12;
/** Extra damage taken while recovering from a slash that cut nothing. */
export const EXPOSED_DAMAGE = 1.25;

export type Perk = 'dual' | 'aura' | 'flame' | 'triple' | 'focus';

export interface PerkInfo {
  id: Perk;
  level: number;
  name: string;
  perk: string;
  cost: string;
}

export const PERKS: readonly PerkInfo[] = [
  { id: 'dual', level: 10, name: 'Dual-Wield', perk: 'Slash radius +35%', cost: 'Movement −10%' },
  { id: 'aura', level: 20, name: 'Spirit Shield', perk: 'Drizzle and rain do 80% less', cost: 'A direct hail hit breaks it: +50% damage for 3s' },
  { id: 'flame', level: 30, name: 'Flame Edge', perk: 'Cuts vaporize snowdrifts and burst rain into steam', cost: 'Slash cooldown 0.55s' },
  { id: 'triple', level: 40, name: 'Triple-Blade Mastery', perk: 'Cuts left and right at once', cost: 'Movement −20%' },
  { id: 'focus', level: 50, name: 'Focus Cut', perk: 'F: one cut across the whole sky', cost: 'Once every 45 seconds' },
];

export interface Stance {
  level: number;
  dual: boolean;
  aura: boolean;
  flame: boolean;
  triple: boolean;
  focus: boolean;
  /** Slash reach multiplier. */
  arcMul: number;
  speedMul: number;
  cooldown: number;
  /** Cosmetic tier 1 to 5. */
  tier: number;
}

export function unlocked(level: number): PerkInfo[] {
  return PERKS.filter((p) => level >= p.level);
}

/** Tier 1: 1–9, 2: 10–19, 3: 20–29, 4: 30–39, 5: 40–50. */
export function tierFor(level: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor(level / 10)));
}

/**
 * The warrior's numbers at a level. Any unlocked stance can be set aside to drop its trade-off.
 * The triple-blade loadout's −20% is its total: it includes the two hand blades, so it replaces
 * dual-wield's −10% rather than stacking with it.
 */
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
    speedMul: triple ? 0.8 : dual ? 0.9 : 1,
    cooldown: flame ? FLAME_COOLDOWN : BASE_COOLDOWN,
    tier: tierFor(level),
  };
}

export interface Guard {
  shieldUp: boolean;
  vulnerable: number;
  exposed: boolean;
}

/** What a hit costs, and whether it breaks the spirit shield. */
export function incomingDamage(kind: DropKind, base: number, stance: Stance, guard: Guard): { damage: number; shatter: boolean } {
  let damage = base;
  let shatter = false;
  if (stance.aura && guard.shieldUp) {
    if (kind === 'drizzle' || kind === 'rain') damage *= 0.2;
    if (kind === 'hail') shatter = true;
  }
  if (guard.vulnerable > 0) damage *= 1.5;
  if (guard.exposed) damage *= EXPOSED_DAMAGE;
  return { damage, shatter };
}
