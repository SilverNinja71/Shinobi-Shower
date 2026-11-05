import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';

/**
 * The Heavenly Realm: High above the storm clouds, a radiant golden sea of clouds
 * illuminated by divine sunlight and crepuscular god rays, with floating sacred pillars.
 */
export class CelestialScene implements RenderModule {
  private readonly ctx: RenderContext;
  readonly group = new THREE.Group();

  // Celestial Environment Lighting
  private readonly sunLight: THREE.DirectionalLight;
  private readonly ambientHemi: THREE.HemisphereLight;

  // Cloud floor meshes
  private readonly cloudDiscs: THREE.Mesh[] = [];
  private readonly cloudBillows: THREE.Mesh[] = [];

  // Divine Sunbeams / God Rays
  private readonly godRays: THREE.Mesh[] = [];

  // Floating sacred pillar fragments
  private readonly floatingPillars: THREE.Mesh[] = [];

  // Golden stardust / divine motes
  private readonly motes: THREE.Points;
  private readonly motePositions: Float32Array;

  private active = false;
  private time = 0;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.group.name = 'celestial_scene';
    ctx.scene.add(this.group);
    this.group.visible = false;

    // Divine Sunlight
    this.sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
    this.sunLight.position.set(-15, 30, 20);
    this.group.add(this.sunLight);

    // Warm Golden Skylight & cloud bounce
    this.ambientHemi = new THREE.HemisphereLight(0xffbe66, 0x663311, 1.0);
    this.group.add(this.ambientHemi);

