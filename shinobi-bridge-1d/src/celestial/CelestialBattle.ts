import type { KatanaSlash } from '../warrior/KatanaSlash.ts';
import type { Stance } from '../progression/StanceModifiers.ts';
import type { WarriorController } from '../warrior/WarriorController.ts';

export type DemonKind = 'imp' | 'drake';

export interface Demon {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  kind: DemonKind;
  health: number;
  maxHealth: number;
  alive: boolean;
  radius: number;
  wingAngle: number;
  wingSpeed: number;
  t: number;
  swoopCooldown: number;
  /** True when the demon charges along the white-and-gold staircase to push the soldier down. */
  staircaseCharger?: boolean;
}

export interface Angel {
  id: number;
  x: number;
  y: number;
  z: number;
  vy: number;
  alive: boolean;
  blessed: boolean;
  radius: number;
  wingAngle: number;
  t: number;
}

export interface CelestialStats {
  wave: number;
  score: number;
  demonsSlain: number;
  angelsBlessed: number;
  angelsStruck: number;
  bestCombo: number;
}

export interface CelestialBattleEvent {
  type:
    | 'demon_spawn'
    | 'demon_slain'
    | 'demon_hit_warrior'
    | 'angel_spawn'
    | 'angel_bless'
    | 'angel_struck'
    | 'light_blade_start'
    | 'light_blade_end'
    | 'celestial_wave';
  id?: number;
  x?: number;
  y?: number;
  kind?: DemonKind;
  points?: number;
  wave?: number;
}

export const CLOUD_DECK_Y = 0;
export const ARENA_HALF_WIDTH = 24;
export const LIGHT_BLADE_DURATION = 12;
export const LIGHT_BLADE_REACH_MULTIPLIER = 1.5;

/**
 * Headless simulation of the Celestial Clash post-game mode.
 * Contains demons, angels, light blade buffs, and sword collision detection.
 */
export class CelestialBattle {
  active = false;
  time = 0;
  wave = 1;
  waveTimer = 0;
  demons: Demon[] = [];
  angels: Angel[] = [];
  events: CelestialBattleEvent[] = [];
  stats: CelestialStats = {
    wave: 1,
    score: 0,
    demonsSlain: 0,
    angelsBlessed: 0,
    angelsStruck: 0,
    bestCombo: 0,
  };

  lightBladeTimer = 0;
  holyBlindnessTimer = 0;
  private nextEntityId = 1;
  private spawnCooldown = 1.5;
  private angelCooldown = 4.0;

  start(_warriorX = 0): void {
    this.active = true;
    this.time = 0;
    this.wave = 1;
    this.waveTimer = 0;
    this.demons.length = 0;
    this.angels.length = 0;
    this.events.length = 0;
    this.lightBladeTimer = 0;
    this.holyBlindnessTimer = 0;
    this.nextEntityId = 1;
    this.spawnCooldown = 1.0;
    this.angelCooldown = 3.5;
    this.stats = {
      wave: 1,
      score: 0,
      demonsSlain: 0,
      angelsBlessed: 0,
      angelsStruck: 0,
      bestCombo: 0,
    };
    this.events.push({ type: 'celestial_wave', wave: 1 });
  }

  get lightBladeActive(): boolean {
    return this.lightBladeTimer > 0;
  }

