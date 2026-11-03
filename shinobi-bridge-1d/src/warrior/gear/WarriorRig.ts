import * as THREE from 'three';
import type { Game, GameEvent } from '../../core/Game.ts';
import { worldX } from '../../render/RenderContext.ts';
import type { RenderContext } from '../../render/RenderContext.ts';
import { ACTIVE, STARTUP, WAKE } from '../KatanaSlash.ts';
import { DASH_TIME, KICK_TIME, STUMBLE_TIME } from '../WarriorController.ts';
import { PROFILES } from '../../weather/PrecipitationDroplet.ts';
import { slashDescends } from './SlashArcs.ts';

/**
 * The Quaternius character driven by the simulation. Every clip's time is set from game state each
 * frame (stride for the run cycle, the dash timer for the roll, the katana's own clock for the
 * slash) instead of being left to free-run, so the pose always matches what the simulation is doing,
 * and a frozen simulation freezes the pose.
 *
 * Space: the model faces +z and its right hand is at −x. The side view turns it to ±x, three
 * quarters toward the camera, and mirrors it when it faces −x so the sword arm stays on the near side.
 */

export type BoneName =
  | 'root' | 'pelvis' | 'spine_01' | 'spine_02' | 'spine_03' | 'neck_01' | 'Head'
  | 'clavicle_l' | 'upperarm_l' | 'lowerarm_l' | 'hand_l'
  | 'clavicle_r' | 'upperarm_r' | 'lowerarm_r' | 'hand_r'
  | 'thigh_l' | 'calf_l' | 'foot_l' | 'thigh_r' | 'calf_r' | 'foot_r';

const BONES: BoneName[] = [
  'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
];

