import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { worldX } from '../render/RenderContext.ts';

import quantumNucleonVert from '../shaders/QuantumNucleon.vert';
import quantumNucleonFrag from '../shaders/QuantumNucleon.frag';
import quantumOrbitalVert from '../shaders/QuantumOrbital.vert';
import quantumOrbitalFrag from '../shaders/QuantumOrbital.frag';
import incandescentKatanaVert from '../shaders/IncandescentKatana.vert';
import incandescentKatanaFrag from '../shaders/IncandescentKatana.frag';
import dropletCausticVert from '../shaders/DropletCaustic.vert';
import dropletCausticFrag from '../shaders/DropletCaustic.frag';

/**
 * Builds an authentic Japanese Katana 3D geometry with:
 * - Blade Spine (Mune)
 * - Ridge Line (Shinogi)
 * - Cutting Edge (Ha)
 * - Chiseled Tip (Kissaki)
 * - Subtle Curvature (Sori)
 * - UV coords mapped: u = 0 (spine) to 1 (cutting edge), v = 0 (hilt) to 1 (tip)
 */
function buildKatanaBladeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const verts: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const segments = 28;
  const length = 4.2;
  const bladeWidth = 0.24;
  const spineThick = 0.022;
  const ridgeThick = 0.032;
  const soriMax = 0.09;

  for (let i = 0; i <= segments; i++) {
    const v = i / segments;
    const y = (v - 0.5) * length;
    const curveX = -Math.sin(v * Math.PI * 0.9) * soriMax;

    const taper = v > 0.82 ? 1.0 - (v - 0.82) / 0.18 * 0.72 : 1.0;
    const w = bladeWidth * taper;
    const st = spineThick * taper;
    const rt = ridgeThick * taper;

    const spineX = curveX - w * 0.45;
    const ridgeX = curveX - w * 0.12;
    const edgeX = curveX + w * 0.58;

    verts.push(spineX, y, -st * 0.5); uvs.push(0.0, v);
    verts.push(spineX, y, st * 0.5);  uvs.push(0.0, v);
    verts.push(ridgeX, y, -rt * 0.5); uvs.push(0.4, v);
    verts.push(ridgeX, y, rt * 0.5);  uvs.push(0.4, v);
    verts.push(edgeX, y, 0);          uvs.push(1.0, v);

    if (i < segments) {
      const b = i * 5;
      const n = (i + 1) * 5;

      indices.push(b + 0, n + 0, n + 1, b + 0, n + 1, b + 1);
      indices.push(b + 0, b + 2, n + 2, b + 0, n + 2, n + 0);
      indices.push(b + 1, n + 3, b + 3, b + 1, n + 1, n + 3);
      indices.push(b + 2, b + 4, n + 4, b + 2, n + 4, n + 2);
      indices.push(b + 3, n + 4, b + 4, b + 3, n + 3, n + 4);
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Renders the dramatic "Atomic Cleave" cutscene with quantum shaders:
 * 1. Freeze / Focus: Droplet suspended in extreme macro close-up.
 * 2. Atom Zoom: Dive inside the water droplet; reveal pulsating quantum nucleon plasma (protons & neutrons),
 *    snapping gluon flux electric ligatures, and shimmering electron probability density shells.
 * 3. Slice: High-detail Katana with incandescent 4500K glowing edge, hamon temper line, and habit collar
 *    cuts cleanly through the nucleus along the cleavage plane.
 * 4. Fission: Blinding thermonuclear ignition, chromatic diffraction split.
 * 5. Explosion: Nuclear blast shockwave vaporizing bridge planks into 3D physics debris.
 * 6. Ascend: Skyward ascension into the heavenly realm.
 */
export class AtomicCutsceneRenderer implements RenderModule {
  readonly ctx: RenderContext;
  private readonly group = new THREE.Group();

  // Atom 3D visual elements
  private readonly atomGroup = new THREE.Group();
  private readonly nucleusGroup = new THREE.Group();
  private readonly nucleons: THREE.Mesh[] = [];
  private readonly nucleonMaterials: THREE.ShaderMaterial[] = [];
  private readonly nucleonPositions: THREE.Vector3[] = [];
  private readonly nucleonBasePositions: THREE.Vector3[] = [];

  // Dynamic Gluon Electric Flux Arcs
  private readonly fluxLines: THREE.LineSegments;
  private readonly fluxPositions: Float32Array;
  private readonly fluxPairIndices: [number, number][] = [];

  // Translucent Electron Wave Probability Clouds
  private readonly orbitalMeshes: THREE.Mesh[] = [];
  private readonly orbitalMaterials: THREE.ShaderMaterial[] = [];
  private readonly electronWavepackets: THREE.Mesh[] = [];

  // Macro Water Droplet Shell
  private readonly dropletMesh: THREE.Mesh;
  private readonly dropletMaterial: THREE.ShaderMaterial;

  // Authentic Incandescent Katana Blade
  private readonly katanaGroup = new THREE.Group();
  private readonly bladeMaterial: THREE.ShaderMaterial;

  // Planar Cleavage Energy Blade
  private readonly cleavagePlane: THREE.Mesh;
  private readonly cleavageMaterial: THREE.MeshBasicMaterial;

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

  // Ethereal Soldier's Soul Ascension & Cloud Passage Visuals
  private readonly soulGroup = new THREE.Group();
  private readonly soulAura: THREE.Mesh;
  private readonly soulHalo: THREE.Mesh;
  private readonly soulCloudDeck = new THREE.Group();
  private readonly soulMixer: THREE.AnimationMixer;

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

    // --- 1. Macro Water Droplet Boundary ---
    const dropletGeo = new THREE.SphereGeometry(1.9, 48, 48);
    this.dropletMaterial = new THREE.ShaderMaterial({
      vertexShader: dropletCausticVert,
      fragmentShader: dropletCausticFrag,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.75 },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    this.dropletMesh = new THREE.Mesh(dropletGeo, this.dropletMaterial);
    this.atomGroup.add(this.dropletMesh);

    // --- 2. Quantum Nucleons (Quark-Gluon Plasma) ---
    // Refined radius: 0.155 (dense, detailed quantum core)
    const nucleonGeo = new THREE.SphereGeometry(0.155, 24, 24);

    for (let i = 0; i < 18; i++) {
      const isProton = i % 2 === 0;

      const mat = new THREE.ShaderMaterial({
        vertexShader: quantumNucleonVert,
        fragmentShader: quantumNucleonFrag,
        uniforms: {
          uTime: { value: 0 },
          uDisplacement: { value: 0.025 },
          uColorBase: {
            value: isProton
              ? new THREE.Color(0xdc143c) // Crimson Proton
              : new THREE.Color(0x0c4bb8), // Cosmic Sapphire Neutron
          },
          uColorCore: {
            value: isProton
              ? new THREE.Color(0xfff099) // Solar incandescent core
              : new THREE.Color(0x66ffff), // Electric cyan core
          },
          uColorRim: {
            value: isProton
              ? new THREE.Color(0xff44aa) // Magenta/violet quantum halo
              : new THREE.Color(0x3388ff), // Azure quantum halo
          },
          uCleaveHeat: { value: 0 },
        },
      });

      const mesh = new THREE.Mesh(nucleonGeo, mat);
      const phi = Math.acos(-1 + (2 * i) / 18);
      const theta = Math.sqrt(18 * Math.PI) * phi;
      const r = 0.32 + ((i * 37) % 7) * 0.012;
      const pos = new THREE.Vector3(
        r * Math.cos(theta) * Math.sin(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(phi)
      );

      mesh.position.copy(pos);
      this.nucleons.push(mesh);
      this.nucleonMaterials.push(mat);
      this.nucleonPositions.push(pos.clone());
      this.nucleonBasePositions.push(pos.clone());
      this.nucleusGroup.add(mesh);
    }

    // Find nucleon pairs for Gluon Electric Flux Arcs
    for (let i = 0; i < this.nucleonPositions.length; i++) {
      for (let j = i + 1; j < this.nucleonPositions.length; j++) {
        if (this.nucleonPositions[i].distanceTo(this.nucleonPositions[j]) < 0.48) {
          this.fluxPairIndices.push([i, j]);
        }
      }
    }

    // Each pair gets 4 segments (8 vertices) for zigzag lightning arcs
    const totalFluxVerts = this.fluxPairIndices.length * 8;
    this.fluxPositions = new Float32Array(totalFluxVerts * 3);
    const fluxGeo = new THREE.BufferGeometry();
    fluxGeo.setAttribute('position', new THREE.BufferAttribute(this.fluxPositions, 3));
    const fluxMat = new THREE.LineBasicMaterial({
      color: 0xfffaea,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    this.fluxLines = new THREE.LineSegments(fluxGeo, fluxMat);
    this.nucleusGroup.add(this.fluxLines);
    this.atomGroup.add(this.nucleusGroup);

    // --- 3. Electron Probability Wave Clouds & Wavepackets ---
    const orbitalGeo = new THREE.TorusGeometry(1.25, 0.038, 16, 64);
    const eAngles = [
      new THREE.Euler(Math.PI * 0.35, 0, 0),
      new THREE.Euler(Math.PI * 0.35, Math.PI * 0.35, 0),
      new THREE.Euler(-Math.PI * 0.25, Math.PI * 0.65, 0),
    ];

    for (let i = 0; i < 3; i++) {
      const oMat = new THREE.ShaderMaterial({
        vertexShader: quantumOrbitalVert,
        fragmentShader: quantumOrbitalFrag,
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: new THREE.Color(i === 0 ? 0x00f0ff : i === 1 ? 0xffaa33 : 0xcc66ff) },
          uColorB: { value: new THREE.Color(0xffffff) },
          uOpacity: { value: 0.75 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const oMesh = new THREE.Mesh(orbitalGeo, oMat);
      oMesh.rotation.copy(eAngles[i]);
      this.orbitalMeshes.push(oMesh);
      this.orbitalMaterials.push(oMat);
      this.atomGroup.add(oMesh);

      // Fast-moving electron probability wavepacket spark
      const packetGeo = new THREE.SphereGeometry(0.055, 12, 12);
      const packetMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
      });
      const packetMesh = new THREE.Mesh(packetGeo, packetMat);
      this.electronWavepackets.push(packetMesh);
      this.atomGroup.add(packetMesh);
    }

    // --- 4. Authentic Incandescent Katana Blade ---
    const bladeGeo = buildKatanaBladeGeometry();
    this.bladeMaterial = new THREE.ShaderMaterial({
      vertexShader: incandescentKatanaVert,
      fragmentShader: incandescentKatanaFrag,
      uniforms: {
        uTime: { value: 0 },
        uHeatIntensity: { value: 0.5 },
      },
      side: THREE.DoubleSide,
    });
    const bladeMesh = new THREE.Mesh(bladeGeo, this.bladeMaterial);
    this.katanaGroup.add(bladeMesh);

    // Habaki (antique brass collar)
    const habakiGeo = new THREE.BoxGeometry(0.28, 0.22, 0.05);
    const habakiMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.9,
      roughness: 0.25,
    });
    const habaki = new THREE.Mesh(habakiGeo, habakiMat);
    habaki.position.set(0, -2.0, 0);
    this.katanaGroup.add(habaki);

    // Tsuba (iron sword guard)
    const tsubaGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.03, 16);
    const tsubaMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      metalness: 0.8,
      roughness: 0.6,
    });
    const tsuba = new THREE.Mesh(tsubaGeo, tsubaMat);
    tsuba.position.set(0, -2.12, 0);
    this.katanaGroup.add(tsuba);

    // Tsuka (hilt with wrapped grip)
    const tsukaGeo = new THREE.CylinderGeometry(0.07, 0.08, 1.2, 8);
    const tsukaMat = new THREE.MeshStandardMaterial({
      color: 0x0f1118,
      roughness: 0.8,
    });
    const tsuka = new THREE.Mesh(tsukaGeo, tsukaMat);
    tsuka.position.set(0, -2.75, 0);
    this.katanaGroup.add(tsuka);

    // Orientation: 45 degree angle for dynamic diagonal slice
    this.katanaGroup.rotation.z = Math.PI * 0.28;
    this.katanaGroup.rotation.y = -0.15;
    this.atomGroup.add(this.katanaGroup);

    // --- 5. Planar Cleavage Energy Blade (Fission Fissure) ---
    const cleaveGeo = new THREE.PlaneGeometry(0.12, 5.5);
    this.cleavageMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.cleavagePlane = new THREE.Mesh(cleaveGeo, this.cleavageMaterial);
    this.cleavagePlane.rotation.z = Math.PI * 0.28;
    this.atomGroup.add(this.cleavagePlane);

    this.group.add(this.atomGroup);

    // --- 6. Nuclear Detonation Elements ---
    const shockGeo = new THREE.TorusGeometry(1, 0.3, 20, 64);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0xffeedd,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shockwaveMesh = new THREE.Mesh(shockGeo, shockMat);
    this.shockwaveMesh.rotation.x = Math.PI / 2;
    this.explosionGroup.add(this.shockwaveMesh);

    // Fireball Sphere with inner plasma core
    const fireGeo = new THREE.SphereGeometry(1, 32, 32);
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff7711,
      transparent: true,
      opacity: 0.9,
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

    // Shattered bridge planks with PBR oak wood textures
    const plankPbr = ctx.assets.pbr('plank', 1, 1);
    const plankGeo = new THREE.BoxGeometry(0.38, 0.12, 1.8);
    const plankMat = new THREE.MeshStandardMaterial({
      color: 0x5a3d28,
      map: plankPbr.map,
      normalMap: plankPbr.normalMap,
      roughnessMap: plankPbr.roughnessMap,
      roughness: 0.8,
    });
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

    // --- 7. Ethereal Soldier's Soul Floating Through Clouds & Stopping on the White-and-Gold Staircase ---
    const soulModel = cloneSkeleton(ctx.assets.character.body.scene);
    const soulMat = new THREE.MeshStandardMaterial({
      color: 0x88f5ff,
      emissive: 0x44ccff,
      emissiveIntensity: 1.8,
      transparent: true,
      opacity: 0.78,
      roughness: 0.15,
      metalness: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    soulModel.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.material = soulMat;
        m.frustumCulled = false;
      }
    });
    this.soulMixer = new THREE.AnimationMixer(soulModel);
    const idleClip = ctx.assets.character.anims.animations.find((c) => c.name === 'idle') ?? ctx.assets.character.anims.animations[0];
    if (idleClip) {
      const act = this.soulMixer.clipAction(idleClip);
      act.play();
    }
    this.soulGroup.add(soulModel);

    // Radiant Spirit Core & Ascending Golden-Cyan Aura Pillar
    const auraGeo = new THREE.CylinderGeometry(0.45, 0.95, 3.2, 20, 1, true);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0x99f6ff,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.soulAura = new THREE.Mesh(auraGeo, auraMat);
    this.soulAura.position.y = 1.1;
    this.soulGroup.add(this.soulAura);

    const haloGeo = new THREE.RingGeometry(0.55, 0.92, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffdf77,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.soulHalo = new THREE.Mesh(haloGeo, haloMat);
    this.soulHalo.position.set(0, 1.85, -0.15);
    this.soulGroup.add(this.soulHalo);

    this.soulGroup.visible = false;
    this.group.add(this.soulGroup);

    // Volumetric Cloud Banks the Soldier's Soul Floats Through During Ascension
    const snowPbr = ctx.assets.pbr('snow', 2, 2);
    const cloudPuffMat = new THREE.MeshStandardMaterial({
      color: 0xf7efe2,
      map: snowPbr.map,
      normalMap: snowPbr.normalMap,
      roughness: 0.85,
      emissive: 0x553820,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const puffGeo = new THREE.DodecahedronGeometry(2.4, 2);
    const cloudCoords = [
      [-3.2, -9.5, 1.5], [3.4, -8.8, 1.2], [-1.8, -6.5, -1.8],
      [2.6, -5.2, 1.6], [-3.8, -3.5, 0.8], [3.2, -2.4, -1.2],
    ];
    for (const [cx, cy, cz] of cloudCoords) {
      const puff = new THREE.Mesh(puffGeo, cloudPuffMat);
      puff.position.set(cx, cy, cz);
      puff.scale.set(1.6, 0.58, 1.1);
      this.soulCloudDeck.add(puff);
    }
    this.soulCloudDeck.visible = false;
    this.group.add(this.soulCloudDeck);
  }

  handleEvent(e: GameEvent, _game: Game): void {
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
      this.soulGroup.visible = false;
      this.soulCloudDeck.visible = false;
      this.flashIntensity = 0;
      this.flashMaterial.opacity = 0;
      this.cleavageMaterial.opacity = 0;

      for (let i = 0; i < this.nucleons.length; i++) {
        this.nucleons[i].position.copy(this.nucleonBasePositions[i]);
        this.nucleonMaterials[i].uniforms.uCleaveHeat.value = 0;
      }

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
      this.soulGroup.visible = false;
      this.soulCloudDeck.visible = false;
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

    if (this.flashIntensity > 0) {
      this.flashIntensity = Math.max(0, this.flashIntensity - dt * 1.5);
      this.flashMaterial.opacity = this.flashIntensity;
    }

    this.dropletMaterial.uniforms.uTime.value = this.time;
    this.bladeMaterial.uniforms.uTime.value = this.time;
    for (const mat of this.nucleonMaterials) mat.uniforms.uTime.value = this.time;
    for (const mat of this.orbitalMaterials) mat.uniforms.uTime.value = this.time;

    // Dynamic Gluon Electric Flux Arcs: jitter zigzag paths
    let fluxIdx = 0;
    const posAttr = this.fluxLines.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (const [i, j] of this.fluxPairIndices) {
      const p1 = this.nucleons[i].position;
      const p2 = this.nucleons[j].position;

      const jitter1 = new THREE.Vector3(
        (Math.random() - 0.5) * 0.035,
        (Math.random() - 0.5) * 0.035,
        (Math.random() - 0.5) * 0.035
      );
      const jitter2 = new THREE.Vector3(
        (Math.random() - 0.5) * 0.035,
        (Math.random() - 0.5) * 0.035,
        (Math.random() - 0.5) * 0.035
      );

      const m1 = p1.clone().lerp(p2, 0.33).add(jitter1);
      const m2 = p1.clone().lerp(p2, 0.66).add(jitter2);

      arr[fluxIdx++] = p1.x; arr[fluxIdx++] = p1.y; arr[fluxIdx++] = p1.z;
      arr[fluxIdx++] = m1.x; arr[fluxIdx++] = m1.y; arr[fluxIdx++] = m1.z;

      arr[fluxIdx++] = m1.x; arr[fluxIdx++] = m1.y; arr[fluxIdx++] = m1.z;
      arr[fluxIdx++] = m2.x; arr[fluxIdx++] = m2.y; arr[fluxIdx++] = m2.z;

      arr[fluxIdx++] = m2.x; arr[fluxIdx++] = m2.y; arr[fluxIdx++] = m2.z;
      arr[fluxIdx++] = p2.x; arr[fluxIdx++] = p2.y; arr[fluxIdx++] = p2.z;

      arr[fluxIdx++] = m1.x; arr[fluxIdx++] = m1.y; arr[fluxIdx++] = m1.z;
      arr[fluxIdx++] = m2.x + jitter1.x; arr[fluxIdx++] = m2.y + jitter1.y; arr[fluxIdx++] = m2.z + jitter1.z;
    }
    posAttr.needsUpdate = true;

    // Phase 1: Freeze / Focus (0 - 1.2s)
    if (phase === 'freeze') {
      this.atomGroup.visible = true;
      const scale = THREE.MathUtils.lerp(0.01, 0.45, p);
      this.atomGroup.scale.setScalar(scale);
      this.katanaGroup.position.set(-2.8, 2.8, 0);
      this.nucleusGroup.position.set(0, 0, 0);
      this.bladeMaterial.uniforms.uHeatIntensity.value = 0.2;
      this.cleavageMaterial.opacity = 0;
    }
    // Phase 2: Macro Atom Zoom (1.2 - 2.8s)
    else if (phase === 'atom_zoom') {
      this.atomGroup.visible = true;
      const scale = THREE.MathUtils.lerp(0.45, 1.85, p);
      this.atomGroup.scale.setScalar(scale);

      for (let i = 0; i < 3; i++) {
        const ring = this.orbitalMeshes[i];
        ring.rotation.z += dt * (8 + i * 3);
        const theta = this.time * (16 + i * 6);
        const rad = 1.25;
        const localPos = new THREE.Vector3(Math.cos(theta) * rad, Math.sin(theta) * rad, 0);
        localPos.applyEuler(ring.rotation);
        this.electronWavepackets[i].position.copy(localPos);
      }

      for (let i = 0; i < this.nucleons.length; i++) {
        const base = this.nucleonBasePositions[i];
        const jx = Math.sin(this.time * 20 + i * 3) * 0.012;
        const jy = Math.cos(this.time * 22 + i * 5) * 0.012;
        const jz = Math.sin(this.time * 25 + i * 7) * 0.012;
        this.nucleons[i].position.set(base.x + jx, base.y + jy, base.z + jz);
      }

      // Blade approaches
      const bladeX = THREE.MathUtils.lerp(-3.2, -0.65, p);
      const bladeY = THREE.MathUtils.lerp(3.2, 0.65, p);
      this.katanaGroup.position.set(bladeX, bladeY, 0);
      this.bladeMaterial.uniforms.uHeatIntensity.value = THREE.MathUtils.lerp(0.3, 0.9, p);
      this.cleavageMaterial.opacity = 0;
    }
    // Phase 3: Slice (2.8 - 3.8s)
    else if (phase === 'slice') {
      this.atomGroup.visible = true;
      this.atomGroup.scale.setScalar(1.85); // Maintain full macro scale!

      // Blade sweeps cleanly across the nucleus center!
      const bladeX = THREE.MathUtils.lerp(-0.65, 2.2, p);
      const bladeY = THREE.MathUtils.lerp(0.65, -2.2, p);
      this.katanaGroup.position.set(bladeX, bladeY, 0);

      this.bladeMaterial.uniforms.uHeatIntensity.value = 1.0;

      // Planar Cleavage Energy Blade
      this.cleavageMaterial.opacity = Math.sin(p * Math.PI) * 0.95;
      this.cleavagePlane.scale.set(1 + p * 2.2, 1, 1);

      // Nucleons shear apart along cleavage axis and heat up to blinding incandescence!
      for (let i = 0; i < this.nucleons.length; i++) {
        const base = this.nucleonBasePositions[i];
        const side = i % 2 === 0 ? 1 : -1;
        const shearDist = Math.pow(p, 1.8) * 0.48;
        this.nucleons[i].position.set(
          base.x + side * shearDist * 0.7,
          base.y + side * shearDist * 0.7,
          base.z + (Math.random() - 0.5) * 0.02
        );
        this.nucleonMaterials[i].uniforms.uCleaveHeat.value = Math.min(1.0, p * 1.6);
      }

      if (p > 0.8) {
        this.flashIntensity = Math.min(1.0, (p - 0.8) * 5.0);
      }
    }
    // Phase 4: Fission (3.8 - 4.6s)
    else if (phase === 'fission') {
      this.atomGroup.visible = true;
      this.atomGroup.scale.setScalar(1.85);
      this.flashIntensity = 1.0;
      this.flashMaterial.opacity = 1.0;
      this.cleavageMaterial.opacity = 1.0;

      for (let i = 0; i < this.nucleons.length; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        this.nucleons[i].position.x += side * dt * 9.0;
        this.nucleons[i].position.y += side * dt * 9.0;
        this.nucleonMaterials[i].uniforms.uCleaveHeat.value = 1.0;
      }
    }
    // Phase 5: Explosion & Bridge Collapse (4.6 - 6.2s)
    else if (phase === 'explosion') {
      this.atomGroup.visible = false;
      this.explosionGroup.visible = true;

      const shockScale = THREE.MathUtils.lerp(1, 45, p);
      this.shockwaveMesh.scale.set(shockScale, shockScale, shockScale);
      (this.shockwaveMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - p);

      const fireScale = THREE.MathUtils.lerp(1, 28, Math.pow(p, 0.6));
      this.fireballMesh.scale.set(fireScale, fireScale * 1.5, fireScale);
      (this.fireballMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - p * 0.9);

      for (let i = 0; i < this.debrisMeshes.length; i++) {
        const m = this.debrisMeshes[i];
        const v = this.debrisVelocities[i];
        const r = this.debrisRotations[i];
        m.position.x += v.x * dt;
        m.position.y += v.y * dt;
        m.position.z += v.z * dt;
        v.y -= 22 * dt;
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
    // Phase 6: Ascend into Heaven — Soldier's ethereal soul floats up through the clouds
    // and stops on the White Marble & Gold Staircase while demons advance to push them down!
    else if (phase === 'ascend') {
      this.explosionGroup.visible = false;
      this.speedlines.visible = p < 0.7;
      if (this.speedlines.visible) {
        this.speedlines.position.y -= dt * 55;
        if (this.speedlines.position.y < -30) this.speedlines.position.y = 20;
      }

      // Smooth cubic ease-out so the soul floats upward through the clouds (-12 -> 0) and gently stops on the staircase at y = 0.05!
      const easeOut = 1 - Math.pow(1 - p, 3);
      const soulY = THREE.MathUtils.lerp(-11.5, 0.05, easeOut);
      const soulX = THREE.MathUtils.lerp(this.warriorWorldX, 0, easeOut);

      this.soulGroup.visible = true;
      this.soulGroup.position.set(soulX, soulY, 0.15);
      this.soulGroup.rotation.y = Math.sin(p * Math.PI) * 0.35;
      this.soulMixer.update(dt);
      this.soulHalo.rotation.z = this.time * 1.8;
      this.soulAura.scale.setScalar(1.0 + Math.sin(this.time * 8) * 0.15);

      this.soulCloudDeck.visible = true;
      this.soulCloudDeck.position.set(soulX, 0, 0);

      this.flashMaterial.color.setHex(0xffeebb);
      this.flashIntensity = Math.max(0, (0.25 - p) * 2.5);
      this.flashMaterial.opacity = this.flashIntensity;
    }
  }
}
