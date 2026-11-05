import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { worldX } from '../render/RenderContext.ts';

interface DemonVisual {
  mesh: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  core: THREE.Mesh;
  eyes: THREE.Mesh;
  alive: boolean;
}

interface AngelVisual {
  mesh: THREE.Group;
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
 * Renders high-detail Abyssal Demons (sculpted horned fiends with fiery molten bat wings),
 * Ascending Seraphim (6-winged celestial angels with radiant golden quills and solar mandorlas),
 * death/blessing FX, and the warrior's radiant Light Blade.
 */
export class CelestialEntitiesRenderer implements RenderModule {
  private readonly ctx: RenderContext;
  readonly group = new THREE.Group();

  // Demon & Angel Visual Pools
  private readonly demonPool: DemonVisual[] = [];
  private readonly angelPool: AngelVisual[] = [];
  private readonly demonMap = new Map<number, DemonVisual>();
  private readonly angelMap = new Map<number, AngelVisual>();

  // Particle bursts
  private readonly bursts: SparkBurst[] = [];

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

    // Build pools of 12 demons and 6 angels
    for (let i = 0; i < 12; i++) {
      const d = this.buildDemonMesh();
      d.mesh.visible = false;
      this.demonPool.push(d);
      this.group.add(d.mesh);
    }