    // --- Golden Cloud Floor ---
    // Multi-layered billowy cloud deck
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xdb883e,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: true,
    });

    // Cloud floor base planes (forming the walking surface at y = 0)
    for (let i = 0; i < 7; i++) {
      const geo = new THREE.CylinderGeometry(8 + (i % 3) * 3, 9 + (i % 3) * 3, 1.0, 16);
      const mesh = new THREE.Mesh(geo, cloudMat);
      mesh.position.set((i - 3) * 10, -0.5, (Math.random() - 0.5) * 4);
      mesh.scale.set(1.4, 1.0, 1.2);
      this.cloudDiscs.push(mesh);
      this.group.add(mesh);
    }

    // Billowy cloud domes rolling beneath and behind the warrior
    const billowGeo = new THREE.SphereGeometry(2.0, 16, 14);
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(billowGeo, cloudMat);
      mesh.position.set(
        (Math.random() - 0.5) * 55,
        -2.0 + (Math.random() - 0.5) * 0.4,
        -6 + Math.random() * 4
      );
      const s = 1.0 + Math.random() * 1.4;
      mesh.scale.set(s * 1.5, s * 0.7, s * 1.2);
      this.cloudBillows.push(mesh);
      this.group.add(mesh);
    }

    // --- Divine God Rays (Crepuscular Beams) ---
    const rayGeo = new THREE.CylinderGeometry(0.3, 3.5, 35, 16, 1, true);
    const rayMat = new THREE.MeshBasicMaterial({
      color: 0xffea99,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (let i = 0; i < 6; i++) {
      const ray = new THREE.Mesh(rayGeo, rayMat);
      ray.position.set((i - 2.5) * 8 + (Math.random() - 0.5) * 4, 16, -10 - Math.random() * 8);
      ray.rotation.z = -0.25 + (Math.random() - 0.5) * 0.1;
      ray.rotation.x = 0.2;
      this.godRays.push(ray);
      this.group.add(ray);
    }

    // --- Floating Sacred Torii Arches & Lantern Ruins ---
    const woodPbr = this.ctx.assets.pbr('plank', 1, 3);
    const slatePbr = this.ctx.assets.pbr('slate', 2, 2);

    const toriiMat = new THREE.MeshStandardMaterial({
      color: 0xc83e20, // Sacred vermilion lacquer
      map: woodPbr.map,
      normalMap: woodPbr.normalMap,
      roughnessMap: woodPbr.roughnessMap,
      roughness: 0.5,
      metalness: 0.1,
    });

    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0x44444c,
      map: slatePbr.map,
      normalMap: slatePbr.normalMap,
      roughnessMap: slatePbr.roughnessMap,
      roughness: 0.7,
      metalness: 0.2,
    });

    // Build 2 magnificent floating Torii archways
    for (const offset of [-16, 16]) {
      const archGroup = new THREE.Group();
      archGroup.position.set(offset, 4.5, -14);
      archGroup.rotation.y = (Math.random() - 0.5) * 0.4;

      // Pillars
      const pillarGeo = new THREE.CylinderGeometry(0.35, 0.45, 8.5, 12);
      const p1 = new THREE.Mesh(pillarGeo, toriiMat);
      p1.position.set(-3.2, 0, 0);
      const p2 = new THREE.Mesh(pillarGeo, toriiMat);
      p2.position.set(3.2, 0, 0);

      // Top curved lintel (Kasagi)
      const lintelGeo = new THREE.BoxGeometry(9.0, 0.65, 0.7);
      const lintel = new THREE.Mesh(lintelGeo, toriiMat);
      lintel.position.set(0, 4.2, 0);

      // Tie beam (Nuki)
      const tieGeo = new THREE.BoxGeometry(7.2, 0.4, 0.45);
      const tie = new THREE.Mesh(tieGeo, toriiMat);
      tie.position.set(0, 2.9, 0);

      archGroup.add(p1, p2, lintel, tie);
      this.floatingPillars.push(p1, p2, lintel, tie);
      this.group.add(archGroup);
    }

    // Floating sacred stone lanterns with warm amber glow
    const lanternGeo = new THREE.BoxGeometry(0.7, 1.2, 0.7);
    const glowGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });
    for (let i = 0; i < 4; i++) {
      const lanternGroup = new THREE.Group();
      lanternGroup.position.set(-20 + i * 13, 2.5 + Math.sin(i) * 1.5, -8 - (i % 2) * 5);
      const stone = new THREE.Mesh(lanternGeo, lanternMat);
      const fire = new THREE.Mesh(glowGeo, glowMat);
      fire.position.y = 0.1;
      lanternGroup.add(stone, fire);
      this.group.add(lanternGroup);
      this.floatingPillars.push(stone);
    }

    // --- Golden Stardust / Holy Motes ---
    const moteCount = 180;
    this.motePositions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      this.motePositions[i * 3] = (Math.random() - 0.5) * 60;
      this.motePositions[i * 3 + 1] = Math.random() * 15;
      this.motePositions[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    const motesGeo = new THREE.BufferGeometry();
    motesGeo.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3));
    const motesMat = new THREE.PointsMaterial({
      color: 0xffe577,
      size: 0.18,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(motesGeo, motesMat);
    this.group.add(this.motes);
  }

  handleEvent(e: GameEvent, game: Game): void {
    if (e.type === 'celestial_start') {
      this.active = true;
      this.group.visible = true;
      // Change sky/fog to glorious warm golden twilight
      this.ctx.scene.background = new THREE.Color(0xd48844);
      if (this.ctx.scene.fog instanceof THREE.FogExp2) {
        this.ctx.scene.fog.color.setHex(0xd48844);
        this.ctx.scene.fog.density = 0.008;
      }
    }
  }

  update(dt: number, game: Game): void {
    if (!this.active && game.phase !== 'celestial') {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.time += dt;

    // Undulate cloud billows gently
    for (let i = 0; i < this.cloudBillows.length; i++) {
      const b = this.cloudBillows[i];
      b.position.y += Math.sin(this.time * 1.2 + i) * 0.003;
    }

    // Bob floating pillars
    for (let i = 0; i < this.floatingPillars.length; i++) {
      const p = this.floatingPillars[i];
      p.position.y += Math.sin(this.time * 0.8 + i * 2) * 0.004;
      p.rotation.y += dt * 0.04;
    }

    // Pulse god rays
    for (let i = 0; i < this.godRays.length; i++) {
      const r = this.godRays[i];
      (r.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(this.time * 1.5 + i * 1.2) * 0.06;
    }

    // Rise stardust motes
    const pos = this.motePositions;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[i * 3 + 1] += dt * (0.6 + (i % 5) * 0.2);
      if (pos[i * 3 + 1] > 18) pos[i * 3 + 1] = 0;
      pos[i * 3] += Math.sin(this.time + i) * dt * 0.3;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
  }
}

