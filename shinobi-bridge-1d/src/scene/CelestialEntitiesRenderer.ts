import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { worldX } from '../render/RenderContext.ts';

interface DemonVisual {
  mesh: THREE.Group;
  pivot: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  sprintAction: THREE.AnimationAction;
  strikeAction: THREE.AnimationAction;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  core: THREE.Mesh;
  alive: boolean;
}

interface AngelVisual {
  mesh: THREE.Group;
  pivot: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction;
  upperWings: [THREE.Group, THREE.Group];
  midWings: [THREE.Group, THREE.Group];
  lowerWings: [THREE.Group, THREE.Group];
  outerHalo: THREE.Group;
  lightBeam: THREE.Mesh;
  alive: boolean;
}

interface SparkBurst {
  mesh: THREE.Points;
  velocities: THREE.Vector3[];
  life: number;
  maxLife: number;
}

/**
 * Renders photorealistic, rigged 3D Celestial Characters using the Quaternius skeletal mesh
 * (`assets/chars/steve.glb`) and animation clips (`anims.glb` / `ninja_anims.glb`), dressed in
 * normal-mapped PBR materials (`ranger_d/n/orm`, `head_m_d/n`, `arm_m_d/n`, `leather`, `slate`, `tile`):
 * - Abyssal Oni / Archdemon Warriors: Rigged humanoid warriors in crimson-obsidian PBR battle armor,
 *   horned war-helms, glowing eyes, molten demonic blades, and articulated wings — sprinting and
 *   charging along the white-and-gold staircase to push the soldier down!
 * - Ascending Seraphim Angels: Rigged celestial figures in white-and-gold silk PBR vestments,
 *   six feathered golden wings, and radiant solar mandorlas.
 */
export class CelestialEntitiesRenderer implements RenderModule {
  private readonly ctx: RenderContext;
  readonly group = new THREE.Group();

  private readonly demonPool: DemonVisual[] = [];
  private readonly angelPool: AngelVisual[] = [];
  private readonly demonMap = new Map<number, DemonVisual>();
  private readonly angelMap = new Map<number, AngelVisual>();

  private readonly bursts: SparkBurst[] = [];

  // Shared PBR Materials for Rigged Demons & Angels
  private readonly demonClothMat: THREE.MeshStandardMaterial;
  private readonly demonSkinMat: THREE.MeshStandardMaterial;
  private readonly demonHeadMat: THREE.MeshStandardMaterial;
  private readonly demonEyeMat: THREE.MeshBasicMaterial;
  private readonly demonHornMat: THREE.MeshStandardMaterial;
  private readonly demonArmorMat: THREE.MeshStandardMaterial;
  private readonly demonBladeMat: THREE.MeshStandardMaterial;

  private readonly angelClothMat: THREE.MeshStandardMaterial;
  private readonly angelSkinMat: THREE.MeshStandardMaterial;
  private readonly angelHeadMat: THREE.MeshStandardMaterial;
  private readonly angelGoldMat: THREE.MeshStandardMaterial;

  private readonly sprintClip: THREE.AnimationClip;
  private readonly strikeClip: THREE.AnimationClip;
  private readonly idleClip: THREE.AnimationClip;

  // Light Blade Visual
  private readonly lightBladeAura: THREE.Mesh;
  private readonly lightBladeBeam: THREE.Mesh;

  private active = false;
  private time = 0;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.group.name = 'celestial_entities';
    ctx.scene.add(this.group);
    this.group.visible = false;

    const t = ctx.assets.tex;
    const leatherPbr = ctx.assets.pbr('leather', 2, 2);
    const slatePbr = ctx.assets.pbr('slate', 2, 2);
    const tilePbr = ctx.assets.pbr('tile', 2, 2);