    for (let i = 0; i < 6; i++) {
      const a = this.buildAngelMesh();
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

  private buildDemonMesh(): DemonVisual {
    const root = new THREE.Group();
    const slatePbr = this.ctx.assets.pbr('slate', 2, 2);

    const carapaceMat = new THREE.MeshStandardMaterial({
      color: 0x181020,
      map: slatePbr.map,
      normalMap: slatePbr.normalMap,
      roughnessMap: slatePbr.roughnessMap,
      roughness: 0.65,
      metalness: 0.4,
      emissive: 0x1f0612,
      emissiveIntensity: 0.6,
    });

    // 1. Muscular Demonic Torso (Chest & Abdomen)
    const torsoGroup = new THREE.Group();
    const chestGeo = new THREE.BoxGeometry(0.95, 0.75, 0.58);
    const chest = new THREE.Mesh(chestGeo, carapaceMat);
    chest.position.set(0, 0.32, 0);
    torsoGroup.add(chest);

    for (let i = 0; i < 3; i++) {
      const abGeo = new THREE.BoxGeometry(0.75 - i * 0.12, 0.24, 0.46 - i * 0.06);
      const ab = new THREE.Mesh(abGeo, carapaceMat);
      ab.position.set(0, -0.08 - i * 0.22, 0.04);
      torsoGroup.add(ab);
    }

    // Glowing Molten Demonic Core (Chest)
    const coreGeo = new THREE.SphereGeometry(0.24, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 0.32, 0.3);
    torsoGroup.add(core);

    // 2. Demonic Horned Skull
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.95, 0.08);

    const craniumGeo = new THREE.DodecahedronGeometry(0.42, 1);
    const cranium = new THREE.Mesh(craniumGeo, carapaceMat);
    headGroup.add(cranium);

    const jawGeo = new THREE.ConeGeometry(0.24, 0.36, 4);
    const jaw = new THREE.Mesh(jawGeo, carapaceMat);
    jaw.position.set(0, -0.32, 0.18);
    jaw.rotation.x = -0.4;
    headGroup.add(jaw);

    const eyesGeo = new THREE.BoxGeometry(0.36, 0.08, 0.12);
    const eyesMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const eyes = new THREE.Mesh(eyesGeo, eyesMat);
    eyes.position.set(0, 0.08, 0.36);
    headGroup.add(eyes);

    // Sweeping Ribbed Archdemon Horns
    const hornMat = new THREE.MeshStandardMaterial({
      color: 0x280612,
      emissive: 0xff3800,
      emissiveIntensity: 1.2,
      roughness: 0.25,
    });
    for (const side of [-1, 1]) {
      const hornCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.2, 0.2, -0.05),
        new THREE.Vector3(side * 0.65, 0.75, -0.15),
        new THREE.Vector3(side * 0.85, 1.35, -0.38),
        new THREE.Vector3(side * 0.58, 1.8, -0.55),
      ]);
      const hornGeo = new THREE.TubeGeometry(hornCurve, 16, 0.1, 8, false);
      const horn = new THREE.Mesh(hornGeo, hornMat);
      headGroup.add(horn);
    }
    torsoGroup.add(headGroup);

    // Spiked Pauldrons & Muscular Arms
    const pauldronGeo = new THREE.ConeGeometry(0.34, 0.7, 5);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pauldronGeo, carapaceMat);
      p.position.set(side * 0.75, 0.55, 0);
      p.rotation.z = -side * 0.75;
      torsoGroup.add(p);

      const armGeo = new THREE.CylinderGeometry(0.12, 0.09, 1.1, 6);
      const arm = new THREE.Mesh(armGeo, carapaceMat);
      arm.position.set(side * 0.8, 0.05, 0.15);
      arm.rotation.z = -side * 0.4;
      arm.rotation.x = 0.45;
      torsoGroup.add(arm);

      for (let c = 0; c < 3; c++) {
        const clawGeo = new THREE.ConeGeometry(0.035, 0.35, 4);
        const claw = new THREE.Mesh(clawGeo, carapaceMat);
        claw.position.set(side * (0.9 + c * 0.09), -0.58, 0.48);
        claw.rotation.x = 0.85;
        torsoGroup.add(claw);
      }
    }
    root.add(torsoGroup);

    // 3. Glowing Fiery Balrog Bat Wings (Gothic Arched Silhouette)
    const wingBoneMat = new THREE.MeshStandardMaterial({
      color: 0x2a0808,
      emissive: 0xff4400,
      emissiveIntensity: 1.2,
      roughness: 0.35,
    });
    const wingMembraneMat = new THREE.MeshStandardMaterial({
      color: 0x4a0a14,
      emissive: 0xcc2200,
      emissiveIntensity: 0.9,
      roughness: 0.5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
    });

    const createBatWing = (isLeft: boolean) => {
      const wingRoot = new THREE.Group();
      wingRoot.position.set(isLeft ? -0.45 : 0.45, 0.55, -0.05);
      const s = isLeft ? -1 : 1;

      // Humerus (Arched upward)
      const humerusGeo = new THREE.CylinderGeometry(0.06, 0.09, 1.8, 6);
      const humerus = new THREE.Mesh(humerusGeo, wingBoneMat);
      humerus.position.set(s * 0.75, 0.65, 0);
      humerus.rotation.z = s * 0.95;
      wingRoot.add(humerus);

      // Radius (Curving down and out)
      const radiusGeo = new THREE.CylinderGeometry(0.045, 0.065, 2.2, 6);
      const radius = new THREE.Mesh(radiusGeo, wingBoneMat);
      radius.position.set(s * 2.1, 0.95, 0);
      radius.rotation.z = -s * 0.55;
      wingRoot.add(radius);

      // 4 Long Curved Finger Struts radiating downward
      const fingerGeo = new THREE.CylinderGeometry(0.025, 0.04, 2.6, 5);
      const angles = isLeft ? [-0.35, 0.1, 0.55, 0.95] : [0.35, -0.1, -0.55, -0.95];
      for (let i = 0; i < 4; i++) {
        const finger = new THREE.Mesh(fingerGeo, wingBoneMat);
        finger.position.set(s * (2.8 - i * 0.3), 0.6 - i * 0.5, 0);
        finger.rotation.z = angles[i];
        wingRoot.add(finger);
      }

      // Spanned Webbed Bat Wing Membrane
      const memGeo = new THREE.BufferGeometry();
      const memVerts = new Float32Array([
        // Panel 1: Shoulder to finger 1
        0, 0, 0,
        s * 2.2, 1.6, 0.05,
        s * 3.6, 0.8, 0,
        // Panel 2: Finger 1 to finger 2
        0, 0, 0,
        s * 3.6, 0.8, 0,
        s * 3.2, -0.6, -0.05,
        // Panel 3: Finger 2 to finger 3
        0, 0, 0,
        s * 3.2, -0.6, -0.05,
        s * 2.2, -1.4, 0,
        // Panel 4: Flank attachment
        0, 0, 0,
        s * 2.2, -1.4, 0,
        s * 0.8, -1.0, 0.05,
      ]);
      const memUvs = new Float32Array([
        0, 0, 1, 1, 1, 0.5,
        0, 0, 1, 0.5, 0.8, 0,
        0, 0, 0.8, 0, 0.5, 0,
        0, 0, 0.5, 0, 0.2, 0,
      ]);
      memGeo.setAttribute('position', new THREE.BufferAttribute(memVerts, 3));
      memGeo.setAttribute('uv', new THREE.BufferAttribute(memUvs, 2));
      memGeo.computeVertexNormals();

      const membrane = new THREE.Mesh(memGeo, wingMembraneMat);
      wingRoot.add(membrane);

      return wingRoot;
    };

    const leftWing = createBatWing(true);
    const rightWing = createBatWing(false);
    root.add(leftWing, rightWing);

    return { mesh: root, leftWing, rightWing, core, eyes, alive: false };
  }

  private buildAngelMesh(): AngelVisual {
    const root = new THREE.Group();
    const burlapPbr = this.ctx.assets.pbr('burlap', 2, 3);

    // 1. Seraphic Sacred Vestments (Layered White & Gold)
    const bodyGeo = new THREE.CylinderGeometry(0.35, 0.8, 2.5, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: burlapPbr.map,
      normalMap: burlapPbr.normalMap,
      roughnessMap: burlapPbr.roughnessMap,
      roughness: 0.4,
      metalness: 0.1,
      emissive: 0xfff2dc,
      emissiveIntensity: 0.6,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.2;
    root.add(body);

    // Golden Obi & Stole Trim
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xf5c842,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0xbb8f1c,
      emissiveIntensity: 0.9,
    });
    const sashGeo = new THREE.TorusGeometry(0.45, 0.06, 8, 24);
    const sash = new THREE.Mesh(sashGeo, trimMat);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 0.62;
    root.add(sash);

    // Cascading stole ribbons
    const ribbonGeo = new THREE.BoxGeometry(0.16, 1.5, 0.03);
    for (const side of [-0.2, 0.2]) {
      const ribbon = new THREE.Mesh(ribbonGeo, trimMat);
      ribbon.position.set(side, -0.15, 0.46);
      ribbon.rotation.x = 0.14;
      root.add(ribbon);
    }

    // Seraphic Head
    const headGeo = new THREE.SphereGeometry(0.3, 20, 20);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfffaee,
      roughness: 0.38,
      emissive: 0xfff6e8,
      emissiveIntensity: 0.5,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.55;
    root.add(head);

    // 2. Solar Mandorla / Radiant Golden Halo
    const haloGroup = new THREE.Group();
    haloGroup.position.set(0, 2.05, 0);

    const innerHaloGeo = new THREE.TorusGeometry(0.46, 0.05, 12, 32);
    const innerHaloMat = new THREE.MeshBasicMaterial({ color: 0xffea55 });
    const innerHalo = new THREE.Mesh(innerHaloGeo, innerHaloMat);
    innerHalo.rotation.x = Math.PI * 0.35;
    haloGroup.add(innerHalo);

    const outerHaloGroup = new THREE.Group();
    const raySpokeGeo = new THREE.BoxGeometry(0.045, 1.6, 0.03);
    for (let r = 0; r < 8; r++) {
      const spoke = new THREE.Mesh(raySpokeGeo, innerHaloMat);
      spoke.rotation.z = (r * Math.PI) / 8;
      outerHaloGroup.add(spoke);
    }
    outerHaloGroup.rotation.x = Math.PI * 0.35;
    haloGroup.add(outerHaloGroup);
    root.add(haloGroup);

    // 3. Six-Winged Seraphic Plumage (Radiant Golden Feathers)
    const featherMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      emissive: 0xfffaea,
      emissiveIntensity: 0.75,
      side: THREE.DoubleSide,
    });
    const featherGoldMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.85,
      roughness: 0.2,
      emissive: 0xffaa00,
      emissiveIntensity: 1.2,
      side: THREE.DoubleSide,
    });

    const createSeraphWing = (isLeft: boolean, lengthScale: number, angleOffset: number) => {
      const wingRoot = new THREE.Group();
      const s = isLeft ? -1 : 1;

      const sparGeo = new THREE.CylinderGeometry(0.045, 0.07, 2.6 * lengthScale, 6);
      const spar = new THREE.Mesh(sparGeo, trimMat);
      spar.position.set(s * 1.1 * lengthScale, 0.6 * lengthScale, 0);
      spar.rotation.z = s * (0.85 + angleOffset);
      wingRoot.add(spar);

      const featherGeo = new THREE.BoxGeometry(0.22 * lengthScale, 1.8 * lengthScale, 0.035);
      for (let i = 0; i < 8; i++) {
        const isGold = i === 0 || i === 7;
        const feather = new THREE.Mesh(featherGeo, isGold ? featherGoldMat : featherMat);
        const u = i / 7;
        feather.position.set(
          s * (0.55 + u * 2.4 * lengthScale),
          (0.85 - u * 1.4) * lengthScale,
          (i % 2) * 0.04
        );
        feather.rotation.z = s * (0.7 + u * 1.1 + angleOffset * 0.5);
        const sc = (1.2 - u * 0.3) * lengthScale;
        feather.scale.set(sc, sc, 1);
        wingRoot.add(feather);
      }
      return wingRoot;
    };

    // Upper Grand Wings (Soaring high above to frame the halo)
    const upperL = createSeraphWing(true, 1.4, -0.85);
    upperL.position.set(-0.25, 1.3, -0.1);
    const upperR = createSeraphWing(false, 1.4, -0.85);
    upperR.position.set(0.25, 1.3, -0.1);

    // Mid Mantle Wings (Spreading outward horizontally)
    const midL = createSeraphWing(true, 1.25, 0.05);
    midL.position.set(-0.35, 0.75, -0.05);
    const midR = createSeraphWing(false, 1.25, 0.05);
    midR.position.set(0.35, 0.75, -0.05);

    // Lower Swift Wings (Trailing downward around the robes)
    const lowerL = createSeraphWing(true, 0.95, 0.95);
    lowerL.position.set(-0.28, 0.35, 0.05);
    const lowerR = createSeraphWing(false, 0.95, 0.95);
    lowerR.position.set(0.28, 0.35, 0.05);

    root.add(upperL, upperR, midL, midR, lowerL, lowerR);

    // 4. Volumetric Ascending Holy Light Column
    const beamGeo = new THREE.CylinderGeometry(0.4, 2.2, 18, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff2bb,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const lightBeam = new THREE.Mesh(beamGeo, beamMat);
    lightBeam.position.y = -8.5;
    root.add(lightBeam);

    return {
      mesh: root,
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
      this.spawnParticleBurst(worldX(e.x), e.y, 0xff2200, 36);
    } else if (e.type === 'angel_bless') {
      this.spawnParticleBurst(worldX(e.x), e.y, 0xfff0aa, 48);
    } else if (e.type === 'angel_struck') {
      this.spawnParticleBurst(worldX(e.x), e.y, 0xff5533, 40);
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
        new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed + 2, (Math.random() - 0.5) * 4)
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
    if (!this.active && game.phase !== 'celestial') {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    this.time += dt;

    const celestial = game.celestial;
    const demons = celestial.demons;
    const angels = celestial.angels;

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
        v.mesh.position.set(worldX(d.x), d.y, 0);

        // Flapping animation
        const flap = Math.sin(this.time * 8.5 + d.id * 1.7) * 0.48;
        v.leftWing.rotation.z = flap;
        v.rightWing.rotation.z = -flap;
        v.leftWing.rotation.y = Math.cos(this.time * 8.5 + d.id * 1.7) * 0.25;
        v.rightWing.rotation.y = -Math.cos(this.time * 8.5 + d.id * 1.7) * 0.25;

        // Pulse molten core
        const coreScale = 1.0 + Math.sin(this.time * 5.0 + d.id * 2.1) * 0.22;
        v.core.scale.setScalar(coreScale);

        // Dive angle tilt
        v.mesh.rotation.z = d.vx * -0.06;
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
        v.mesh.position.set(worldX(a.x), a.y, 0);

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
      const wx = worldX(game.warrior.x);
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