  spawnDemon(kind: DemonKind, x?: number, y?: number): Demon {
    const id = this.nextEntityId++;
    const isDrake = kind === 'drake';
    // Half of auto-spawned demons emerge on the white-and-gold staircase to charge & push the soldier down!
    const isStairCharger = y === undefined && (id % 2 === 1);
    const posX = x ?? 18 + (Math.random() > 0.5 ? 1 : -1) * (8 + Math.random() * 6);
    const posY = y ?? (isStairCharger ? CLOUD_DECK_Y : 3.2 + Math.random() * 3.0);
    const demon: Demon = {
      id,
      x: posX,
      y: posY,
      z: (Math.random() - 0.5) * 0.8,
      vx: (Math.random() - 0.5) * 2,
      vy: isStairCharger ? 0 : -0.5,
      vz: 0,
      kind,
      health: isDrake ? 3 : 1,
      maxHealth: isDrake ? 3 : 1,
      alive: true,
      radius: isDrake ? 1.4 : 0.85,
      wingAngle: 0,
      wingSpeed: isDrake ? 6 : 10,
      t: 0,
      swoopCooldown: isStairCharger ? 0 : 1.0 + Math.random() * 2,
      staircaseCharger: isStairCharger,
    };
    this.demons.push(demon);
    this.events.push({ type: 'demon_spawn', id, x: demon.x, y: demon.y, kind });
    return demon;
  }

  spawnAngel(x?: number): Angel {
    const id = this.nextEntityId++;
    const posX = x ?? 18 + (Math.random() - 0.5) * 16;
    const angel: Angel = {
      id,
      x: posX,
      y: -2.5,
      z: 0,
      vy: 1.6 + Math.random() * 0.4,
      alive: true,
      blessed: false,
      radius: 1.1,
      wingAngle: 0,
      t: 0,
    };
    this.angels.push(angel);
    this.events.push({ type: 'angel_spawn', id, x: angel.x, y: angel.y });
    return angel;
  }

  update(
    dt: number,
    warrior: WarriorController,
    katana: KatanaSlash,
    stance: Stance,
    onDrynessChange?: (delta: number) => void
  ): void {
    if (!this.active) return;
    this.time += dt;
    this.waveTimer += dt;

    if (this.lightBladeTimer > 0) {
      this.lightBladeTimer -= dt;
      if (this.lightBladeTimer <= 0) {
        this.lightBladeTimer = 0;
        this.events.push({ type: 'light_blade_end' });
      }
    }

    if (this.holyBlindnessTimer > 0) {
      this.holyBlindnessTimer = Math.max(0, this.holyBlindnessTimer - dt);
    }

    // Wave progression every 30s or when enough demons slain
    if (this.waveTimer >= 30) {
      this.wave++;
      this.waveTimer = 0;
      this.events.push({ type: 'celestial_wave', wave: this.wave });
    }

    // Spawn demons
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0) {
      const maxDemons = 4 + Math.min(8, this.wave);
      if (this.demons.filter((d) => d.alive).length < maxDemons) {
        const pickDrake = this.wave >= 2 && Math.random() < 0.35;
        this.spawnDemon(pickDrake ? 'drake' : 'imp');
      }
      this.spawnCooldown = Math.max(0.8, 3.0 - this.wave * 0.2) + Math.random() * 0.8;
    }

    // Spawn angels
    this.angelCooldown -= dt;
    if (this.angelCooldown <= 0) {
      if (this.angels.filter((a) => a.alive).length < 2) {
        // Spawn near the warrior for exciting gameplay
        const offsetX = (Math.random() - 0.5) * 12;
        this.spawnAngel(Math.max(-ARENA_HALF_WIDTH + 2, Math.min(ARENA_HALF_WIDTH - 2, warrior.x + offsetX)));
      }
      this.angelCooldown = 6.0 + Math.random() * 5.0;
    }

