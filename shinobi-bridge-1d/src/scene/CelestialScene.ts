import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';

import cloudVert from '../shaders/VolumetricClouds.vert';
import cloudFrag from '../shaders/VolumetricClouds.frag';

/**
 * The Heavenly Realm (Celestial Clash):
 * High above the mortal storm, a majestic anime-style golden sea of clouds (雲海)
 * illuminated by a warm divine sun, deep twilight skies, floating vermilion Torii gates,
 * and glowing sacred stone lanterns.
 */
export class CelestialScene implements RenderModule {
  private readonly ctx: RenderContext;
  readonly group = new THREE.Group();

  // Celestial Environment Lighting
  private readonly sunLight: THREE.DirectionalLight;
  private readonly ambientHemi: THREE.HemisphereLight;
  private readonly sunDisc: THREE.Mesh;
  private readonly sunHalo: THREE.Mesh;

  // Cloud floor meshes and custom volumetric cloud shader
  private readonly cloudMaterial: THREE.ShaderMaterial;
  private readonly cloudBillows: THREE.Mesh[] = [];

  // Soft Crepuscular God Rays
  private readonly godRays: THREE.Mesh[] = [];

  // Distant Holy Mountain Silhouettes
  private readonly mountainSilhouettes: THREE.Mesh[] = [];

  // Floating sacred Torii gates & lanterns
  private readonly floatingStructures: THREE.Group[] = [];

  // Golden stardust / divine sakura motes
  private readonly motes: THREE.Points;
  private readonly motePositions: Float32Array;

  private active = false;
  private time = 0;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.group.name = 'celestial_scene';
    ctx.scene.add(this.group);
    this.group.visible = false;

    // 1. Divine Sunlight & Ambient Fill
    this.sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
    this.sunLight.position.set(-22, 28, 20);
    this.group.add(this.sunLight);

    // Warm golden sky light with deep twilight dusk bounce
    this.ambientHemi = new THREE.HemisphereLight(0xffc277, 0x3d1b28, 1.1);
    this.group.add(this.ambientHemi);

    // 2. Radiant Sun Disc & Multi-tier Golden Halo
    const sunGeo = new THREE.CircleGeometry(4.8, 32);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfffae8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sunDisc = new THREE.Mesh(sunGeo, sunMat);
    this.sunDisc.position.set(-36, 26, -55);
    this.group.add(this.sunDisc);

