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

    // Body: Dark jagged shadowy torso
    const bodyGeo = new THREE.ConeGeometry(0.45, 1.2, 5);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x140a18,
      roughness: 0.6,
      metalness: 0.4,
      emissive: 0x180006,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.x = Math.PI;
    root.add(body);

    // Horned Head
    const headGeo = new THREE.SphereGeometry(0.32, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 0.55;
    root.add(head);

    // Glowing Crimson Eyes
    const eyesGeo = new THREE.BoxGeometry(0.24, 0.08, 0.1);
    const eyesMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const eyes = new THREE.Mesh(eyesGeo, eyesMat);
    eyes.position.set(0, 0.55, 0.28);
    root.add(eyes);

    // Horns
    const hornGeo = new THREE.ConeGeometry(0.08, 0.5, 4);
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x3a0812, emissive: 0x550011 });
    const hornL = new THREE.Mesh(hornGeo, hornMat);
    hornL.position.set(-0.2, 0.85, 0);
    hornL.rotation.z = 0.4;
    const hornR = new THREE.Mesh(hornGeo, hornMat);
    hornR.position.set(0.2, 0.85, 0);
    hornR.rotation.z = -0.4;
    root.add(hornL, hornR);

    // Bat Wings (left & right pivoting groups)
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x240c1e,
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    const wingGeo = new THREE.BufferGeometry();
    const wingVertices = new Float32Array([
      0, 0, 0,
      -1.4, 0.6, 0.1,
      -1.8, -0.4, 0,
      0, 0, 0,
      -1.8, -0.4, 0,
      -0.8, -0.8, -0.1
    ]);
    wingGeo.setAttribute('position', new THREE.BufferAttribute(wingVertices, 3));
    wingGeo.computeVertexNormals();

    const leftWing = new THREE.Group();
    leftWing.position.set(-0.25, 0.3, 0);
    const lMesh = new THREE.Mesh(wingGeo, wingMat);
    leftWing.add(lMesh);
    root.add(leftWing);

    const rightWing = new THREE.Group();
    rightWing.position.set(0.25, 0.3, 0);
    const rMesh = new THREE.Mesh(wingGeo, wingMat);
    rMesh.scale.x = -1;
    rightWing.add(rMesh);
    root.add(rightWing);

    return { mesh: root, leftWing, rightWing, eyes, alive: false };
  }

  private buildAngelMesh(): AngelVisual {
    const root = new THREE.Group();

    // Body: Seraphic flowing white/gold robe
    const bodyGeo = new THREE.ConeGeometry(0.5, 1.8, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffeeaa,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    root.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.28, 12, 12);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 1.05;
    root.add(head);

    // Radiant Golden Halo
    const haloGeo = new THREE.TorusGeometry(0.38, 0.05, 8, 24);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffea55 });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.45;
    root.add(halo);

    // Feathered Angelic Wings
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfffae0,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    });
    const wingGeo = new THREE.BufferGeometry();
    const wingVertices = new Float32Array([
      0, 0, 0,
      -1.6, 1.1, 0.1,
      -2.0, 0.1, 0,
      0, 0, 0,
      -2.0, 0.1, 0,
      -1.2, -0.7, -0.1
    ]);
    wingGeo.setAttribute('position', new THREE.BufferAttribute(wingVertices, 3));
    wingGeo.computeVertexNormals();

    const leftWing = new THREE.Group();
    leftWing.position.set(-0.25, 0.6, 0);
    const lMesh = new THREE.Mesh(wingGeo, wingMat);
    leftWing.add(lMesh);
    root.add(leftWing);

    const rightWing = new THREE.Group();
    rightWing.position.set(0.25, 0.6, 0);
    const rMesh = new THREE.Mesh(wingGeo, wingMat);
    rMesh.scale.x = -1;
    rightWing.add(rMesh);
    root.add(rightWing);

    // Ascending Light Shaft beneath the angel
    const beamGeo = new THREE.CylinderGeometry(0.3, 1.2, 12, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff0aa,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const lightBeam = new THREE.Mesh(beamGeo, beamMat);
    lightBeam.position.y = -6.0;
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