    // Update demons
    for (const d of this.demons) {
      if (!d.alive) continue;
      d.t += dt;
      d.wingAngle += dt * d.wingSpeed;
      d.swoopCooldown -= dt;

      // Demon AI: Staircase chargers sprint up/along the white-and-gold staircase to push the soldier down;
      // aerial demons hover and swoop toward the soldier!
      const dx = warrior.x - d.x;
      const dy = CLOUD_DECK_Y + 0.8 - d.y;
      const dist = Math.hypot(dx, dy);

      if (d.staircaseCharger) {
        const speed = d.kind === 'drake' ? 5.8 : 7.2;
        const targetVx = Math.sign(dx || 1) * speed;
        d.vx += (targetVx - d.vx) * Math.min(1, dt * 8);
        d.y = CLOUD_DECK_Y;
        d.vy = 0;
      } else if (d.swoopCooldown <= 0) {
        // Dive phase
        const speed = d.kind === 'drake' ? 9.5 : 12.0;
        d.vx = (dx / (dist + 0.01)) * speed;
        d.vy = (dy / (dist + 0.01)) * speed;
        if (d.y <= CLOUD_DECK_Y + 0.5 || dist < 1.2) {
          // Pull up after swoop
          d.swoopCooldown = 2.0 + Math.random() * 1.5;
        }
      } else {
        // Hover/patrol phase
        const hoverTargetY = 4.2 + Math.sin(d.t * 2) * 1.2;
        d.vy += (hoverTargetY - d.y) * 2.0 * dt;
        d.vx += (Math.sign(dx) * 2.5 - d.vx) * 1.5 * dt;
      }

      d.x += d.vx * dt;
      d.y += d.vy * dt;

      // Clamp arena (keep compatible with both [-ARENA_HALF_WIDTH] tests and [0..36] lane play)
      if (d.x < -ARENA_HALF_WIDTH) {
        d.x = -ARENA_HALF_WIDTH;
        d.vx = Math.abs(d.vx);
      } else if (d.x > 36 + ARENA_HALF_WIDTH) {
        d.x = 36 + ARENA_HALF_WIDTH;
        d.vx = -Math.abs(d.vx);
      }
      if (d.y < CLOUD_DECK_Y) {
        d.y = CLOUD_DECK_Y;
        d.vy = d.staircaseCharger ? 0 : Math.abs(d.vy) * 0.8;
      }

      // Check collision with warrior (damage warrior & push the soldier down the staircase!)
      if (dist < d.radius + 0.65 && !warrior.invulnerable) {
        const damage = d.kind === 'drake' ? 18 : 12;
        onDrynessChange?.(-damage);
        this.events.push({ type: 'demon_hit_warrior', id: d.id, x: d.x, y: d.y, points: damage });
        // Push the warrior down the staircase!
        const pushDir = Math.sign(dx) || 1;
        warrior.vx = pushDir * 8.5;
        // Knock demon back briefly before charging again
        d.vx = -pushDir * 7.5;
        d.vy = d.staircaseCharger ? 0 : 5.5;
        d.swoopCooldown = 1.8;
      }
    }

    // Update angels
    for (const a of this.angels) {
      if (!a.alive) continue;
      a.t += dt;
      a.wingAngle += dt * 5.0;
      a.y += a.vy * dt;

      // Slight gentle horizontal drift
      a.x += Math.sin(a.t * 1.5) * 0.5 * dt;

      // Check proximity to warrior -> Angelic Blessing!
      const dx = warrior.x - a.x;
      const dy = CLOUD_DECK_Y + 1.2 - a.y;
      const dist = Math.hypot(dx, dy);

      if (!a.blessed && dist < 2.5 && a.y > CLOUD_DECK_Y - 0.5) {
        a.blessed = true;
        this.stats.angelsBlessed++;
        // Full heal + activate light blade
        onDrynessChange?.(100);
        this.lightBladeTimer = LIGHT_BLADE_DURATION;
        this.events.push({ type: 'angel_bless', id: a.id, x: a.x, y: a.y });
        this.events.push({ type: 'light_blade_start' });
      }

      // Despawn once flown far above
      if (a.y > 18) {
        a.alive = false;
      }
    }

    // Check Katana Slashes against Demons and Angels
    if (katana.cutting) {
      this.checkKatanaHits(warrior, katana, stance);
    }