    // 1. Realistic PBR Materials for Rigged Demons
    this.demonClothMat = new THREE.MeshStandardMaterial({
      color: 0x5c1414,
      map: t.ranger_d,
      normalMap: t.ranger_n,
      roughnessMap: t.ranger_orm,
      metalnessMap: t.ranger_orm,
      roughness: 0.55,
      metalness: 0.45,
      emissive: 0x240404,
      emissiveIntensity: 0.45,
    });
    this.demonSkinMat = new THREE.MeshStandardMaterial({
      color: 0x6e221e,
      map: t.arm_m_d,
      normalMap: t.arm_m_n,
      roughness: 0.6,
      metalness: 0.15,
      emissive: 0x280604,
      emissiveIntensity: 0.35,
    });
    this.demonHeadMat = new THREE.MeshStandardMaterial({
      color: 0x75201c,
      map: t.head_m_d,
      normalMap: t.head_m_n,
      roughness: 0.52,
      emissive: 0x2c0705,
      emissiveIntensity: 0.4,
    });
    this.demonEyeMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    this.demonHornMat = new THREE.MeshStandardMaterial({
      color: 0x1a0c0e,
      normalMap: slatePbr.normalMap,
      roughness: 0.28,
      metalness: 0.65,
      emissive: 0xcc2800,
      emissiveIntensity: 0.75,
    });
    this.demonArmorMat = new THREE.MeshStandardMaterial({
      color: 0x281216,
      map: leatherPbr.map,
      normalMap: leatherPbr.normalMap,
      roughnessMap: leatherPbr.roughnessMap,
      roughness: 0.38,
      metalness: 0.72,
      emissive: 0x380804,
      emissiveIntensity: 0.4,
    });
    this.demonBladeMat = new THREE.MeshStandardMaterial({
      color: 0xff3800,
      metalness: 0.85,
      roughness: 0.2,
      emissive: 0xff2200,
      emissiveIntensity: 1.4,
    });

    // 2. Realistic PBR Materials for Rigged Seraphim Angels
    this.angelClothMat = new THREE.MeshStandardMaterial({
      color: 0xfffdf8,
      map: t.ranger_d,
      normalMap: t.ranger_n,
      roughness: 0.35,
      metalness: 0.18,
      emissive: 0x4a3818,
      emissiveIntensity: 0.35,
    });
    this.angelSkinMat = new THREE.MeshStandardMaterial({
      color: 0xfff0dc,
      map: t.arm_m_d,
      normalMap: t.arm_m_n,
      roughness: 0.48,
      emissive: 0x332410,
      emissiveIntensity: 0.25,
    });
    this.angelHeadMat = new THREE.MeshStandardMaterial({
      color: 0xfff2e2,
      map: t.head_m_d,
      normalMap: t.head_m_n,
      roughness: 0.45,
      emissive: 0x332410,
      emissiveIntensity: 0.25,
    });
    this.angelGoldMat = new THREE.MeshStandardMaterial({
      color: 0xffd455,
      normalMap: tilePbr.normalMap,
      metalness: 0.92,
      roughness: 0.18,
      emissive: 0x7a540c,
      emissiveIntensity: 0.55,
    });

    // 3. Extract Skeletal Animation Clips (`sprint`, `Sword_Regular_A`, `idle`)
    const allClips = [...ctx.assets.character.anims.animations, ...ctx.assets.character.ninjaAnims.animations];
    const findClip = (name: string) => allClips.find((c) => c.name === name) ?? allClips[0];
    this.sprintClip = this.pinClip(findClip('sprint'));
    this.strikeClip = this.upperBodyClip(this.pinClip(findClip('Sword_Regular_A')));
    this.idleClip = this.pinClip(findClip('idle'));

    // Build pools of 12 rigged demons and 6 rigged angels
    for (let i = 0; i < 12; i++) {
      const d = this.buildRiggedDemonMesh();
      d.mesh.visible = false;
      this.demonPool.push(d);
      this.group.add(d.mesh);
    }

    for (let i = 0; i < 6; i++) {
      const a = this.buildRiggedAngelMesh();
      a.mesh.visible = false;
      this.angelPool.push(a);
      this.group.add(a.mesh);
    }

    // Light Blade Divine Aura
    const auraGeo = new THREE.CylinderGeometry(0.08, 0.14, 1.8, 16);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xfff0aa,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.lightBladeAura = new THREE.Mesh(auraGeo, auraMat);
    this.lightBladeAura.visible = false;
    this.group.add(this.lightBladeAura);

