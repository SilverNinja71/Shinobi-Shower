import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { Demon, Angel } from '../celestial/CelestialBattle.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { worldX } from '../render/RenderContext.ts';

interface DemonVisual {
  mesh: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  eyes: THREE.Mesh;
  alive: boolean;
}

interface AngelVisual {
  mesh: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  halo: THREE.Mesh;
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
 * Renders Abyssal Demons (diving shadowy winged fiends), Ascending Angels (seraphic winged beings),
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

    // Build pools of 12 demons and 4 angels
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
    const auraGeo = new THREE.CylinderGeometry(0.08, 0.12, 1.6, 12);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xfff0aa,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.lightBladeAura = new THREE.Mesh(auraGeo, auraMat);
    this.lightBladeAura.visible = false;
    this.group.add(this.lightBladeAura);

    const beamGeo = new THREE.ConeGeometry(0.3, 2.2, 12);
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
    const leatherPbr = this.ctx.assets.pbr('leather', 1.5, 1.5);

    // Body: Textured dark volcanic slate exoskeleton
    const bodyGeo = new THREE.ConeGeometry(0.5, 1.4, 7);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x221526,
      map: slatePbr.map,
      normalMap: slatePbr.normalMap,
      roughnessMap: slatePbr.roughnessMap,
      roughness: 0.65,
      metalness: 0.35,
      emissive: 0x1f0612,
      emissiveIntensity: 0.4,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.x = Math.PI;
    root.add(body);

