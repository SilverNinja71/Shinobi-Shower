export const MAX_LEVEL = 50;

/** Mastery from `level` to the next. Early levels come in a run or two; 50 takes real practice. */
export function expToNext(level: number): number {
  return Math.round(60 + 12 * Math.pow(level, 1.4));
}

export function totalExpFor(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += expToNext(l);
  return sum;
}

const TITLES: [number, string][] = [
  [40, 'Apex Sovereign'],
  [30, 'Ashen Warlord'],
  [20, 'Armored Kenshi'],
  [10, 'Dual Ronin'],
  [1, 'Wandering Exile'],
];

export function titleFor(level: number): string {
  return TITLES.find(([l]) => level >= l)![1];
}

export class LevelManager {
  level: number;
  /** Mastery toward the next level. */
  exp: number;

  constructor(level = 1, exp = 0) {
    this.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    this.exp = this.level >= MAX_LEVEL ? 0 : Math.max(0, exp);
  }

  /** Adds mastery; returns each level reached. */
  add(amount: number): number[] {
    const reached: number[] = [];
    if (this.level >= MAX_LEVEL) return reached;
    this.exp += amount;
    while (this.level < MAX_LEVEL && this.exp >= expToNext(this.level)) {
      this.exp -= expToNext(this.level);
      this.level++;
      reached.push(this.level);
    }
    if (this.level >= MAX_LEVEL) this.exp = 0;
    return reached;
  }

  get progress(): number {
    return this.level >= MAX_LEVEL ? 1 : this.exp / expToNext(this.level);
  }
}
