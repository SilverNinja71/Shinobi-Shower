import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KatanaSlice } from '../combat/KatanaSlice.ts';
import type { NinjaController } from '../parkour/NinjaController.ts';
import { texture } from './Materials.ts';

const UPPER_BODY = /^(spine_02|spine_03|neck|Head|clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;
const FADE = 0.13;

function dyed(mat: THREE.MeshStandardMaterial, tint: THREE.Color): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDye = { value: tint };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uDye;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb = uDye * (0.3 + dot(sampledDiffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * 2.4);`,
      );
  };
  mat.customProgramCacheKey = () => 'dyed';
  return mat;
}

/** Ground the character's pelvis over the origin, so clips can't drag him away from his hitbox. */
function pinClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  clip.tracks = clip.tracks.filter((t) => !/^root\.position|\.scale$/.test(t.name));
  for (const t of clip.tracks) {
    if (t.name !== 'pelvis.position') continue;
    const v = t.values;
    const x0 = v[0];
    const z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
  return clip;
}

function upperBody(clip: THREE.AnimationClip): THREE.AnimationClip {
  const copy = clip.clone();
  copy.tracks = copy.tracks.filter((t) => UPPER_BODY.test(t.name));
  return copy;
}

/** The Quaternius character in dyed robes, driven by real animation clips. */
export class NinjaRig {
  readonly root = new THREE.Group();
  readonly robe = new THREE.Color(0x24406f);
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly cutA: THREE.AnimationAction;
  private readonly cutB: THREE.AnimationAction;
  private readonly hurt: THREE.AnimationAction;
  private readonly armL: THREE.Object3D | null;
  private readonly tails = new THREE.Group();
  private readonly katana: THREE.Group;
  private current = '';
  private wasSwinging = false;
  private wasHurt = false;
  private time = 0;

  constructor(body: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root.add(body);
    // The pack's characters face +z and the game's forward is -z.
    body.rotation.y = Math.PI;

    const armD = texture('chars/arm_m_d.jpg', true, false);
    const armN = texture('chars/arm_m_n.jpg', false, false);
    const orm = texture('chars/ranger_orm.jpg', false, false);
    const materials: Record<string, THREE.Material | null> = {
      cloth: dyed(new THREE.MeshStandardMaterial({
        map: texture('chars/ranger_d.jpg', true, false),
        normalMap: texture('chars/ranger_n.jpg', false, false),
        roughnessMap: orm,
        roughness: 0.9,
      }), this.robe),
      skin: dyed(new THREE.MeshStandardMaterial({ map: armD, normalMap: armN, roughness: 0.75 }), new THREE.Color(0x101828)),
      head: new THREE.MeshStandardMaterial({ map: texture('chars/head_m_d.jpg', true, false), normalMap: texture('chars/head_m_n.jpg', false, false), roughness: 0.6 }),
      eye: new THREE.MeshStandardMaterial({ map: texture('chars/eye_d.jpg', true, false), roughness: 0.15 }),
      brow: null,
      hair: null,
    };
    body.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const name = (mesh.material as THREE.Material).name;
      const next = materials[name];
      if (next === null) mesh.visible = false;
      else if (next) mesh.material = next;
    });

    const head = body.getObjectByName('Head');
    const handR = body.getObjectByName('hand_r');
    const back = body.getObjectByName('spine_03');
    this.armL = body.getObjectByName('upperarm_l') ?? null;
    if (head) this.dressHead(head);
    this.katana = this.buildKatana();
    if (handR) handR.add(this.katana);
    if (back) back.add(this.buildScabbard());

    this.mixer = new THREE.AnimationMixer(body);
    const byName = new Map(clips.map((c) => [c.name, pinClip(c)]));
    const once = new Set(['NinjaJump_Start', 'Sword_Dash']);
    for (const [name, clip] of byName) {
      const a = this.mixer.clipAction(clip);
      if (once.has(name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(name, a);
    }
    const layer = (name: string) => {
      const a = this.mixer.clipAction(upperBody(byName.get(name)!));
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.setEffectiveWeight(0);
      return a;
    };
    this.cutA = layer('Sword_Regular_A');
    this.cutB = layer('Sword_Regular_B');
    this.hurt = layer('Hit_Knockback');
    this.play('swordIdle');
  }

  private dressHead(head: THREE.Object3D): void {
    const wrap = new THREE.MeshStandardMaterial({ color: 0x141c2c, roughness: 0.85 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb8321f, roughness: 0.65 });
    // A hood wrapped over the head, open across the eyes.
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.48), wrap);
    hood.position.set(0, 0.09, -0.012);
    hood.scale.set(1, 1.02, 1.14);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 12, 0, Math.PI * 2, Math.PI * 0.56), wrap);
    jaw.position.set(0, 0.062, 0.01);
    jaw.scale.set(1, 1.2, 1.15);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.139, 0.142, 0.038, 24), red);
    band.position.set(0, 0.135, -0.012);
    band.scale.z = 1.14;
    this.tails.position.set(0, 0.135, -0.17);
    for (const side of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.46, 1, 1, 6).translate(0, 0, -0.23), red);
      tail.position.x = side * 0.025;
      tail.rotation.y = side * 0.12;
      tail.castShadow = true;
      this.tails.add(tail);
    }
    for (const m of [hood, jaw, band]) m.castShadow = true;
    head.add(hood, jaw, band, this.tails);
  }

  private buildKatana(): THREE.Group {
    const steel = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, metalness: 1, roughness: 0.16, envMapIntensity: 1.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x12141c, roughness: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc69a45, metalness: 1, roughness: 0.35 });
    // A blade with a real curve and a tapered, angled tip, extruded in profile.
    const s = new THREE.Shape();
    const L = 0.92;
    const curve = (t: number) => 0.055 * t * t;
    s.moveTo(0, 0);
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      s.lineTo(curve(t), t * L);
    }
    s.lineTo(curve(1) + 0.024, L - 0.05);
    for (let i = 11; i >= 0; i--) {
      const t = i / 12;
      s.lineTo(curve(t) + 0.03, t * L);
    }
    s.closePath();
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 1 }), steel);
    blade.position.set(-0.012, 0.14, -0.002);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 16), brass);
    guard.position.y = 0.135;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.24, 8), dark);
    grip.position.y = 0.015;
    const group = new THREE.Group();
    group.add(blade, guard, grip);
    group.traverse((o) => { o.castShadow = true; });
    group.position.set(-0.03, 0.09, 0.03);
    group.rotation.set(Math.PI / 2, 0, 0);
    return group;
  }

  private buildScabbard(): THREE.Object3D {
    const mat = new THREE.MeshStandardMaterial({ color: 0x151826, roughness: 0.3, metalness: 0.1 });
    const scabbard = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.86, 3, 8), mat);
    scabbard.position.set(0.02, 0.1, -0.15);
    scabbard.rotation.z = 0.85;
    scabbard.castShadow = true;
    return scabbard;
  }

  private play(name: string, rate = 1): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.setEffectiveTimeScale(rate);
    if (name === this.current) return;
    const prev = this.actions.get(this.current);
    next.reset().setEffectiveWeight(1).play();
    if (prev) next.crossFadeFrom(prev, FADE, false);
    this.current = name;
  }

  private pickClip(n: NinjaController): void {
    if (n.state === 'dash') this.play('Sword_Dash', 2);
    else if (n.state === 'slide') this.play('Slide_Loop');
    else if (n.state === 'grind') this.play('Slide_Loop');
    else if (n.state === 'wallrun') this.play('sprint', 1.15);
    else if (!n.grounded) this.play('NinjaJump_Idle_Loop');
    else if (n.speed > 5.5) this.play('sprint', Math.min(1.5, n.speed / 8));
    else if (n.speed > 0.7) this.play('jog', Math.max(0.7, n.speed / 4));
    else this.play('swordIdle');
  }

  private layerOn(action: THREE.AnimationAction, rate: number): void {
    action.reset().setEffectiveTimeScale(rate).setEffectiveWeight(4).play();
  }

  update(dt: number, n: NinjaController, k: KatanaSlice): void {
    this.time += dt;
    this.pickClip(n);

    if (k.swinging && !this.wasSwinging) this.layerOn(k.side > 0 ? this.cutA : this.cutB, 2.6);
    this.wasSwinging = k.swinging;
    if (!k.swinging) {
      for (const a of [this.cutA, this.cutB]) {
        const w = a.getEffectiveWeight();
        if (w > 0) a.setEffectiveWeight(Math.max(0, w - dt * 14));
      }
    }
    const hurtNow = n.iframes > 0.3 && n.state !== 'dash';
    if (hurtNow && !this.wasHurt) this.layerOn(this.hurt, 2);
    this.wasHurt = hurtNow;
    if (!hurtNow) {
      const w = this.hurt.getEffectiveWeight();
      if (w > 0) this.hurt.setEffectiveWeight(Math.max(0, w - dt * 8));
    }

    this.mixer.update(dt);

    // On the wire, the free arm reaches up the line.
    if (n.wire.attached && this.armL) this.armL.rotateX(-2.3);
    this.tails.rotation.x = 0.2 - Math.min(0.75, n.speed * 0.06) + Math.sin(this.time * 12) * 0.06;
  }
}

export async function loadNinjaRig(): Promise<NinjaRig> {
  const loader = new GLTFLoader();
  const [body, base, extra] = await Promise.all([
    loader.loadAsync('assets/chars/steve.glb'),
    loader.loadAsync('assets/chars/anims.glb'),
    loader.loadAsync('assets/chars/ninja_anims.glb'),
  ]);
  return new NinjaRig(body.scene, [...base.animations, ...extra.animations]);
}