/** Tracks the slash layers keep: the spine from its middle up, the arms and the fingers. */
const UPPER_BODY = /^(spine_02|spine_03|neck_01|Head|clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;

/** How far the side view turns the warrior toward the camera from a pure profile. */
const THREE_QUARTER = 0.42;
/** Seconds to turn around. */
const TURN_TIME = 0.13;

/** Run cycles: ground speed each clip was authored at (m/s) and its natural cycles per second. */
const GAIT = {
  walk: { speed: 0.96, rate: 1 / 1.333 },
  jog: { speed: 5.7, rate: 1 / 0.933 },
  sprint: { speed: 6.7, rate: 1 / 0.667 },
};

/** Clip windows (seconds) mapped onto the simulation's timers. */
const ROLL_FROM = 0.2;
const ROLL_TO = 0.95;
/**
 * Sword_Regular_A's strike, in clip seconds. Its blade rises from low behind the warrior, through
 * the front, to overhead: [windup, blade low behind, blade level in front, blade overhead, end].
 * Played forward it is a rising cut; reversed, a falling one. The middle keys put the blade near
 * the crescent's leading edge (which sweeps evenly through 190°) at each point of the active frames.
 */
const STRIKE = [0.13, 0.21, 0.267, 0.4, 0.433];
/** Upper-body layer weight against the base pose (normalised blend: 7 means about 88%). */
const SLASH_WEIGHT = 7;

const IDENTITY = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Strips scale and stray translation tracks, and pins the pelvis over the feet (the game moves the body). */
function prepareClip(source: THREE.AnimationClip, pin: boolean): THREE.AnimationClip {
  const clip = source.clone();
  clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
  if (!pin) return clip;
  for (const t of clip.tracks) {
    if (t.name !== 'pelvis.position') continue;
    // In the armature's space z is up; x and y are the horizontal drift the simulation already moves.
    const v = t.values;
    let mx = 0;
    let my = 0;
    const n = v.length / 3;
    for (let i = 0; i < v.length; i += 3) {
      mx += v[i] / n;
      my += v[i + 1] / n;
    }
    for (let i = 0; i < v.length; i += 3) {
      v[i] = mx;
      v[i + 1] = my;
    }
  }
  return clip;
}

function upperBody(clip: THREE.AnimationClip): THREE.AnimationClip {
  const copy = clip.clone();
  copy.tracks = copy.tracks.filter((t) => UPPER_BODY.test(t.name) && t.name.endsWith('.quaternion'));
  return copy;
}

type BaseClip = 'idle' | 'walk' | 'jog' | 'sprint' | 'roll' | 'hit' | 'stumble' | 'death';
const BASE_CLIPS: readonly BaseClip[] = ['idle', 'walk', 'jog', 'sprint', 'roll', 'hit', 'stumble', 'death'];
const LOCOMOTION: readonly BaseClip[] = ['idle', 'walk', 'jog', 'sprint'];

export class WarriorRig {
  /** Placed on the deck each frame (position, deck roll and a little pitch). */
  readonly root = new THREE.Group();
  /** Turns and mirrors the model for the side view. */
  readonly pivot = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly bones = {} as Record<BoneName, THREE.Bone>;
  /** The body's skinned meshes by glTF material name: cloth, skin, head, eye, brow, hair. */
  readonly parts: Record<string, THREE.SkinnedMesh> = {};
  /** −1 or +1: which way the warrior is facing in the world right now (mid-turn it follows the mirror). */
  side = 1;
  /** Continuous turn, −1 (facing −x) to +1 (facing +x); 0 faces the camera. */
  private turn = 1;
  private readonly mixer: THREE.AnimationMixer;
  private readonly base = {} as Record<BaseClip, THREE.AnimationAction>;
  private readonly weights = {} as Record<BaseClip, number>;
  private readonly target = {} as Record<BaseClip, number>;
  private readonly slash: THREE.AnimationAction;
  private readonly flinch: THREE.AnimationAction;
  private gaitPhase = 0;
  private lastStride = 0;
  private idleTime = 0;
  private speed = 0;
  private rollT = 2;
  private rolling = false;
  private hitT = 1;
  private readonly hitLength = PROFILES.hail.stun;
  /** What the current stun is from, and how long it was when it began. */
  private stunKind: 'hit' | 'stumble' | null = null;
  private stunTotal = 1;
  private flinchT = 1;
  private stumbleT = 1;
  private deathT = 0;
  private dead = false;
  private slashWeight = 0;
  /** Seconds since the last slash's wake ended, for easing the arms back. */
  private slashAfter = 1;
  /** Kick progress 0–1 while kicking, else −1. */
  private kick = -1;
  private lean = 0;
  private readonly q = new THREE.Quaternion();
  // Scratch for the blade aim (no allocation per frame).
  private readonly invModel = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly aimAt = new THREE.Vector3(0, 1.5, 2);
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly cur = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly hq = new THREE.Quaternion();
  private readonly pq = new THREE.Quaternion();
  private readonly dq = new THREE.Quaternion();
  /**
   * Bones the procedural layer turns, and their clip pose from the last frame. The mixer only
   * writes a bone when its animated value changes, so without restoring these first a held pose
   * (a frozen simulation, a still idle track) would compound the kick, lean and aim every frame.
   */
  private readonly touched: THREE.Bone[] = [];
  private readonly clean: THREE.Quaternion[] = [];

  constructor(ctx: RenderContext) {
    const gltf = ctx.assets.character.body;
    this.model = gltf.scene;
    for (const name of BONES) {
      const bone = this.model.getObjectByName(name) as THREE.Bone | undefined;
      if (!bone) throw new Error(`Warrior rig has no bone ${name}`);
      this.bones[name] = bone;
    }
    const procedural: BoneName[] = ['spine_01', 'spine_02', 'neck_01', 'upperarm_l', 'hand_l', 'hand_r', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r', 'foot_r'];
    for (const name of procedural) {
      this.touched.push(this.bones[name]);
      this.clean.push(this.bones[name].quaternion.clone());
    }
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      this.parts[(mesh.material as THREE.Material).name] = mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Skinned bounds are the bind pose's; a roll or a lunge leaves them, so never cull the body.
      mesh.frustumCulled = false;
    });
    this.pivot.add(this.model);
    this.root.add(this.pivot);

    const clips = [...ctx.assets.character.anims.animations, ...ctx.assets.character.ninjaAnims.animations];
    const find = (name: string) => {
      const c = clips.find((k) => k.name === name);
      if (!c) throw new Error(`Warrior clip ${name} is missing`);
      return c;
    };
    this.mixer = new THREE.AnimationMixer(this.model);
    const action = (clip: THREE.AnimationClip) => {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.paused = true;
      a.setEffectiveWeight(0);
      return a;
    };
    const baseClips: Record<BaseClip, [string, boolean]> = {
      idle: ['idle', true],
      walk: ['walk', true],
      jog: ['jog', true],
      sprint: ['sprint', true],
      roll: ['roll', true],
      hit: ['hit', true],
      stumble: ['land', true],
      death: ['death', false],
    };
    for (const key of BASE_CLIPS) {
      const [name, pin] = baseClips[key];
      this.base[key] = action(prepareClip(find(name), pin));
      this.weights[key] = 0;
      this.target[key] = 0;
    }
    this.weights.idle = 1;
    this.slash = action(upperBody(prepareClip(find('Sword_Regular_A'), true)));
    this.flinch = action(upperBody(prepareClip(find('hitHead'), true)));
  }

  bone(name: BoneName): THREE.Bone {
    return this.bones[name];
  }

  /** True while the body is mostly in the tumbling roll (low to the deck). */
  get rollingPose(): boolean {
    return this.weights.roll > 0.5;
  }

  /** Puts the rig in its relaxed standing pose, for binding gear to it. */
  poseForBinding(): void {
    for (const key of BASE_CLIPS) this.base[key].setEffectiveWeight(key === 'idle' ? 1 : 0);
    this.base.idle.time = 0;
    this.mixer.update(0);
    for (let i = 0; i < this.touched.length; i++) this.clean[i].copy(this.touched[i].quaternion);
    this.model.updateMatrixWorld(true);
  }

  handleEvent(e: GameEvent): void {
    if (e.type === 'hit') {
      if (e.kind === 'hail') {
        this.stunKind = 'hit';
        this.stunTotal = PROFILES.hail.stun;
      } else if (e.damage >= 4) {
        this.flinchT = 0;
      }
    } else if (e.type === 'stumble' && this.stunKind !== 'hit') {
      this.stunKind = 'stumble';
      this.stunTotal = STUMBLE_TIME;
    }
  }

  /** Facing used for the body: a slash keeps its own side until it is done. */
  private facingFor(game: Game): number {
    const k = game.katana;
    if (k.t >= 0) return k.facing;
    return game.warrior.facing;
  }

  /**
   * Poses the rig for this frame. `aim` is the world point on the slash crescent where the blade
   * should be (null when no swing is in flight); `hands` is how many hands hold a blade.
   */
  update(dt: number, game: Game, aim: THREE.Vector3 | null = null, hands = 1): void {
    const w = game.warrior;
    this.dead = game.phase === 'over';
    if (this.dead) this.deathT += dt;
    else this.deathT = 0;

    // Gait: speed is smoothed, the cycle advances with the distance actually travelled.
    const speed = Math.abs(w.vx);
    this.speed += (speed - this.speed) * Math.min(1, dt * 12);
    const dStride = Math.max(0, w.stride - this.lastStride);
    this.lastStride = w.stride;
    this.idleTime += dt;

    // Roll: the clip's tumble is laid over the dash.
    if (w.rolling) {
      if (!this.rolling) this.rollT = 0;
      this.rollT = 1 - w.dashT / DASH_TIME;
    } else if (this.rollT < 1.6) {
      this.rollT += dt / DASH_TIME;
    }
    this.rolling = w.rolling;

    // Hail strikes and stumbles last exactly as long as the simulation's stun, on its clock.
    if (w.stun <= 0) this.stunKind = null;
    const stunned = this.stunKind !== null ? Math.min(1, 1 - w.stun / this.stunTotal) : 1;
    this.hitT = this.stunKind === 'hit' ? stunned * this.hitLength : this.hitLength;
    this.stumbleT = this.stunKind === 'stumble' ? stunned * STUMBLE_TIME : STUMBLE_TIME;
    this.flinchT += dt;
    this.kick = w.kicking ? 1 - w.kickT / KICK_TIME : -1;

    // Base weights ease toward their targets (the roll snaps in), then normalise to a full pose.
    const t = this.targets(game);
    const fast = 1 - Math.exp(-dt * 22);
    let sum = 0;
    for (const key of BASE_CLIPS) {
      const rate = key === 'roll' && t.roll > this.weights.roll ? 1 - Math.exp(-dt * 50) : fast;
      this.weights[key] += (t[key] - this.weights[key]) * rate;
      sum += this.weights[key];
    }
    for (const key of BASE_CLIPS) this.base[key].setEffectiveWeight(this.weights[key] / Math.max(1e-4, sum));

    // Clip times.
    const gaitRate = this.gaitRate(Math.max(this.speed, 0.01));
    if (dStride > 0 && speed > 0.05) this.gaitPhase = (this.gaitPhase + (gaitRate / Math.max(speed, 0.3)) * dStride) % 1;
    this.base.walk.time = this.gaitPhase * this.base.walk.getClip().duration;
    this.base.jog.time = this.gaitPhase * this.base.jog.getClip().duration;
    this.base.sprint.time = this.gaitPhase * this.base.sprint.getClip().duration;
    this.base.idle.time = this.idleTime % this.base.idle.getClip().duration;
    this.base.roll.time = Math.min(this.base.roll.getClip().duration, ROLL_FROM + Math.min(this.rollT, 1.6) * (ROLL_TO - ROLL_FROM));
    this.base.hit.time = Math.min(this.base.hit.getClip().duration, Math.max(0, this.hitT - 0.06) * 0.55);
    this.base.stumble.time = 0.12 + Math.min(1, this.stumbleT / STUMBLE_TIME) * 0.55;
    this.base.death.time = Math.min(this.base.death.getClip().duration, this.deathT);

    this.updateSlash(dt, game);
    const flinch = this.dead ? 0 : Math.max(0, 1 - this.flinchT / 0.3);
    this.flinch.setEffectiveWeight(flinch * 1.5);
    this.flinch.time = Math.min(this.flinch.getClip().duration, this.flinchT * 1.2);

    this.place(dt, game);
    for (let i = 0; i < this.touched.length; i++) this.touched[i].quaternion.copy(this.clean[i]);
    this.mixer.update(0);
    for (let i = 0; i < this.touched.length; i++) this.clean[i].copy(this.touched[i].quaternion);
    this.procedural(dt, game);
    this.aimBlades(aim, hands);
  }

  /**
   * The sword clip was authored with the whole body spinning through the cut; laid over the base
   * pose without the hips, its blade would point astray. So each blade hand is turned until the
   * blade points at the crescent's leading edge, in proportion to the slash layer's weight. The
   * math runs in model space, where the side view's mirror cancels out.
   */
  private aimBlades(aim: THREE.Vector3 | null, hands: number): void {
    const weight = Math.min(1, this.slashWeight / SLASH_WEIGHT);
    if (weight < 0.01) return;
    this.root.updateMatrixWorld(true);
    this.invModel.copy(this.model.matrixWorld).invert();
    if (aim) this.aimAt.copy(aim).applyMatrix4(this.invModel);
    this.aimHand(this.bones.hand_r, weight);
    if (hands > 1) this.aimHand(this.bones.hand_l, weight * 0.92);
  }

  private aimHand(hand: THREE.Bone, weight: number): void {
    this.m.multiplyMatrices(this.invModel, hand.matrixWorld).decompose(this.v, this.hq, this.sc);
    this.m.multiplyMatrices(this.invModel, (hand.parent as THREE.Object3D).matrixWorld).decompose(this.sc, this.pq, this.sc);
    this.cur.set(0, 0, 1).applyQuaternion(this.hq);
    this.dir.subVectors(this.aimAt, this.v).normalize();
    this.dq.setFromUnitVectors(this.cur, this.dir);
    this.dq.slerp(IDENTITY, 1 - weight);
    this.hq.premultiply(this.dq);
    hand.quaternion.copy(this.pq.invert().multiply(this.hq));
  }

  /** Cycles per second for the current gait mix: cadence grows slower than speed, as a real stride does. */
  private gaitRate(speed: number): number {
    const ww = this.weights.walk;
    const wj = this.weights.jog;
    const ws = this.weights.sprint;
    const total = ww + wj + ws;
    if (total < 1e-3) return GAIT.jog.rate;
    const r = (g: { speed: number; rate: number }) => g.rate * Math.sqrt(speed / g.speed);
    return (ww * r(GAIT.walk) + wj * r(GAIT.jog) + ws * r(GAIT.sprint)) / total;
  }

  /** Where each base clip's weight is heading this frame (reuses one record). */
  private targets(game: Game): Record<BaseClip, number> {
    const t = this.target;
    for (const key of BASE_CLIPS) t[key] = 0;
    if (this.dead) {
      t.death = 1;
      return t;
    }
    const w = game.warrior;
    if (w.rolling || this.rollT < 1.15) {
      t.roll = 1;
      return t;
    }
    const s = this.speed;
    const moving = smooth(0.2, 1.1, s);
    const walk = 1 - smooth(1.2, 2.4, s);
    const sprint = smooth(4.6, 6.0, s);
    const jog = Math.max(0, 1 - walk - sprint);
    // A kick plants the standing leg: the base pose settles toward the guard stance.
    const still = this.kick >= 0 ? 0.85 : 0;
    t.idle = Math.max(1 - moving, still);
    const m = 1 - t.idle;
    t.walk = m * walk;
    t.jog = m * jog;
    t.sprint = m * sprint;
    // A hail strike rocks the whole body; a stumble buckles it.
    const hit = this.hitT < this.hitLength ? Math.min(1, this.hitT / 0.05) * Math.min(1, (this.hitLength - this.hitT) / 0.18) : 0;
    const stumble = this.stumbleT < STUMBLE_TIME ? Math.min(1, this.stumbleT / 0.05) * Math.min(1, (STUMBLE_TIME - this.stumbleT) / 0.12) : 0;
    const over = Math.max(hit * 0.85, stumble * 0.8);
    for (const key of LOCOMOTION) t[key] *= 1 - over;
    t.hit = hit * 0.85;
    t.stumble = stumble * 0.8;
    return t;
  }

  /**
   * Upper-body slash layer, timed to the katana's own clock: the windup fills the startup, the
   * strike exactly spans the active frames, and the follow-through runs through the wake.
   * Rising swings play the clip forward, falling swings play it backward (see `slashDescends`).
   */
  private updateSlash(dt: number, game: Game): void {
    const k = game.katana;
    const w = game.warrior;
    const s = STRIKE;
    let target = 0;
    if (k.t >= 0 && !this.dead) {
      this.slashAfter = 0;
      const t = k.t;
      // Progress through the swing as a key-to-key position: 0–1 windup, 1–3 strike, 3–4 follow-through.
      let key: number;
      if (t < STARTUP) key = t / STARTUP;
      else if (t < STARTUP + ACTIVE) key = 1 + 2 * k.sweep;
      else key = 3 + Math.min(1, (t - STARTUP - ACTIVE) / WAKE);
      if (slashDescends(k.swing)) key = 4 - key;
      const i = Math.min(3, Math.floor(key));
      this.slash.time = s[i] + (s[i + 1] - s[i]) * (key - i);
      target = SLASH_WEIGHT;
    } else {
      this.slashAfter += dt;
      target = this.slashAfter < 0.05 ? SLASH_WEIGHT : 0;
    }
    // A roll, a kick or a stumble takes the arms back at once.
    if (w.rolling || this.kick >= 0 || this.dead) target = 0;
    const rate = target > this.slashWeight ? 1 - Math.exp(-dt * 60) : 1 - Math.exp(-dt * 9);
    this.slashWeight += (target - this.slashWeight) * rate;
    this.slash.setEffectiveWeight(this.slashWeight);
  }

  /** Bone adjustments on top of the clips: the kick, a run lean, and a stagger. */
  private procedural(dt: number, game: Game): void {
    const b = this.bones;
    const w = game.warrior;
    if (this.kick >= 0 && !this.dead) {
      // A low front kick that scoops the drift forward: chamber the knee, snap the leg straight
      // through the snow, recover. The body leans back and the free arm swings out to balance.
      const p = this.kick;
      const swing = Math.sin(Math.PI * Math.min(1, p * 1.2));
      const chamber = Math.max(0, 1 - p * 2.4);
      b.thigh_r.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, -1.5 * swing));
      b.calf_r.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, 1.3 * chamber * swing + 0.1));
      b.foot_r.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, 0.6 * swing));
      b.thigh_l.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, -0.2 * swing));
      b.calf_l.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, 0.4 * swing));
      b.spine_01.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, -0.32 * swing));
      b.upperarm_l.quaternion.multiply(this.q.setFromAxisAngle(Z_AXIS, 0.7 * swing));
    }
    // Lean into the run, and back when braking.
    const accel = Math.abs(w.vx) * (w.rolling ? 0 : 1);
    const leanTarget = this.dead ? 0 : Math.min(0.2, accel * 0.022);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 8);
    if (this.lean > 1e-3) b.spine_01.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, this.lean));
    // A hail strike crushes the warrior down: head and shoulders driven forward, knees buckling.
    const hit = this.hitWeight();
    if (hit > 0) {
      b.spine_02.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, 0.5 * hit));
      b.neck_01.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, 0.4 * hit));
      b.thigh_l.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, -0.45 * hit));
      b.thigh_r.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, -0.35 * hit));
      b.calf_l.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, 0.75 * hit));
      b.calf_r.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, 0.6 * hit));
    }
  }

  /** 0–1: how deep into the hail-strike crouch the body is (a sharp drop, a slower recovery). */
  private hitWeight(): number {
    if (this.dead || this.hitT >= this.hitLength) return 0;
    const t = this.hitT / this.hitLength;
    return t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.5);
  }

  /** Stands the body on the deck: sag, sway, a share of the pitch and roll, sinking into deep snow. */
  private place(dt: number, game: Game): void {
    const w = game.warrior;
    const b = game.bridge;
    const x = w.x;
    const depth = game.snow.depthAt(x);
    // Fresh snow takes the feet: in 0.4 m of drift the boots disappear to the shin.
    const lift = depth > 0.08 ? depth - Math.min(depth, 0.05 + depth * 0.45) : depth * 0.4;
    // Buckled knees lower the hips; drop the body with them so the feet stay on the planks.
    const stagger = -0.07 * this.hitWeight();
    this.root.position.set(worldX(x), b.deckY(x) + lift + stagger, b.lateral(x));
    this.root.rotation.set(b.rollAt(x) * 0.6, 0, b.pitch(x) * 0.18);

    const facing = this.facingFor(game);
    const step = dt / TURN_TIME;
    this.turn = facing > 0 ? Math.min(1, this.turn + step * 2) : Math.max(-1, this.turn - step * 2);
    this.side = this.turn >= 0 ? 1 : -1;
    const yaw = Math.abs(this.turn) * (Math.PI / 2 - THREE_QUARTER);
    this.pivot.rotation.y = yaw * this.side;
    this.pivot.scale.x = this.side;
  }
}