    // Clean up dead entities
    this.demons = this.demons.filter((d) => d.alive);
    this.angels = this.angels.filter((a) => a.alive);
  }

  private checkKatanaHits(warrior: WarriorController, katana: KatanaSlash, stance: Stance): void {
    const reachMult = this.lightBladeActive ? LIGHT_BLADE_REACH_MULTIPLIER : 1.0;
    const arcs = katana.arcs(warrior.x, CLOUD_DECK_Y, stance);
    const damagePerHit = (this.lightBladeActive ? 2 : 1) + (stance.flame ? 1 : 0);
    const shoulderX = warrior.x;
    const shoulderY = CLOUD_DECK_Y + 1.5;
    const baseReach = katana.reach(stance) * reachMult;

    for (const rawArc of arcs) {
      // Scale arc reach if Light Blade is active
      const arcWidth = Math.abs(rawArc.x1 - rawArc.x0) * reachMult;
      const arcCenterX = rawArc.side > 0 ? warrior.x + arcWidth * 0.5 : warrior.x - arcWidth * 0.5;
      const arcX0 = arcCenterX - arcWidth * 0.5;
      const arcX1 = arcCenterX + arcWidth * 0.5;
      const arcY0 = rawArc.y0;
      const arcY1 = rawArc.y1 * (this.lightBladeActive ? 1.3 : 1.0);

      // Hit test against Demons
      for (const d of this.demons) {
        if (!d.alive) continue;
        const inBox = d.x + d.radius >= arcX0 && d.x - d.radius <= arcX1 && d.y + d.radius >= arcY0 && d.y - d.radius <= arcY1;

        // Radial cone check towards clicked direction
        const dx = d.x - shoulderX;
        const dy = d.y - shoulderY;
        const dist = Math.hypot(dx, dy);
        const inCone = dist <= baseReach + d.radius + 0.4 && (dx * rawArc.side) > -0.2 && Math.abs(Math.atan2(dy, Math.max(0.01, dx * rawArc.side)) - (katana.aimAngle ?? 0)) < 0.85;

        // Direct aim target test when clicked right on or near the demon
        const nearClick = katana.aimX !== null && katana.aimY !== null && Math.hypot(d.x - katana.aimX, d.y - katana.aimY) <= d.radius + 1.2 && dist <= baseReach + 1.2;

        if (inBox || inCone || nearClick) {
          d.health -= damagePerHit;
          // Knockback
          d.vx = rawArc.side * 7.0;
          d.vy = 4.0;
          if (d.health <= 0) {
            d.alive = false;
            this.stats.demonsSlain++;
            const points = (d.kind === 'drake' ? 300 : 100) * (this.lightBladeActive ? 2 : 1);
            this.stats.score += points;
            this.events.push({ type: 'demon_slain', id: d.id, x: d.x, y: d.y, points, kind: d.kind });
          }
        }
      }

      // Hit test against Angels (Accidental strike penalty!)
      for (const a of this.angels) {
        if (!a.alive) continue;
        const inBox = a.x + a.radius >= arcX0 && a.x - a.radius <= arcX1 && a.y + a.radius >= arcY0 && a.y - a.radius <= arcY1;
        const dx = a.x - shoulderX;
        const dy = a.y - shoulderY;
        const dist = Math.hypot(dx, dy);
        const inCone = dist <= baseReach + a.radius + 0.3 && (dx * rawArc.side) > -0.2 && Math.abs(Math.atan2(dy, Math.max(0.01, dx * rawArc.side)) - (katana.aimAngle ?? 0)) < 0.75;

        if (inBox || inCone) {
          // Player struck the angel!
          a.alive = false;
          this.stats.angelsStruck++;
          // Cancel light blade blessing
          this.lightBladeTimer = 0;
          // Trigger holy blindness flash penalty
          this.holyBlindnessTimer = 1.8;
          this.events.push({ type: 'angel_struck', id: a.id, x: a.x, y: a.y });
          this.events.push({ type: 'light_blade_end' });
        }
      }
    }
  }
}