    const beamGeo = new THREE.ConeGeometry(0.35, 2.5, 16);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffea77,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    this.lightBladeBeam = new THREE.Mesh(beamGeo, beamMat);
    this.lightBladeBeam.visible = false;
    this.group.add(this.lightBladeBeam);
  }

  private pinClip(source: THREE.AnimationClip): THREE.AnimationClip {
    const clip = source.clone();
    clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
    for (const t of clip.tracks) {
      if (t.name !== 'pelvis.position') continue;
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

  private upperBodyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
    const upper = /^(spine_02|spine_03|neck_01|Head|clavicle|upperarm|lowerarm|hand)/;
    const copy = clip.clone();
    copy.tracks = copy.tracks.filter((t) => upper.test(t.name) && t.name.endsWith('.quaternion'));
    return copy;
  }

  /**
   * Clones the rigged Quaternius character (`steve.glb`) and equips it with realistic PBR Oni/Archdemon
   * armor, curved horns, molten core, demonic greatsword, and articulated leather wings.
   */
  private buildRiggedDemonMesh(): DemonVisual {
    const root = new THREE.Group();
    const pivot = new THREE.Group();
    root.add(pivot);

    const model = cloneSkeleton(this.ctx.assets.character.body.scene);
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const matName = (m.material as THREE.Material).name;
      if (matName === 'cloth') m.material = this.demonClothMat;
      else if (matName === 'skin') m.material = this.demonSkinMat;
      else if (matName === 'head') m.material = this.demonHeadMat;
      else if (matName === 'eye') m.material = this.demonEyeMat;
      else if (matName === 'brow' || matName === 'hair') m.material = this.demonArmorMat;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    });
    pivot.add(model);

    // Attach Horned Oni War-Helm & Glowing Eyes to Head bone
    const headBone = model.getObjectByName('Head') as THREE.Bone | undefined;
    if (headBone) {
      // Sweeping Archdemon Horns
      for (const side of [-1, 1]) {
        const hornCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.07, 0.08, 0.02),
          new THREE.Vector3(side * 0.22, 0.22, 0.05),
          new THREE.Vector3(side * 0.28, 0.42, -0.06),
          new THREE.Vector3(side * 0.16, 0.56, -0.14),
        ]);
        const hornGeo = new THREE.TubeGeometry(hornCurve, 12, 0.036, 8, false);
        const horn = new THREE.Mesh(hornGeo, this.demonHornMat);
        headBone.add(horn);
      }

      // Oni Crest & Glowing Visor
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.038, 0.08), this.demonEyeMat);
      visor.position.set(0, 0.04, 0.11);
      headBone.add(visor);
    }

    // Attach Spiked Obsidian Pauldrons & Molten Heart Core to Spine_03
    const chestBone = model.getObjectByName('spine_03') as THREE.Bone | undefined;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xff4400 }),
    );
    core.position.set(0, 0.08, 0.15);
    if (chestBone) {
      chestBone.add(core);
      const pauldronGeo = new THREE.ConeGeometry(0.16, 0.34, 6);
      for (const side of [-1, 1]) {
        const pauldron = new THREE.Mesh(pauldronGeo, this.demonArmorMat);
        pauldron.position.set(side * 0.24, 0.14, 0);
        pauldron.rotation.z = -side * 0.85;
        chestBone.add(pauldron);
      }
    } else {
      pivot.add(core);
    }

    // Attach Molten Demonic Odachi / Greatsword to Right Hand bone (`hand_r`)
    const handR = model.getObjectByName('hand_r') as THREE.Bone | undefined;
    if (handR) {
      const swordGroup = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.08, 0.98), this.demonBladeMat);
      blade.position.set(0, 0, 0.52);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.04), this.demonArmorMat);
      guard.position.set(0, 0, 0.05);
      swordGroup.add(blade, guard);
      swordGroup.position.set(-0.02, 0.08, 0);
      handR.add(swordGroup);
    }

    // Attach Articulated Leather & Molten Bone Bat Wings to Upper Back
    const createWing = (isLeft: boolean) => {
      const wingRoot = new THREE.Group();
      const s = isLeft ? -1 : 1;
      wingRoot.position.set(s * 0.14, 1.35, -0.14);

      const boneGeo = new THREE.CylinderGeometry(0.025, 0.04, 1.15, 6);
      const humerus = new THREE.Mesh(boneGeo, this.demonHornMat);
      humerus.position.set(s * 0.45, 0.38, -0.05);
      humerus.rotation.z = s * 0.92;
      wingRoot.add(humerus);

      const memGeo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        0, 0, 0,
        s * 0.95, 0.78, -0.08,
        s * 1.65, 0.32, -0.12,
        0, 0, 0,
        s * 1.65, 0.32, -0.12,
        s * 1.25, -0.55, -0.08,
        0, 0, 0,
        s * 1.25, -0.55, -0.08,
        s * 0.45, -0.48, -0.04,
      ]);
      memGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      memGeo.computeVertexNormals();
      const memMat = new THREE.MeshStandardMaterial({
        color: 0x2a080c,
        map: this.demonArmorMat.map,
        normalMap: this.demonArmorMat.normalMap,
        roughnessMap: this.demonArmorMat.roughnessMap,
        emissive: 0x380802,
        emissiveIntensity: 0.4,
        roughness: 0.42,
        metalness: 0.55,
        side: THREE.DoubleSide,
      });
      wingRoot.add(new THREE.Mesh(memGeo, memMat));
      return wingRoot;
    };

    const leftWing = createWing(true);
    const rightWing = createWing(false);
    pivot.add(leftWing, rightWing);

    // Skeletal Animation Mixer: blend full-body sprint with upper-body sword slashes
    const mixer = new THREE.AnimationMixer(model);
    const sprintAction = mixer.clipAction(this.sprintClip);
    sprintAction.play();
    sprintAction.setEffectiveWeight(1.0);

    const strikeAction = mixer.clipAction(this.strikeClip);
    strikeAction.play();
    strikeAction.setEffectiveWeight(0.85);

    return {
      mesh: root,
      pivot,
      model,
      mixer,
      sprintAction,
      strikeAction,
      leftWing,
      rightWing,
      core,
      alive: false,
    };
  }

  /**
   * Clones the rigged Quaternius character (`steve.glb`) for the Ascending Seraphim Angels,
   * dressed in white-and-gold silk PBR vestments, golden crown & halo, and 6 feathered wings.
   */
  private buildRiggedAngelMesh(): AngelVisual {
    const root = new THREE.Group();
    const pivot = new THREE.Group();
    root.add(pivot);

    const model = cloneSkeleton(this.ctx.assets.character.body.scene);
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const matName = (m.material as THREE.Material).name;
      if (matName === 'cloth') m.material = this.angelClothMat;
      else if (matName === 'skin') m.material = this.angelSkinMat;
      else if (matName === 'head') m.material = this.angelHeadMat;
      else m.material = this.angelGoldMat;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    });
    pivot.add(model);

    // Flowing White & Gold Seraphic Robe Skirt around lower body
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.48, 0.95, 16), this.angelClothMat);
    skirt.position.set(0, 0.48, 0);
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 24), this.angelGoldMat);
    sash.rotation.x = Math.PI / 2;
    sash.position.set(0, 0.96, 0);
    pivot.add(skirt, sash);

    // Solar Mandorla Halo behind head
    const haloGroup = new THREE.Group();
    haloGroup.position.set(0, 1.72, -0.14);
    const innerHaloMat = new THREE.MeshBasicMaterial({ color: 0xffea66 });
    const innerHalo = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.032, 12, 32), innerHaloMat);
    haloGroup.add(innerHalo);

    const outerHaloGroup = new THREE.Group();
    const raySpokeGeo = new THREE.BoxGeometry(0.03, 1.15, 0.02);
    for (let r = 0; r < 8; r++) {
      const spoke = new THREE.Mesh(raySpokeGeo, innerHaloMat);
      spoke.rotation.z = (r * Math.PI) / 8;
      outerHaloGroup.add(spoke);
    }
    haloGroup.add(outerHaloGroup);
    pivot.add(haloGroup);

    // Six-Winged Seraphic Plumage
    const featherMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      emissive: 0xfff6dd,
      emissiveIntensity: 0.65,
      side: THREE.DoubleSide,
    });
    const createSeraphWing = (isLeft: boolean, lengthScale: number, angleOffset: number) => {
      const wingRoot = new THREE.Group();
      const s = isLeft ? -1 : 1;
      const spar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.05, 1.8 * lengthScale, 6),
        this.angelGoldMat,
      );
      spar.position.set(s * 0.75 * lengthScale, 0.42 * lengthScale, 0);
      spar.rotation.z = s * (0.85 + angleOffset);
      wingRoot.add(spar);

      const featherGeo = new THREE.BoxGeometry(0.16 * lengthScale, 1.25 * lengthScale, 0.025);
      for (let i = 0; i < 7; i++) {
        const isGold = i === 0 || i === 6;
        const feather = new THREE.Mesh(featherGeo, isGold ? this.angelGoldMat : featherMat);
        const u = i / 6;
        feather.position.set(s * (0.38 + u * 1.65 * lengthScale), (0.6 - u * 0.95) * lengthScale, (i % 2) * 0.03);
        feather.rotation.z = s * (0.7 + u * 1.1 + angleOffset * 0.5);
        wingRoot.add(feather);
      }
      return wingRoot;
    };

    const upperL = createSeraphWing(true, 1.2, -0.8);
    upperL.position.set(-0.18, 1.45, -0.12);
    const upperR = createSeraphWing(false, 1.2, -0.8);
    upperR.position.set(0.18, 1.45, -0.12);

    const midL = createSeraphWing(true, 1.05, 0.05);
    midL.position.set(-0.22, 1.15, -0.1);
    const midR = createSeraphWing(false, 1.05, 0.05);
    midR.position.set(0.22, 1.15, -0.1);

    const lowerL = createSeraphWing(true, 0.85, 0.9);
    lowerL.position.set(-0.18, 0.85, -0.08);
    const lowerR = createSeraphWing(false, 0.85, 0.9);
    lowerR.position.set(0.18, 0.85, -0.08);

    pivot.add(upperL, upperR, midL, midR, lowerL, lowerR);

    // Ascending Divine Light Beam
    const beamGeo = new THREE.CylinderGeometry(0.35, 1.6, 14, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff2bb,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const lightBeam = new THREE.Mesh(beamGeo, beamMat);
    lightBeam.position.y = -6.5;
    root.add(lightBeam);

    const mixer = new THREE.AnimationMixer(model);
    const idleAction = mixer.clipAction(this.idleClip);
    idleAction.play();
    idleAction.setEffectiveWeight(1.0);

    return {
      mesh: root,
      pivot,
      model,
      mixer,
      idleAction,
      upperWings: [upperL, upperR],
      midWings: [midL, midR],
      lowerWings: [lowerL, lowerR],
      outerHalo: outerHaloGroup,
      lightBeam,
      alive: false,
    };
  }

  handleEvent(e: GameEvent, _game?: Game): void {
    if (e.type === 'celestial_start') {
      this.active = true;
      this.group.visible = true;
    } else if (e.type === 'demon_slain') {
      this.spawnParticleBurst(worldX(e.x), e.y + 0.9, 0xff3300, 36);
    } else if (e.type === 'angel_bless') {
      this.spawnParticleBurst(worldX(e.x), e.y + 1.0, 0xfff0aa, 48);
    } else if (e.type === 'angel_struck') {
      this.spawnParticleBurst(worldX(e.x), e.y + 1.0, 0xff5533, 40);
    }
  }

  private spawnParticleBurst(x: number, y: number, color: number, count: number): void {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      const speed = 4 + Math.random() * 8;
      const angle = Math.random() * Math.PI * 2;
      velocities.push(
        new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed + 2, (Math.random() - 0.5) * 4),
      );
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.22,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.group.add(points);
    this.bursts.push({ mesh: points, velocities, life: 0, maxLife: 0.75 });
  }

  update(dt: number, game: Game): void {
    const inAscendLanding = game.phase === 'cutscene' && game.cutscene.phase === 'ascend' && game.cutscene.progress > 0.65;
    if (!this.active && game.phase !== 'celestial' && !inAscendLanding) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    this.time += dt;

    const celestial = game.celestial;
    const demons = celestial.demons;
    const angels = celestial.angels;
    const wx = worldX(game.warrior.x);

    const activeDemonIds = new Set<number>();
    for (const d of demons) {
      activeDemonIds.add(d.id);
      let v = this.demonMap.get(d.id);
      if (!v) {
        v = this.demonPool.find((p) => !p.alive);
        if (v) {
          v.alive = true;
          this.demonMap.set(d.id, v);
        }
      }
      if (v) {
        v.mesh.visible = true;
        const dxWorld = worldX(d.x);
        // When charging along the white-and-gold staircase, follow the step slope slightly outside the central dais
        const distFromCenter = Math.max(0, Math.abs(dxWorld) - 4.2);
        const stairOffsetY = d.staircaseCharger ? -distFromCenter * 0.14 : 0;
        v.mesh.position.set(dxWorld, d.y + stairOffsetY, d.z * 0.35);

        // Scale up Archdemon Drakes vs Oni Imps
        const scale = d.kind === 'drake' ? 1.32 : 1.05;
        v.mesh.scale.setScalar(scale);

        // Turn the rigged demon toward the warrior (three-quarter profile like WarriorRig)
        const dirToWarrior = wx >= dxWorld ? 1 : -1;
        v.pivot.rotation.y = dirToWarrior * (Math.PI / 2 - 0.38);
        v.pivot.scale.x = dirToWarrior;

        // Advance skeletal animation mixer (sprint + aggressive sword swing when close to pushing warrior)
        const distToWarrior = Math.abs(wx - dxWorld);
        v.strikeAction.setEffectiveWeight(distToWarrior < 4.5 ? 1.0 : 0.35);
        v.mixer.update(dt * (d.kind === 'drake' ? 1.15 : 1.4));

        // Flap demonic wings
        const flap = Math.sin(this.time * 8.5 + d.id * 1.7) * 0.45;
        v.leftWing.rotation.z = flap;
        v.rightWing.rotation.z = -flap;

        // Pulse molten chest core
        const coreScale = 1.0 + Math.sin(this.time * 5.5 + d.id * 2.1) * 0.2;
        v.core.scale.setScalar(coreScale);
      }
    }

    for (const [id, v] of this.demonMap) {
      if (!activeDemonIds.has(id)) {
        v.alive = false;
        v.mesh.visible = false;
        this.demonMap.delete(id);
      }
    }

    const activeAngelIds = new Set<number>();
    for (const a of angels) {
      activeAngelIds.add(a.id);
      let v = this.angelMap.get(a.id);
      if (!v) {
        v = this.angelPool.find((p) => !p.alive);
        if (v) {
          v.alive = true;
          this.angelMap.set(a.id, v);
        }
      }
      if (v) {
        v.mesh.visible = true;
        v.mesh.position.set(worldX(a.x), a.y, -0.4);
        v.pivot.rotation.y = Math.sin(this.time * 1.2 + a.id) * 0.25;
        v.mixer.update(dt);

        const flapUpper = Math.sin(this.time * 4.5 + a.id * 1.4) * 0.22;
        const flapMid = Math.sin(this.time * 4.5 + a.id * 1.4 + 0.5) * 0.28;
        const flapLower = Math.sin(this.time * 4.5 + a.id * 1.4 + 1.0) * 0.2;

        v.upperWings[0].rotation.z = flapUpper;
        v.upperWings[1].rotation.z = -flapUpper;
        v.midWings[0].rotation.z = flapMid;
        v.midWings[1].rotation.z = -flapMid;
        v.lowerWings[0].rotation.z = flapLower;
        v.lowerWings[1].rotation.z = -flapLower;

        v.outerHalo.rotation.z = this.time * 0.8;
      }
    }

    for (const [id, v] of this.angelMap) {
      if (!activeAngelIds.has(id)) {
        v.alive = false;
        v.mesh.visible = false;
        this.angelMap.delete(id);
      }
    }

    // Light Blade Visual
    const hasLightBlade = celestial.lightBladeActive;
    this.lightBladeAura.visible = hasLightBlade;
    this.lightBladeBeam.visible = hasLightBlade;
    if (hasLightBlade) {
      const wy = 0.8;
      this.lightBladeAura.position.set(wx + game.warrior.facing * 0.6, wy, 0.2);
      this.lightBladeAura.rotation.z = (Math.PI / 2) * -game.warrior.facing;
      this.lightBladeBeam.position.set(wx + game.warrior.facing * 1.5, wy, 0.2);
      this.lightBladeBeam.rotation.z = (Math.PI / 2) * -game.warrior.facing;
      const pulse = 1.0 + Math.sin(this.time * 12) * 0.2;
      this.lightBladeBeam.scale.set(pulse, 1, pulse);
    }

    // Particle bursts update
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      if (b.life >= b.maxLife) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.bursts.splice(i, 1);
        continue;
      }

      const pAttr = b.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pAttr.array as Float32Array;
      const p = b.life / b.maxLife;
      (b.mesh.material as THREE.PointsMaterial).opacity = 1.0 - p;

      for (let j = 0; j < b.velocities.length; j++) {
        const v = b.velocities[j];
        arr[j * 3 + 0] += v.x * dt;
        arr[j * 3 + 1] += v.y * dt;
        arr[j * 3 + 2] += v.z * dt;
        v.y -= 14 * dt;
      }
      pAttr.needsUpdate = true;
    }
  }
}
