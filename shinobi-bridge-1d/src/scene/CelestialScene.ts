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
    this.sunLight = new THREE.DirectionalLight(0xffeedd, 3.2);
    this.sunLight.position.set(-15, 30, 20);
    this.group.add(this.sunLight);

    // Warm Golden Skylight & cloud bounce
    this.ambientHemi = new THREE.HemisphereLight(0xffddaa, 0x885533, 1.8);
    this.group.add(this.ambientHemi);

    // --- Golden Cloud Floor ---
    // Multi-layered billowy cloud deck
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffe8cc,
      emissive: 0x442200,
      emissiveIntensity: 0.25,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });

    // Cloud floor base planes
    for (let i = 0; i < 7; i++) {
      const geo = new THREE.CylinderGeometry(8 + (i % 3) * 3, 9 + (i % 3) * 3, 1.2, 16);
      const mesh = new THREE.Mesh(geo, cloudMat);
      mesh.position.set((i - 3) * 10, -0.6, (Math.random() - 0.5) * 6);
      mesh.scale.set(1.4, 0.6, 1.2);
      this.cloudDiscs.push(mesh);
      this.group.add(mesh);
    }

    // Fluffy billowy cloud domes along the arena
    const billowGeo = new THREE.SphereGeometry(2.4, 16, 14);
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(billowGeo, cloudMat);
      mesh.position.set(
        (Math.random() - 0.5) * 55,
        -1.2 + (Math.random() - 0.5) * 0.8,
        -4 + Math.random() * 8
      );
      const s = 1.0 + Math.random() * 1.5;
      mesh.scale.set(s * 1.6, s * 0.8, s * 1.4);
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

    // --- Floating Sacred Torii / Pillar Ruins ---
    const pillarGeo = new THREE.BoxGeometry(0.8, 6.0, 0.8);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0xd45030, // Vermilion sacred shrine color
      roughness: 0.7,
      metalness: 0.1,
    });
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(pillarGeo, pillarMat);
      mesh.position.set(-22 + i * 11, 4 + Math.sin(i * 1.5) * 2, -12 - (i % 2) * 4);
      mesh.rotation.z = (Math.random() - 0.5) * 0.4;
      mesh.rotation.y = (Math.random() - 0.5) * 0.8;
      this.floatingPillars.push(mesh);
      this.group.add(mesh);
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