    const haloGeo = new THREE.RingGeometry(4.8, 22.0, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffb844,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sunHalo = new THREE.Mesh(haloGeo, haloMat);
    this.sunHalo.position.copy(this.sunDisc.position);
    this.group.add(this.sunHalo);

    // 3. Volumetric Golden Cloud Ocean (Custom GLSL Shader)
    this.cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(-0.6, 0.7, 0.4).normalize() },
        uSunColor: { value: new THREE.Color(0xffcc66) }, // Warm solar gold
        uCloudBaseColor: { value: new THREE.Color(0xd9752d) }, // Rich apricot gold
        uCloudShadowColor: { value: new THREE.Color(0x381422) }, // Deep dusk violet shadow
      },
      side: THREE.FrontSide,
    });

    // Walking cloud deck (overlapping smooth domes forming a solid walking deck at y = 0)
    const baseCloudGeo = new THREE.SphereGeometry(3.5, 24, 20);
    for (let i = 0; i < 44; i++) {
      const mesh = new THREE.Mesh(baseCloudGeo, this.cloudMaterial);
      const x = (i - 22) * 2.8 + (Math.random() - 0.5) * 1.5;
      const y = -2.85 + (Math.random() - 0.5) * 0.35;
      const z = (Math.random() - 0.5) * 12;
      mesh.position.set(x, y, z);
      const sx = 1.35 + Math.random() * 0.5;
      const sy = 0.8 + Math.random() * 0.25;
      const sz = 1.25 + Math.random() * 0.45;
      mesh.scale.set(sx, sy, sz);
      this.cloudBillows.push(mesh);
      this.group.add(mesh);
    }

    // Distant background cloud banks
    const bgCloudGeo = new THREE.SphereGeometry(7.5, 16, 14);
    for (let i = 0; i < 26; i++) {
      const mesh = new THREE.Mesh(bgCloudGeo, this.cloudMaterial);
      const x = (i - 13) * 8.0 + (Math.random() - 0.5) * 4;
      const y = -6.2 + Math.random() * 1.5;
      const z = -28 - Math.random() * 18;
      mesh.position.set(x, y, z);
      mesh.scale.set(1.7, 0.85, 1.35);
      this.cloudBillows.push(mesh);
      this.group.add(mesh);
    }

    // 4. Distant Holy Mountain Silhouettes (Deep Sapphire / Indigo with golden rim)
    const slatePbr = ctx.assets.pbr('slate', 2, 2);
    const mtnGeo = new THREE.ConeGeometry(16, 26, 4);
    const mtnMat = new THREE.MeshStandardMaterial({
      color: 0x161828, // Deep night sapphire
      map: slatePbr.map,
      normalMap: slatePbr.normalMap,
      roughness: 0.85,
      metalness: 0.1,
    });
    for (const xOff of [-48, 42, -18, 64]) {
      const mtn = new THREE.Mesh(mtnGeo, mtnMat);
      mtn.position.set(xOff, 5, -58 + Math.random() * 8);
      mtn.rotation.y = Math.random() * Math.PI;
      this.mountainSilhouettes.push(mtn);
      this.group.add(mtn);
    }

    // 5. Soft Crepuscular God Rays (Extremely subtle, atmospheric ambient haze)
    const rayGeo = new THREE.ConeGeometry(5.0, 55, 16, 1, true);
    const rayMat = new THREE.MeshBasicMaterial({
      color: 0xffe288,
      transparent: true,
      opacity: 0.022, // Soft cinematic volumetric haze
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (let i = 0; i < 5; i++) {
      const ray = new THREE.Mesh(rayGeo, rayMat);
      ray.position.set(-32 + i * 15, 26, -30 - i * 3);
      ray.rotation.z = -0.3 + i * 0.07;
      ray.rotation.x = 0.22;
      this.godRays.push(ray);
      this.group.add(ray);
    }

    // 6. Floating Sacred Vermilion Torii Archways & Stone Lanterns
    const woodPbr = ctx.assets.pbr('plank', 1, 3);
    const toriiMat = new THREE.MeshStandardMaterial({
      color: 0xb82e16, // Sacred vermilion
      map: woodPbr.map,
      normalMap: woodPbr.normalMap,
      roughnessMap: woodPbr.roughnessMap,
      roughness: 0.5,
      metalness: 0.1,
    });
    const blackLacquerMat = new THREE.MeshStandardMaterial({
      color: 0x121216,
      roughness: 0.35,
      metalness: 0.25,
    });

    for (const offset of [-20, 19]) {
      const archGroup = new THREE.Group();
      archGroup.position.set(offset, 3.8, -12);
      archGroup.rotation.y = (Math.random() - 0.5) * 0.25;

      const pillarGeo = new THREE.CylinderGeometry(0.32, 0.42, 8.0, 16);
      const baseGeo = new THREE.CylinderGeometry(0.5, 0.55, 1.4, 16);

      for (const side of [-3.2, 3.2]) {
        const p = new THREE.Mesh(pillarGeo, toriiMat);
        p.position.set(side, 0, 0);
        const b = new THREE.Mesh(baseGeo, blackLacquerMat);
        b.position.set(side, -3.3, 0);
        archGroup.add(p, b);
      }

      const lintelGeo = new THREE.BoxGeometry(9.2, 0.65, 0.75);
      const lintel = new THREE.Mesh(lintelGeo, toriiMat);
      lintel.position.set(0, 4.0, 0);

      const capGeo = new THREE.BoxGeometry(9.6, 0.15, 0.85);
      const cap = new THREE.Mesh(capGeo, blackLacquerMat);
      cap.position.set(0, 4.38, 0);

      const tieGeo = new THREE.BoxGeometry(7.4, 0.42, 0.45);
      const tie = new THREE.Mesh(tieGeo, toriiMat);
      tie.position.set(0, 2.7, 0);

      archGroup.add(lintel, cap, tie);
      this.floatingStructures.push(archGroup);
      this.group.add(archGroup);
    }

    // Floating Stone Lanterns
    const lanternGeo = new THREE.BoxGeometry(0.7, 1.2, 0.7);
    const fireGeo = new THREE.SphereGeometry(0.22, 12, 12);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });

    for (let i = 0; i < 4; i++) {
      const lanternGroup = new THREE.Group();
      lanternGroup.position.set(-24 + i * 16, 2.2 + (i % 2) * 1.2, -6 - (i % 2) * 4);
      const stone = new THREE.Mesh(lanternGeo, blackLacquerMat);
      const fire = new THREE.Mesh(fireGeo, fireMat);
      fire.position.y = 0.1;
      lanternGroup.add(stone, fire);
      this.floatingStructures.push(lanternGroup);
      this.group.add(lanternGroup);
    }

    // 7. Golden Stardust & Divine Sakura Petal Motes
    const moteCount = 150;
    this.motePositions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      this.motePositions[i * 3 + 0] = (Math.random() - 0.5) * 55;
      this.motePositions[i * 3 + 1] = Math.random() * 12;
      this.motePositions[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0xffe899,
      size: 0.18,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(moteGeo, moteMat);
    this.group.add(this.motes);
  }

  handleEvent(e: GameEvent, _game: Game): void {
    if (e.type === 'celestial_start') {
      this.active = true;
      this.group.visible = true;
      this.time = 0;
      // Refined golden-twilight atmosphere
      this.ctx.scene.fog = new THREE.FogExp2(0x84422e, 0.0038);
      this.ctx.scene.background = new THREE.Color(0x381e30);
    }
  }

  update(dt: number, game: Game): void {
    if (!this.active && game.phase !== 'celestial') {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    this.time += dt;

    this.cloudMaterial.uniforms.uTime.value = this.time;

    for (let i = 0; i < this.floatingStructures.length; i++) {
      const s = this.floatingStructures[i];
      s.position.y += Math.sin(this.time * 1.2 + i * 1.5) * dt * 0.18;
      s.rotation.z = Math.sin(this.time * 0.8 + i) * 0.02;
    }

    for (let i = 0; i < this.godRays.length; i++) {
      const r = this.godRays[i];
      r.rotation.z += Math.sin(this.time * 0.5 + i) * dt * 0.015;
    }

    const posAttr = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3 + 0] += dt * 0.65;
      arr[i * 3 + 1] += Math.sin(this.time * 2.0 + i) * dt * 0.35;
      if (arr[i * 3 + 0] > 28) arr[i * 3 + 0] = -28;
      if (arr[i * 3 + 1] > 12) arr[i * 3 + 1] = 0;
    }
    posAttr.needsUpdate = true;
  }
}