    // Glowing Molten Demonic Core (chest)
    const coreGeo = new THREE.SphereGeometry(0.18, 12, 12);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 0.1, 0.25);
    root.add(core);

    // Horned Head
    const headGeo = new THREE.DodecahedronGeometry(0.35, 1);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 0.65;
    root.add(head);

    // Glowing Crimson Eyes
    const eyesGeo = new THREE.BoxGeometry(0.26, 0.09, 0.12);
    const eyesMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const eyes = new THREE.Mesh(eyesGeo, eyesMat);
    eyes.position.set(0, 0.68, 0.3);
    root.add(eyes);

    // Menacing Curved Horns
    const hornMat = new THREE.MeshStandardMaterial({
      color: 0x1a060d,
      emissive: 0xff2200,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });
    for (const side of [-1, 1]) {
      const hornCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.15, 0.85, 0.05),
        new THREE.Vector3(side * 0.45, 1.15, -0.05),
        new THREE.Vector3(side * 0.35, 1.45, -0.2),
      ]);
      const hornGeo = new THREE.TubeGeometry(hornCurve, 12, 0.07, 6, false);
      const horn = new THREE.Mesh(hornGeo, hornMat);
      root.add(horn);
    }

    // Spiked Pauldrons (Shoulders)
    const pauldronGeo = new THREE.ConeGeometry(0.2, 0.4, 4);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pauldronGeo, bodyMat);
      p.position.set(side * 0.48, 0.45, 0);
      p.rotation.z = -side * 0.8;
      root.add(p);
    }

    // Articulated Bat Wings with leather PBR membranes & bone struts
    const wingBoneMat = new THREE.MeshStandardMaterial({
      color: 0x180d1e,
      roughness: 0.5,
    });
    const wingMembraneMat = new THREE.MeshStandardMaterial({
      color: 0x3d152b,
      map: leatherPbr.map,
      normalMap: leatherPbr.normalMap,
      roughnessMap: leatherPbr.roughnessMap,
      roughness: 0.7,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });

    const createBatWing = (isLeft: boolean) => {
      const wingRoot = new THREE.Group();
      wingRoot.position.set(isLeft ? -0.28 : 0.28, 0.35, -0.05);

      // Main arm bone
      const armGeo = new THREE.CylinderGeometry(0.045, 0.06, 1.4, 6);
      const arm = new THREE.Mesh(armGeo, wingBoneMat);
      arm.position.set(isLeft ? -0.7 : 0.7, 0.4, 0);
      arm.rotation.z = isLeft ? 0.7 : -0.7;
      wingRoot.add(arm);

      // 3 Finger struts
      const fingerGeo = new THREE.CylinderGeometry(0.02, 0.035, 1.3, 5);
      const angles = isLeft ? [-0.2, 0.3, 0.8] : [0.2, -0.3, -0.8];
      for (let i = 0; i < 3; i++) {
        const finger = new THREE.Mesh(fingerGeo, wingBoneMat);
        finger.position.set(isLeft ? -1.3 : 1.3, 0.7 - i * 0.4, 0);
        finger.rotation.z = angles[i];
        wingRoot.add(finger);
      }

      // Spanned webbed membrane
      const s = isLeft ? -1 : 1;
      const memGeo = new THREE.BufferGeometry();
      const memVerts = new Float32Array([
        0, 0, 0,
        s * 1.5, 0.9, 0.1,
        s * 2.2, 0.1, 0,
        0, 0, 0,
        s * 2.2, 0.1, 0,
        s * 1.6, -0.7, -0.1,
        0, 0, 0,
        s * 1.6, -0.7, -0.1,
        s * 0.8, -0.9, 0,
      ]);
      memGeo.setAttribute('position', new THREE.BufferAttribute(memVerts, 3));
      memGeo.computeVertexNormals();
      const membrane = new THREE.Mesh(memGeo, wingMembraneMat);
      wingRoot.add(membrane);

      return wingRoot;
    };

    const leftWing = createBatWing(true);
    const rightWing = createBatWing(false);
    root.add(leftWing, rightWing);

    return { mesh: root, leftWing, rightWing, eyes, alive: false };
  }

  private buildAngelMesh(): AngelVisual {
    const root = new THREE.Group();
    const burlapPbr = this.ctx.assets.pbr('burlap', 2, 3);

    // Body: Seraphic flowing white/gold robes with textured weave
    const bodyGeo = new THREE.ConeGeometry(0.55, 2.0, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: burlapPbr.map,
      normalMap: burlapPbr.normalMap,
      roughnessMap: burlapPbr.roughnessMap,
      roughness: 0.4,
      metalness: 0.1,
      emissive: 0xfff2cc,
      emissiveIntensity: 0.45,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    root.add(body);

    // Golden Sash / Trim at collar and waist
    const trimGeo = new THREE.TorusGeometry(0.42, 0.05, 8, 20);
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xf5c842,
      metalness: 0.85,
      roughness: 0.25,
      emissive: 0x997711,
      emissiveIntensity: 0.6,
    });
    const sash = new THREE.Mesh(trimGeo, trimMat);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 0.35;
    root.add(sash);

    // Head
    const headGeo = new THREE.SphereGeometry(0.28, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfff5ea,
      roughness: 0.5,
      emissive: 0xfff0dd,
      emissiveIntensity: 0.3,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.15;
    root.add(head);

    // Radiant Concentric Golden Halo with Outer Starburst
    const haloGeo = new THREE.TorusGeometry(0.42, 0.045, 8, 32);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffea55 });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.58;
    root.add(halo);

    const outerHaloGeo = new THREE.RingGeometry(0.48, 0.54, 16);
    const outerHaloMat = new THREE.MeshBasicMaterial({
      color: 0xfffa88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    });
    const outerHalo = new THREE.Mesh(outerHaloGeo, outerHaloMat);
    outerHalo.rotation.x = Math.PI / 2;
    outerHalo.position.y = 1.58;
    root.add(outerHalo);

    // Multi-tiered Feathered Seraphic Wings (6 distinct fanned feather blades per wing)
    const featherMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      emissive: 0xfffae8,
      emissiveIntensity: 0.55,
      side: THREE.DoubleSide,
    });

    const createSeraphWing = (isLeft: boolean) => {
      const wingRoot = new THREE.Group();
      wingRoot.position.set(isLeft ? -0.28 : 0.28, 0.75, -0.05);

      const s = isLeft ? -1 : 1;
      // Main wing bone spar
      const sparGeo = new THREE.CylinderGeometry(0.04, 0.06, 1.8, 6);
      const spar = new THREE.Mesh(sparGeo, trimMat);
      spar.position.set(s * 0.8, 0.5, 0);
      spar.rotation.z = s * 0.85;
      wingRoot.add(spar);

      // 6 Individual layered feather blades
      const featherGeo = new THREE.BoxGeometry(0.18, 1.4, 0.03);
      for (let i = 0; i < 6; i++) {
        const feather = new THREE.Mesh(featherGeo, featherMat);
        const u = i / 5;
        feather.position.set(s * (0.5 + u * 1.5), 0.7 - u * 1.1, (i % 2) * 0.04);
        feather.rotation.z = s * (0.6 + u * 0.9);
        const scale = 1.2 - u * 0.35;
        feather.scale.set(scale, scale, 1);
        wingRoot.add(feather);
      }
      return wingRoot;
    };

    const leftWing = createSeraphWing(true);
    const rightWing = createSeraphWing(false);
    root.add(leftWing, rightWing);

    // Ascending Divine Light Column
    const beamGeo = new THREE.CylinderGeometry(0.35, 1.8, 16, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff0aa,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const lightBeam = new THREE.Mesh(beamGeo, beamMat);
    lightBeam.position.y = -8.0;
    root.add(lightBeam);

    return { mesh: root, leftWing, rightWing, halo, lightBeam, alive: false };
  }

  private spawnSparks(x: number, y: number, colorHex: number, count = 28): void {
    const positions = new Float32Array(count * 3);
    const vels: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      const speed = 4 + Math.random() * 8;
      const angle = Math.random() * Math.PI * 2;
      vels.push(new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, (Math.random() - 0.5) * 4));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: colorHex,
      size: 0.22,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.group.add(points);
    this.bursts.push({ mesh: points, velocities: vels, life: 0, maxLife: 0.65 });
  }

  handleEvent(e: GameEvent, game: Game): void {
    if (e.type === 'celestial_start') {
      this.active = true;
      this.group.visible = true;
    } else if (e.type === 'demon_slain') {
      this.spawnSparks(worldX(e.x), e.y, 0xff2244, 36);
    } else if (e.type === 'angel_bless') {
      this.spawnSparks(worldX(e.x), e.y, 0xffea66, 45);
    } else if (e.type === 'angel_struck') {
      this.spawnSparks(worldX(e.x), e.y, 0xffeeaa, 50);
    }
  }

  update(dt: number, game: Game): void {
    if (!this.active && game.phase !== 'celestial') {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.time += dt;

    const battle = game.celestial;

    // --- Update Demons ---
    const activeDemonIds = new Set<number>();
    for (const d of battle.demons) {
      if (!d.alive) continue;
      activeDemonIds.add(d.id);
      let vis = this.demonMap.get(d.id);
      if (!vis) {
        vis = this.demonPool.find((v) => !v.alive);
        if (vis) {
          vis.alive = true;
          vis.mesh.visible = true;
          this.demonMap.set(d.id, vis);
        }
      }
      if (vis) {
        vis.mesh.position.set(worldX(d.x), d.y, d.z);
        // Face moving direction
        if (Math.abs(d.vx) > 0.1) {
          vis.mesh.rotation.y = d.vx > 0 ? 0 : Math.PI;
        }
        // Flap bat wings
        const flap = Math.sin(d.wingAngle) * 0.6;
        vis.leftWing.rotation.y = flap;
        vis.rightWing.rotation.y = -flap;
        // Scale for drake vs imp
        const s = d.kind === 'drake' ? 1.6 : 1.0;
        vis.mesh.scale.set(s, s, s);
      }
    }

    // Clean up freed demons
    for (const [id, vis] of this.demonMap.entries()) {
      if (!activeDemonIds.has(id)) {
        vis.alive = false;
        vis.mesh.visible = false;
        this.demonMap.delete(id);
      }
    }

    // --- Update Angels ---
    const activeAngelIds = new Set<number>();
    for (const a of battle.angels) {
      if (!a.alive) continue;
      activeAngelIds.add(a.id);
      let vis = this.angelMap.get(a.id);
      if (!vis) {
        vis = this.angelPool.find((v) => !v.alive);
        if (vis) {
          vis.alive = true;
          vis.mesh.visible = true;
          this.angelMap.set(a.id, vis);
        }
      }
      if (vis) {
        vis.mesh.position.set(worldX(a.x), a.y, a.z);
        // Gentle wing flap
        const flap = Math.sin(a.wingAngle) * 0.45;
        vis.leftWing.rotation.y = flap;
        vis.rightWing.rotation.y = -flap;
        // Halo gentle bob
        vis.halo.position.y = 1.45 + Math.sin(this.time * 3 + a.id) * 0.05;
        // Light shaft pulse
        (vis.lightBeam.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(this.time * 2 + a.id) * 0.1;
      }
    }

    // Clean up freed angels
    for (const [id, vis] of this.angelMap.entries()) {
      if (!activeAngelIds.has(id)) {
        vis.alive = false;
        vis.mesh.visible = false;
        this.angelMap.delete(id);
      }
    }

    // --- Light Blade Visual ---
    if (battle.lightBladeActive) {
      this.lightBladeAura.visible = true;
      this.lightBladeBeam.visible = true;
      const wx = worldX(game.warrior.x);
      const wy = game.feetY + 1.1;
      const facing = game.warrior.facing;
      this.lightBladeAura.position.set(wx + facing * 0.8, wy, 0.1);
      this.lightBladeAura.rotation.z = -facing * 0.45;
      this.lightBladeBeam.position.set(wx + facing * 1.5, wy, 0.1);
      this.lightBladeBeam.rotation.z = -facing * 0.75;
      (this.lightBladeAura.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(this.time * 15) * 0.2;
    } else {
      this.lightBladeAura.visible = false;
      this.lightBladeBeam.visible = false;
    }

    // --- Update Spark Bursts ---
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const p = b.life / b.maxLife;
      if (p >= 1) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      (b.mesh.material as THREE.PointsMaterial).opacity = 1 - p;
      const pos = b.mesh.geometry.attributes.position.array as Float32Array;
      for (let j = 0; j < b.velocities.length; j++) {
        const v = b.velocities[j];
        pos[j * 3] += v.x * dt;
        pos[j * 3 + 1] += v.y * dt;
        pos[j * 3 + 2] += v.z * dt;
        v.y -= 9.8 * dt; // Gravity
      }
      b.mesh.geometry.attributes.position.needsUpdate = true;
    }
  }
}

