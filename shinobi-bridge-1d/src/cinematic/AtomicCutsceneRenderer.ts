import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { worldX } from '../render/RenderContext.ts';

/**
 * Renders the dramatic "Atomic Cleave" cutscene:
 * 1. Freeze / Focus: Droplet freezes suspended, camera zooms in smoothly.
 * 2. Atom Zoom: Extreme macro dive into droplet interior, revealing pulsing nucleus and spinning electron rings.
 * 3. Slice: Glowing katana blade cuts cleanly through the atomic nucleus in ultra slow motion.
 * 4. Fission: Blinding white-hot flash, chromatic split, fission detonation.
 * 5. Explosion: Massive nuclear shockwave obliteration of the bridge, launching warrior skyward into the heavens.
 */
export class AtomicCutsceneRenderer implements RenderModule {
  private readonly ctx: RenderContext;
  private readonly group = new THREE.Group();

  // Atom 3D visual elements
  private readonly atomGroup = new THREE.Group();
  private readonly nucleusGroup = new THREE.Group();
  private readonly nucleons: THREE.Mesh[] = [];
  private readonly electronRings: THREE.Line[] = [];
  private readonly electrons: THREE.Mesh[] = [];
  private readonly dropletMesh: THREE.Mesh;
  private readonly bladeMesh: THREE.Mesh;

  // Nuclear detonation elements
  private readonly explosionGroup = new THREE.Group();
  private readonly shockwaveMesh: THREE.Mesh;
  private readonly fireballMesh: THREE.Mesh;
  private readonly flashQuad: THREE.Mesh;
  private readonly flashMaterial: THREE.MeshBasicMaterial;

  // Shattered bridge physics debris
  private readonly debrisMeshes: THREE.Mesh[] = [];
  private readonly debrisVelocities: THREE.Vector3[] = [];
  private readonly debrisRotations: THREE.Vector3[] = [];

  // Skyward launch speedlines
  private readonly speedlines: THREE.LineSegments;

  private active = false;
  private time = 0;
  private warriorWorldX = 0;
  private warriorWorldY = 0;
  private flashIntensity = 0;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.group.name = 'atomic_cutscene';
    ctx.scene.add(this.group);
    this.group.visible = false;

    // --- Build Procedural Atom ---
    // Droplet outer shell
    const dropletGeo = new THREE.SphereGeometry(1.6, 32, 32);
    const dropletMat = new THREE.MeshPhysicalMaterial({
      color: 0x99ccff,
      transmission: 0.88,
      opacity: 1,
      transparent: true,
      roughness: 0.05,
      ior: 1.333,
      metalness: 0.1,
    });
    this.dropletMesh = new THREE.Mesh(dropletGeo, dropletMat);
    this.atomGroup.add(this.dropletMesh);

    // Nucleus: 14 clustered spheres (protons = ruby/gold, neutrons = cyan/blue)
    const nucleonGeo = new THREE.SphereGeometry(0.24, 16, 16);
    const protonMat = new THREE.MeshStandardMaterial({
      color: 0xff3344,
      emissive: 0xff1122,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });
    const neutronMat = new THREE.MeshStandardMaterial({
      color: 0x3399ff,
      emissive: 0x1144ff,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });

    for (let i = 0; i < 14; i++) {
      const isProton = i % 2 === 0;
      const mesh = new THREE.Mesh(nucleonGeo, isProton ? protonMat : neutronMat);
      const phi = Math.acos(-1 + (2 * i) / 14);
      const theta = Math.sqrt(14 * Math.PI) * phi;
      const r = 0.42 + (Math.random() - 0.5) * 0.12;
      mesh.position.set(r * Math.cos(theta) * Math.sin(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(phi));
      this.nucleons.push(mesh);
      this.nucleusGroup.add(mesh);
    }
    this.atomGroup.add(this.nucleusGroup);

    // 3 Tilted Electron Orbital Rings with orbiting electron beads
    const electronGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const electronMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
    const angles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];

    for (let i = 0; i < 3; i++) {
      const curve = new THREE.EllipseCurve(0, 0, 1.25, 1.25, 0, 2 * Math.PI, false, 0);
      const points = curve.getPoints(64);
      const ringGeo = new THREE.BufferGeometry().setFromPoints(points);
      const ringMat = new THREE.LineBasicMaterial({
        color: 0x77eeff,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Line(ringGeo, ringMat);
      ring.rotation.x = Math.PI * 0.35 + i * 0.25;
      ring.rotation.y = angles[i];
      this.electronRings.push(ring);
      this.atomGroup.add(ring);

      const eMesh = new THREE.Mesh(electronGeo, electronMat);
      this.electrons.push(eMesh);
      this.atomGroup.add(eMesh);
    }

    // Incandescent Katana Blade
    const bladeGeo = new THREE.BoxGeometry(0.04, 3.2, 0.45);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffeebb,
      emissiveIntensity: 2.5,
      roughness: 0.1,
    });
    this.bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
    this.bladeMesh.rotation.z = Math.PI * 0.3;
    this.atomGroup.add(this.bladeMesh);
    this.group.add(this.atomGroup);

    // --- Nuclear Detonation FX ---
    // Shockwave Ring
    const shockGeo = new THREE.TorusGeometry(1, 0.18, 16, 64);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0xffeedd,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shockwaveMesh = new THREE.Mesh(shockGeo, shockMat);
    this.shockwaveMesh.rotation.x = Math.PI / 2;
    this.explosionGroup.add(this.shockwaveMesh);

    // Fireball Sphere
    const fireGeo = new THREE.SphereGeometry(1, 32, 32);
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff8822,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.fireballMesh = new THREE.Mesh(fireGeo, fireMat);
    this.explosionGroup.add(this.fireballMesh);
    this.group.add(this.explosionGroup);

    // Fullscreen blinding flash quad attached to camera
    const flashGeo = new THREE.PlaneGeometry(100, 100);
    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.flashQuad = new THREE.Mesh(flashGeo, this.flashMaterial);
    this.flashQuad.position.z = -1;
    this.flashQuad.renderOrder = 9999;
    ctx.camera.add(this.flashQuad);

    // Shattered bridge planks
    const plankGeo = new THREE.BoxGeometry(0.35, 0.12, 1.8);
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.8 });
    for (let i = 0; i < 36; i++) {
      const mesh = new THREE.Mesh(plankGeo, plankMat);
      this.debrisMeshes.push(mesh);
      this.debrisVelocities.push(new THREE.Vector3());
      this.debrisRotations.push(new THREE.Vector3());
      this.group.add(mesh);
    }

    // Skyward speedlines
    const lineCount = 80;
    const linePos: number[] = [];
    for (let i = 0; i < lineCount; i++) {
      const x = (Math.random() - 0.5) * 20;
      const z = (Math.random() - 0.5) * 10;
      const y0 = Math.random() * 40 - 20;
      const y1 = y0 + 6 + Math.random() * 8;
      linePos.push(x, y0, z, x, y1, z);
    }
    const linesGeo = new THREE.BufferGeometry();
    linesGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    const linesMat = new THREE.LineBasicMaterial({
      color: 0xffe899,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    });
    this.speedlines = new THREE.LineSegments(linesGeo, linesMat);
    this.group.add(this.speedlines);
    this.speedlines.visible = false;
  }

  handleEvent(e: GameEvent, game: Game): void {
    if (e.type === 'atomic_trigger') {
      this.active = true;
      this.group.visible = true;
      this.time = 0;
      this.warriorWorldX = worldX(e.x);
      this.warriorWorldY = e.y;
      this.atomGroup.position.set(this.warriorWorldX + 0.9, this.warriorWorldY + 1.2, 0);
      this.atomGroup.scale.setScalar(0.01);
      this.atomGroup.visible = true;
      this.explosionGroup.visible = false;
      this.speedlines.visible = false;
      this.flashIntensity = 0;
      this.flashMaterial.opacity = 0;

      // Position debris around bridge
      for (let i = 0; i < this.debrisMeshes.length; i++) {
        const m = this.debrisMeshes[i];
        m.visible = false;
        m.position.set(this.warriorWorldX + (i - 18) * 0.65, this.warriorWorldY - 0.2, (Math.random() - 0.5) * 1.2);
        this.debrisVelocities[i].set((Math.random() - 0.5) * 16, 12 + Math.random() * 22, (Math.random() - 0.5) * 14);
        this.debrisRotations[i].set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      }
    } else if (e.type === 'atomic_fission') {
      this.flashIntensity = 1.0;
    } else if (e.type === 'bridge_collapse') {
      this.atomGroup.visible = false;
      this.explosionGroup.visible = true;
      this.explosionGroup.position.set(this.warriorWorldX, this.warriorWorldY, 0);
      for (const m of this.debrisMeshes) m.visible = true;
    } else if (e.type === 'celestial_start') {
      this.active = false;
      this.group.visible = false;
      this.flashMaterial.opacity = 0;
      this.speedlines.visible = false;
    }
  }

  update(dt: number, game: Game): void {
    if (!this.active && game.phase !== 'cutscene') {
      if (this.flashIntensity > 0) {
        this.flashIntensity = Math.max(0, this.flashIntensity - dt * 2.0);
        this.flashMaterial.opacity = this.flashIntensity;
      }
      return;
    }

    this.time += dt;
    const sim = game.cutscene;
    const phase = sim.phase;
    const p = sim.progress;

    // Fade flash
    if (this.flashIntensity > 0) {
      this.flashIntensity = Math.max(0, this.flashIntensity - dt * 1.5);
      this.flashMaterial.opacity = this.flashIntensity;
    }

    // Phase 1: Freeze (0 - 1.2s)
    if (phase === 'freeze') {
      this.atomGroup.visible = true;
      const scale = THREE.MathUtils.lerp(0.01, 0.4, p);
      this.atomGroup.scale.setScalar(scale);
      this.bladeMesh.position.set(-2.5, 2.5, 0);
      this.nucleusGroup.position.set(0, 0, 0);
    }
    // Phase 2: Macro Atom Zoom (1.2 - 2.8s)
    else if (phase === 'atom_zoom') {
      this.atomGroup.visible = true;
      const scale = THREE.MathUtils.lerp(0.4, 2.2, p);
      this.atomGroup.scale.setScalar(scale);
      // Spin electrons fast
      for (let i = 0; i < 3; i++) {
        const ring = this.electronRings[i];
        ring.rotation.z += dt * (12 + i * 4);
        const theta = this.time * (18 + i * 5);
        this.electrons[i].position.set(
          Math.cos(theta) * 1.25 * Math.cos(ring.rotation.y),
          Math.sin(theta) * 1.25,
          Math.cos(theta) * 1.25 * Math.sin(ring.rotation.y)
        );
      }
      // Nucleus vibrations
      for (let i = 0; i < this.nucleons.length; i++) {
        const n = this.nucleons[i];
        n.position.x += (Math.random() - 0.5) * 0.02;
        n.position.y += (Math.random() - 0.5) * 0.02;
      }
      // Blade approaches
      const bladeX = THREE.MathUtils.lerp(-3.0, -0.6, p);
      const bladeY = THREE.MathUtils.lerp(3.0, 0.6, p);
      this.bladeMesh.position.set(bladeX, bladeY, 0);
    }
    // Phase 3: Slice (2.8 - 3.8s)
    else if (phase === 'slice') {
      // Blade sweeps cleanly across the nucleus center!
      const bladeX = THREE.MathUtils.lerp(-0.6, 2.5, p);
      const bladeY = THREE.MathUtils.lerp(0.6, -2.5, p);
      this.bladeMesh.position.set(bladeX, bladeY, 0);

      // Slicing fissure: nucleons start to shear apart along slice plane
      for (let i = 0; i < this.nucleons.length; i++) {
        const n = this.nucleons[i];
        const dir = i % 2 === 0 ? 1 : -1;
        n.position.x += dir * p * 0.04;
        n.position.y += dir * p * 0.04;
      }
      if (p > 0.8) {
        this.flashIntensity = Math.min(1.0, (p - 0.8) * 5.0);
      }
    }
    // Phase 4: Fission (3.8 - 4.6s)
    else if (phase === 'fission') {
      this.flashIntensity = 1.0;
      this.flashMaterial.opacity = 1.0;
      // Nucleus halves violently repel
      for (let i = 0; i < this.nucleons.length; i++) {
        const n = this.nucleons[i];
        const dir = i % 2 === 0 ? 1 : -1;
        n.position.x += dir * dt * 8.0;
        n.position.y += dir * dt * 8.0;
      }
    }
    // Phase 5: Explosion & Bridge Collapse (4.6 - 6.2s)
    else if (phase === 'explosion') {
      this.atomGroup.visible = false;
      this.explosionGroup.visible = true;

      // Expand shockwave torus
      const shockScale = THREE.MathUtils.lerp(1, 45, p);
      this.shockwaveMesh.scale.set(shockScale, shockScale, shockScale);
      (this.shockwaveMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - p);

      // Expand fiery blast sphere
      const fireScale = THREE.MathUtils.lerp(1, 28, Math.pow(p, 0.6));
      this.fireballMesh.scale.set(fireScale, fireScale * 1.5, fireScale);
      (this.fireballMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - p * 0.9);

      // Debris physics simulation
      for (let i = 0; i < this.debrisMeshes.length; i++) {
        const m = this.debrisMeshes[i];
        const v = this.debrisVelocities[i];
        const r = this.debrisRotations[i];
        m.position.x += v.x * dt;
        m.position.y += v.y * dt;
        m.position.z += v.z * dt;
        v.y -= 22 * dt; // Gravity
        m.rotation.x += r.x * dt;
        m.rotation.y += r.y * dt;
        m.rotation.z += r.z * dt;
      }

      this.speedlines.visible = p > 0.4;
      if (this.speedlines.visible) {
        this.speedlines.position.y -= dt * 60;
        if (this.speedlines.position.y < -30) this.speedlines.position.y = 20;
      }
    }
    // Phase 6: Ascend into Heaven (6.2 - 6.8s)
    else if (phase === 'ascend') {
      this.explosionGroup.visible = false;
      this.speedlines.visible = true;
      this.speedlines.position.y -= dt * 90;
      if (this.speedlines.position.y < -30) this.speedlines.position.y = 20;
      // Gentle golden glow
      this.flashMaterial.color.setHex(0xffeebb);
      this.flashIntensity = THREE.MathUtils.lerp(0.8, 0, p);
      this.flashMaterial.opacity = this.flashIntensity;
    }
  }
}
