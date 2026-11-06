import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { makeWetMaterial } from '../render/Assets.ts';
import { makeNoiseTexture } from './env/NoiseTexture.ts';
import { Noise3, Random, smoothstep } from './env/noise.ts';
import { RENDER_ORDER, MOON_DIR } from './env/palette.ts';

import skyVert from '../shaders/StormSky.vert';
import skyFrag from '../shaders/StormSky.frag';
import seaVert from '../shaders/Sea.vert';
import seaFrag from '../shaders/Sea.frag';
import peaksVert from '../shaders/Peaks.vert';
import peaksFrag from '../shaders/Peaks.frag';
import fogVert from '../shaders/GorgeFog.vert';
import fogFrag from '../shaders/GorgeFog.frag';

const CELESTIAL_SEA_LEVEL = -300;
const ROOT_Y = CELESTIAL_SEA_LEVEL - 30;
const DROWNED_Y = ROOT_Y - 20;

const CELESTIAL_PALETTE = {
  zenith: new THREE.Color(0.015, 0.012, 0.032),
  horizon: new THREE.Color(0.11, 0.055, 0.038),
  haze: new THREE.Color(0.095, 0.052, 0.036),
  cloud: new THREE.Color(0.018, 0.012, 0.024),
  cloudLit: new THREE.Color(0.32, 0.19, 0.075),
  sun: new THREE.Color(0xffe6a3),
  lightning: new THREE.Color(0xfff2cc),
  gorgeFog: new THREE.Color(0.13, 0.075, 0.045),
};

interface RangeSpec {
  z: number;
  depth: number;
  halfLength: number;
  spacing: number;
  valley: number;
  summit: number;
  lift: number;
  shore: number;
  channels: [number, number][];
  freq: number;
  seed: number;
}

const SUN_SOUND = Math.atan2(MOON_DIR.x, -MOON_DIR.z);

const CELESTIAL_RANGES: RangeSpec[] = [
  {
    z: -330, depth: 170, halfLength: 420, spacing: 3.5, valley: -80, summit: 38, lift: 0.22, shore: 0.45,
    channels: [[SUN_SOUND, 0.09], [0, 0.13], [0.3, 0.05]], freq: 0.006, seed: 701,
  },
  {
    z: -700, depth: 260, halfLength: 820, spacing: 5.5, valley: -60, summit: 125, lift: 0.38, shore: 0.35,
    channels: [[SUN_SOUND, 0.07], [0.26, 0.05]], freq: 0.0031, seed: 802,
  },
  {
    z: -1150, depth: 340, halfLength: 1350, spacing: 7.0, valley: -25, summit: 340, lift: 0.62, shore: 0.34,
    channels: [[SUN_SOUND, 0.045]], freq: 0.0019, seed: 903,
  },
];
const ROWS = 20;

/**
 * The Photorealistic Heavenly Realm (Celestial Clash):
 * Built on the exact same procedural FBM shader & PBR engine as MountainPeakScene:
 * 1. Ray-cast Celestial Thunderclouds Sky (`StormSky.frag`) with backlit golden-silvered edges and divine lightning.
 * 2. Ray-cast Celestial Sea (`Sea.frag`) far below with multi-octave FBM swell, chop, ripples, and golden sun glitter.
 * 3. Multi-range Ridged Celestial Mountains (`Peaks.frag`) rising out of the golden-amber cloud sea.
 * 4. Volumetric Celestial Gorge Fog (`GorgeFog.frag`) drifting beneath the bridge and staircase.
 * 5. Monumental White Marble & 24k Gold Staircase leading down (`tile` & `wall` PBR maps + gold trim),
 *    flanked by sacred trees (`nature.glb`) and colossi statues (`wukong.glb` & MakerWorld `nezha.stl`).
 */
export class CelestialScene implements RenderModule {
  private readonly ctx: RenderContext;
  readonly group = new THREE.Group();

  // Lighting
  private readonly sunLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly ambientHemi: THREE.HemisphereLight;
  private readonly flashLight: THREE.DirectionalLight;

  // FBM Shader Environment Meshes (matching MountainPeakScene)
  private readonly skyMesh: THREE.Mesh;
  private readonly seaMesh: THREE.Mesh;
  private readonly peaksMesh: THREE.Mesh;
  private readonly fogSheets: THREE.Mesh;
  private readonly fogWisps: THREE.Mesh;

  // Shared Celestial Environment Uniforms
  private readonly uCloudShift = { value: new THREE.Vector2(0, 0) };
  private readonly uWindDrift = { value: new THREE.Vector2(0, 0) };
  private readonly uSunDir = { value: new THREE.Vector3(-0.38, 0.26, -0.88).normalize() };
  private readonly uFlashDir = { value: new THREE.Vector3(0.25, 0.48, -0.84).normalize() };
  private readonly uFlashPos = { value: new THREE.Vector3(180, 240, -680) };
  private readonly uCelestialLightning = { value: 0 };

  // Grand White & Gold Staircase + Sacred Sanctuary
  private readonly staircaseGroup = new THREE.Group();
  private readonly lanternLights: THREE.PointLight[] = [];
  private readonly guardianHalos: THREE.Mesh[] = [];

  // Golden Divine Stardust Motes
  private readonly motes: THREE.Points;
  private readonly motePositions: Float32Array;

  private active = false;
  private time = 0;
  private flashTimer = 3.5;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.group.name = 'celestial_scene';
    ctx.scene.add(this.group);
    this.group.visible = false;

    const noise = makeNoiseTexture();
    const u = ctx.uniforms;

    // 1. Ray-Cast Celestial Thunderclouds Sky (StormSky.frag with golden-dawn backlit thunderclouds)
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uNoise: { value: noise },
        uLightning: this.uCelestialLightning,
        uMist: { value: 0.12 },
        uRain: { value: 0.0 },
        uSnow: { value: 0.0 },
        uCloudShift: this.uCloudShift,
        uMoonDir: this.uSunDir,
        uFlashDir: this.uFlashDir,
        uZenith: { value: CELESTIAL_PALETTE.zenith },
        uHorizon: { value: CELESTIAL_PALETTE.horizon },
        uHaze: { value: CELESTIAL_PALETTE.haze },
        uCloud: { value: CELESTIAL_PALETTE.cloud },
        uCloudLit: { value: CELESTIAL_PALETTE.cloudLit },
        uMoonColor: { value: CELESTIAL_PALETTE.sun },
        uFlashColor: { value: CELESTIAL_PALETTE.lightning },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const skyDome = new THREE.SphereGeometry(1000, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.01);
    this.skyMesh = new THREE.Mesh(skyDome, skyMat);
    this.skyMesh.name = 'celestial-sky';
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = RENDER_ORDER.sky;
    this.group.add(this.skyMesh);

    // 2. Ray-Cast Celestial Sea Far Below (Sea.frag with FBM swell, chop, ripples & golden sun glitter)
    const seaMat = new THREE.ShaderMaterial({
      vertexShader: seaVert,
      fragmentShader: seaFrag,
      uniforms: {
        uNoise: { value: noise },
        uTime: u.uTime,
        uLightning: this.uCelestialLightning,
        uMist: { value: 0.12 },
        uRain: { value: 0.0 },
        uWind: { value: 4.5 },
        uDrift: this.uWindDrift,
        uSeaLevel: { value: CELESTIAL_SEA_LEVEL },
        uMoonDir: this.uSunDir,
        uMoonColor: { value: CELESTIAL_PALETTE.sun },
        uFlashDir: this.uFlashDir,
        uFlashColor: { value: CELESTIAL_PALETTE.lightning },
        uHaze: { value: CELESTIAL_PALETTE.haze },
        uZenith: { value: CELESTIAL_PALETTE.zenith },
        uHorizon: { value: CELESTIAL_PALETTE.horizon },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const seaGeo = new THREE.SphereGeometry(900, 48, 12, 0, Math.PI * 2, Math.PI / 2 - 0.02, Math.PI / 2 + 0.02);
    this.seaMesh = new THREE.Mesh(seaGeo, seaMat);
    this.seaMesh.name = 'celestial-sea';
    this.seaMesh.frustumCulled = false;
    this.seaMesh.renderOrder = RENDER_ORDER.sea;
    this.group.add(this.seaMesh);

    // 3. Multi-Range Ridged Celestial Mountain Massifs (Peaks.frag with marble-snow & golden crests)
    const detail = ctx.quality === 'high' ? 1 : 0.5;
    const peakParts = CELESTIAL_RANGES.map((spec, i) => buildCelestialRange(spec, i, detail));
    const peaksGeo = mergeGeometries(peakParts);
    for (const p of peakParts) p.dispose();

    const peaksMat = new THREE.ShaderMaterial({
      vertexShader: peaksVert,
      fragmentShader: peaksFrag,
      uniforms: {
        uNoise: { value: noise },
        uLightning: this.uCelestialLightning,
        uMist: { value: 0.12 },
        uRain: { value: 0.0 },
        uSnow: { value: 0.1 },
        uMoonDir: this.uSunDir,
        uMoonColor: { value: CELESTIAL_PALETTE.sun },
        uFlashPos: this.uFlashPos,
        uFlashColor: { value: CELESTIAL_PALETTE.lightning },
        uHaze: { value: CELESTIAL_PALETTE.haze },
        uRock: { value: new THREE.Color(0.042, 0.032, 0.048) },
        uSnowColor: { value: new THREE.Color(0.88, 0.78, 0.62) },
        uSeaLevel: { value: CELESTIAL_SEA_LEVEL },
      },
    });
    this.peaksMesh = new THREE.Mesh(peaksGeo, peaksMat);
    this.peaksMesh.name = 'celestial-peaks';
    this.peaksMesh.renderOrder = RENDER_ORDER.peaks;
    this.group.add(this.peaksMesh);

    // 4. Volumetric Celestial Gorge Cloud Layers & Wisps (GorgeFog.frag)
    const fogShared = {
      uNoise: { value: noise },
      uTime: u.uTime,
      uLightning: this.uCelestialLightning,
      uMist: { value: 0.22 },
      uRain: { value: 0.0 },
      uDrift: this.uWindDrift,
      uFogColor: { value: CELESTIAL_PALETTE.gorgeFog },
      uMoonDir: this.uSunDir,
      uMoonColor: { value: CELESTIAL_PALETTE.sun },
      uFlashDir: this.uFlashDir,
      uFlashColor: { value: CELESTIAL_PALETTE.lightning },
    };
    this.fogSheets = new THREE.Mesh(
      buildFogSheets([-10, -22, -38, -65, -110]),
      new THREE.ShaderMaterial({
        vertexShader: fogVert,
        fragmentShader: fogFrag,
        uniforms: { ...fogShared, uOpacity: { value: 1.15 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.fogSheets.renderOrder = -20;
    this.fogSheets.frustumCulled = false;
    this.group.add(this.fogSheets);

    this.fogWisps = new THREE.Mesh(
      buildFogWisps(ctx.quality === 'high' ? 36 : 18),
      new THREE.ShaderMaterial({
        vertexShader: fogVert,
        fragmentShader: fogFrag,
        uniforms: { ...fogShared, uOpacity: { value: 1.0 }, uSpan: { value: 42 } },
        defines: { WISP: '' },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.fogWisps.renderOrder = -19;
    this.fogWisps.frustumCulled = false;
    this.group.add(this.fogWisps);

    // 5. Divine Sunlight, Key Fill & Lightning Flash
    this.sunLight = new THREE.DirectionalLight(0xfff4d8, 2.8);
    this.sunLight.position.set(-22, 32, 18);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.bias = -0.0004;
    const sc = this.sunLight.shadow.camera;
    sc.left = -28; sc.right = 28; sc.top = 18; sc.bottom = -14; sc.near = 1; sc.far = 90;
    sc.updateProjectionMatrix();
    this.group.add(this.sunLight, this.sunLight.target);

    this.fillLight = new THREE.DirectionalLight(0xffdfba, 1.45);
    this.fillLight.position.set(12, 14, 26);
    this.group.add(this.fillLight);

    this.ambientHemi = new THREE.HemisphereLight(0xffe2a8, 0x2a1824, 1.25);
    this.group.add(this.ambientHemi);

    this.flashLight = new THREE.DirectionalLight(0xfff6dd, 0);
    this.flashLight.position.set(15, 42, -25);
    this.group.add(this.flashLight);

    // 6. Monumental White Marble & 24k Gold Staircase Leading Down + Sacred Cliff Anchors & Statues
    this.buildWhiteAndGoldStaircase();
    this.group.add(this.staircaseGroup);

    // 7. Golden Stardust Motes
    const moteCount = 160;
    this.motePositions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      this.motePositions[i * 3 + 0] = (Math.random() - 0.5) * 56;
      this.motePositions[i * 3 + 1] = -2 + Math.random() * 14;
      this.motePositions[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0xffe899,
      size: 0.16,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.motes = new THREE.Points(moteGeo, moteMat);
    this.group.add(this.motes);
  }

  /**
   * Builds the grand White Marble Staircase with 24k Gold trim that leads downward from the center
   * sanctuary platform (and also descends into the foreground/background), alongside the suspension bridge,
   * flanked by realistic PBR cliffs, nature pack trees/flowers, and MakerWorld guardian statues.
   */
  private buildWhiteAndGoldStaircase(): void {
    const u = this.ctx.uniforms;
    const tilePbr = this.ctx.assets.pbr('tile', 4, 2);
    const wallPbr = this.ctx.assets.pbr('wall', 3, 2);
    const rockPbr = this.ctx.assets.pbr('rock', 3, 3);
    const snowPbr = this.ctx.assets.pbr('snow', 3, 3);

    // Realistic White Carrara Marble PBR material using tile_d / tile_n / tile_r
    const whiteMarbleMat = makeWetMaterial({
      color: 0xfaf6ee,
      map: tilePbr.map,
      normalMap: tilePbr.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: tilePbr.roughnessMap,
      roughness: 0.28,
      metalness: 0.08,
      wet: 0.35,
    }, u);

    // Carved White Stone Masonry PBR material using wall_d / wall_n / wall_r
    const carvedStoneMat = makeWetMaterial({
      color: 0xede6d8,
      map: wallPbr.map,
      normalMap: wallPbr.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: wallPbr.roughnessMap,
      roughness: 0.42,
      metalness: 0.05,
      wet: 0.3,
    }, u);

    // Brushed 24k Celestial Gold PBR material with normal-mapped relief
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffcf48,
      normalMap: tilePbr.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: tilePbr.roughnessMap,
      metalness: 0.92,
      roughness: 0.18,
      emissive: 0x583c08,
      emissiveIntensity: 0.35,
    });

    // Sacred Cliff Bastions at either end of the bridge (|x| = 18..34) with rock + snow PBR
    const cliffMat = makeWetMaterial({
      color: 0x8a8278,
      map: rockPbr.map,
      normalMap: rockPbr.normalMap,
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: rockPbr.roughnessMap,
      roughness: 0.72,
      metalness: 0.06,
      wet: 0.4,
    }, u);

    const snowCapMat = makeWetMaterial({
      color: 0xf8f4ec,
      map: snowPbr.map,
      normalMap: snowPbr.normalMap,
      roughnessMap: snowPbr.roughnessMap,
      roughness: 0.55,
      wet: 0.2,
    }, u);

    for (const side of [-1, 1]) {
      const cliffGroup = new THREE.Group();
      cliffGroup.position.set(side * 24.5, -6.5, -2.0);
      const baseRock = new THREE.Mesh(new THREE.DodecahedronGeometry(9.5, 2), cliffMat);
      baseRock.scale.set(1.25, 1.6, 1.1);
      baseRock.castShadow = true;
      baseRock.receiveShadow = true;
      cliffGroup.add(baseRock);

      const capRock = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 8.2, 2.2, 12), snowCapMat);
      capRock.position.set(-side * 1.2, 5.4, 1.2);
      capRock.receiveShadow = true;
      cliffGroup.add(capRock);
      this.staircaseGroup.add(cliffGroup);
    }

    // --- GRAND WHITE MARBLE & GOLD STAIRCASE LEADING DOWN ---
    // 1) Central Dais Platform where the Soldier's Soul lands (x = -4..4, y = -0.18, z = -1.8..1.8)
    const dais = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.42, 4.2), whiteMarbleMat);
    dais.position.set(0, -0.22, -0.3);
    dais.receiveShadow = true;
    dais.castShadow = true;
    this.staircaseGroup.add(dais);

    const daisGoldTrim = new THREE.Mesh(new THREE.BoxGeometry(8.56, 0.1, 4.32), goldMat);
    daisGoldTrim.position.set(0, -0.02, -0.3);
    this.staircaseGroup.add(daisGoldTrim);

    // 2) Twin Lateral White-and-Gold Staircases leading DOWN from the central platform toward both sides
    //    AND a monumental Central Grand Staircase descending from the platform down into the cloud abyss!
    const numSideSteps = 22;
    const stepGeo = new THREE.BoxGeometry(1.05, 0.28, 3.4);
    const goldNosingGeo = new THREE.BoxGeometry(1.08, 0.065, 3.46);
    const goldRiserInlayGeo = new THREE.BoxGeometry(0.05, 0.2, 3.1);

    for (const dir of [-1, 1]) {
      for (let i = 0; i < numSideSteps; i++) {
        const sx = dir * (4.4 + i * 0.92);
        const sy = -0.28 - i * 0.18; // Steps lead steadily DOWNWARD!
        const sz = -0.6;

        const step = new THREE.Mesh(stepGeo, whiteMarbleMat);
        step.position.set(sx, sy, sz);
        step.castShadow = true;
        step.receiveShadow = true;
        this.staircaseGroup.add(step);

        const nosing = new THREE.Mesh(goldNosingGeo, goldMat);
        nosing.position.set(sx, sy + 0.12, sz);
        this.staircaseGroup.add(nosing);

        const riser = new THREE.Mesh(goldRiserInlayGeo, goldMat);
        riser.position.set(sx + dir * 0.51, sy - 0.02, sz);
        this.staircaseGroup.add(riser);
      }

      // Stepped White Marble & Gold Balustrade Stringers flanking the descending stairs
      const stringerLen = 21.5;
      const stringerAngle = Math.atan2(-numSideSteps * 0.18, numSideSteps * 0.92);
      for (const zOff of [-2.25, 1.05]) {
        const stringer = new THREE.Mesh(new THREE.BoxGeometry(stringerLen, 0.45, 0.28), carvedStoneMat);
        stringer.position.set(dir * 14.2, -1.8, zOff);
        stringer.rotation.z = dir * stringerAngle;
        stringer.castShadow = true;
        stringer.receiveShadow = true;
        this.staircaseGroup.add(stringer);

        const handrail = new THREE.Mesh(new THREE.BoxGeometry(stringerLen, 0.12, 0.34), goldMat);
        handrail.position.set(dir * 14.2, -0.82, zOff);
        handrail.rotation.z = dir * stringerAngle;
        this.staircaseGroup.add(handrail);

        // Baluster pillars along the staircase
        for (let b = 0; b < 9; b++) {
          const bx = dir * (4.8 + b * 2.3);
          const by = -0.28 - (b * 2.3 / 0.92) * 0.18 + 0.42;
          const baluster = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.85, 10), whiteMarbleMat);
          baluster.position.set(bx, by, zOff);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10), goldMat);
          cap.position.set(bx, by + 0.42, zOff);
          this.staircaseGroup.add(baluster, cap);
        }
      }
    }

    // 3) Grand Central Staircase Descending Forward & Downward into the Abyss (so demons visibly climb/push down)
    const frontSteps = 16;
    for (let i = 0; i < frontSteps; i++) {
      const width = 7.2 + i * 0.35;
      const fStep = new THREE.Mesh(new THREE.BoxGeometry(width, 0.32, 0.85), whiteMarbleMat);
      const fy = -0.45 - i * 0.34;
      const fz = -2.2 - i * 0.72;
      fStep.position.set(0, fy, fz);
      fStep.receiveShadow = true;
      fStep.castShadow = true;
      this.staircaseGroup.add(fStep);

      const fGold = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.07, 0.89), goldMat);
      fGold.position.set(0, fy + 0.14, fz);
      this.staircaseGroup.add(fGold);

      // Gold carpet runner down the center of the white marble stairs
      const runner = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.34, 0.87), goldMat);
      runner.position.set(0, fy + 0.01, fz);
      this.staircaseGroup.add(runner);
    }

    // 4) Fluted Corinthian Marble & Gold Columns framing the Staircase Sanctuary
    const colGeo = new THREE.CylinderGeometry(0.38, 0.44, 7.5, 20);
    const colBaseGeo = new THREE.BoxGeometry(1.15, 0.6, 1.15);
    const colRingGeo = new THREE.TorusGeometry(0.42, 0.06, 10, 24);
    colRingGeo.rotateX(Math.PI / 2);

    const columnPositions = [
      [-11.5, -1.2, -3.8],
      [-5.2, 0.2, -3.8],
      [5.2, 0.2, -3.8],
      [11.5, -1.2, -3.8],
      [-18.0, -2.4, -3.8],
      [18.0, -2.4, -3.8],
    ];
    for (const [cx, cy, cz] of columnPositions) {
      const colGroup = new THREE.Group();
      colGroup.position.set(cx, cy, cz);

      const base = new THREE.Mesh(colBaseGeo, carvedStoneMat);
      base.position.y = 0.3;
      const shaft = new THREE.Mesh(colGeo, whiteMarbleMat);
      shaft.position.y = 4.05;
      shaft.castShadow = true;
      shaft.receiveShadow = true;

      const ringBot = new THREE.Mesh(colRingGeo, goldMat);
      ringBot.position.y = 0.65;
      const ringTop = new THREE.Mesh(colRingGeo, goldMat);
      ringTop.position.y = 7.75;

      const capital = new THREE.Mesh(colBaseGeo, goldMat);
      capital.position.y = 8.0;

      // Sacred golden brazier flame atop each column
      const lantern = new THREE.PointLight(0xffbe55, 1.4, 11);
      lantern.position.set(0, 8.6, 0.8);
      this.lanternLights.push(lantern);

      colGroup.add(base, shaft, ringBot, ringTop, capital, lantern);
      this.staircaseGroup.add(colGroup);
    }

    // Architrave beam connecting the central sanctuary columns
    const architrave = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.68, 1.1), whiteMarbleMat);
    architrave.position.set(0, 8.55, -3.8);
    const architraveGold = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.16, 1.18), goldMat);
    architraveGold.position.set(0, 8.92, -3.8);
    this.staircaseGroup.add(architrave, architraveGold);

    // 5) 3D Models from MakerWorld (Wukong & NeZha Celestial Guardians) + Nature Art Pack
    this.addMakerWorldGuardiansAndNature(whiteMarbleMat, carvedStoneMat, goldMat);
  }

  private addMakerWorldGuardiansAndNature(
    whiteMarbleMat: THREE.Material,
    carvedStoneMat: THREE.Material,
    goldMat: THREE.Material,
  ): void {
    const world = this.ctx.assets.world;

    // A. MakerWorld Sun Wukong Statue (`wukong.glb`) & NeZha Deity Statue (`nezha.stl`)
    // Placed on grand white-and-gold pedestals flanking the staircase
    const statueGoldMat = new THREE.MeshStandardMaterial({
      color: 0xffd86b,
      metalness: 0.88,
      roughness: 0.22,
      emissive: 0x4a3006,
      emissiveIntensity: 0.28,
    });

    const jadeMarbleMat = new THREE.MeshStandardMaterial({
      color: 0xf4efe4,
      roughness: 0.26,
      metalness: 0.15,
      emissive: 0x221d15,
      emissiveIntensity: 0.2,
    });

    // Left Guardian: MakerWorld Sun Wukong (`wukong.glb`)
    if (world?.wukong?.scene) {
      const wukongGroup = new THREE.Group();
      const clone = world.wukong.scene.clone(true);
      const box = new THREE.Box3().setFromObject(clone);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const targetHeight = 5.2;
      const scale = targetHeight / Math.max(0.001, size.y);
      clone.scale.setScalar(scale);
      clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      clone.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = statueGoldMat;
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      wukongGroup.add(clone);

      // Pedestal
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 1.6, 16), carvedStoneMat);
      ped.position.y = -0.8;
      const pedTrim = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.14, 16), goldMat);
      pedTrim.position.y = 0.0;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 2.05, 32),
        new THREE.MeshBasicMaterial({ color: 0xffdf77, side: THREE.DoubleSide, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }),
      );
      halo.position.set(0, 3.8, -0.5);
      this.guardianHalos.push(halo);

      wukongGroup.add(ped, pedTrim, halo);
      wukongGroup.position.set(-7.8, 0.6, -4.6);
      wukongGroup.rotation.y = 0.32;
      this.staircaseGroup.add(wukongGroup);
    }

    // Right Guardian: MakerWorld NeZha Lotus Prince (`nezha.stl`)
    if (world?.nezhaGeo) {
      const nezhaGroup = new THREE.Group();
      const geo = world.nezhaGeo;
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const size = bb.getSize(new THREE.Vector3());
      const targetHeight = 5.2;
      const scale = targetHeight / Math.max(0.001, size.y);

      const nezhaMesh = new THREE.Mesh(geo, statueGoldMat);
      nezhaMesh.scale.setScalar(scale);
      nezhaMesh.position.set(0, -bb.min.y * scale, 0);
      nezhaMesh.castShadow = true;
      nezhaMesh.receiveShadow = true;
      nezhaGroup.add(nezhaMesh);

      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 1.6, 16), whiteMarbleMat);
      ped.position.y = -0.8;
      const pedTrim = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.14, 16), goldMat);
      pedTrim.position.y = 0.0;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 2.05, 32),
        new THREE.MeshBasicMaterial({ color: 0xffdf77, side: THREE.DoubleSide, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }),
      );
      halo.position.set(0, 3.8, -0.5);
      this.guardianHalos.push(halo);

      nezhaGroup.add(ped, pedTrim, halo);
      nezhaGroup.position.set(7.8, 0.6, -4.6);
      nezhaGroup.rotation.y = -0.32;
      this.staircaseGroup.add(nezhaGroup);
    }

    // B. Nature Art Pack (`nature.glb`): Sacred Celestial Pines, Golden-Leaf Trees, Ferns & Rocks
    if (world?.nature?.scene) {
      const natScene = world.nature.scene;
      const pineTemplate = natScene.getObjectByName('Pine_1') || natScene.getObjectByName('CommonTree_1');
      const treeTemplate = natScene.getObjectByName('CommonTree_2') || natScene.getObjectByName('CommonTree_1');
      const rockTemplate = natScene.getObjectByName('Rock_Medium_1');
      const flowerTemplate = natScene.getObjectByName('Flower_3_Group') || natScene.getObjectByName('Bush_Common_Flowers');

      const plankPbr = this.ctx.assets.pbr('plank', 2, 2);
      const burlapPbr = this.ctx.assets.pbr('burlap', 3, 3);
      const rockPropPbr = this.ctx.assets.pbr('rock', 2, 2);

      const barkMat = new THREE.MeshStandardMaterial({
        color: 0x5c3e26,
        map: plankPbr.map,
        normalMap: plankPbr.normalMap,
        roughnessMap: plankPbr.roughnessMap,
        roughness: 0.85,
      });
      const foliageGoldMat = new THREE.MeshStandardMaterial({
        color: 0xdba844,
        map: burlapPbr.map,
        normalMap: burlapPbr.normalMap,
        roughness: 0.58,
        emissive: 0x3b2406,
        emissiveIntensity: 0.25,
      });
      const foliagePineMat = new THREE.MeshStandardMaterial({
        color: 0x3a6442,
        map: burlapPbr.map,
        normalMap: burlapPbr.normalMap,
        roughness: 0.65,
      });
      const boulderMat = new THREE.MeshStandardMaterial({
        color: 0x8c847a,
        map: rockPropPbr.map,
        normalMap: rockPropPbr.normalMap,
        roughnessMap: rockPropPbr.roughnessMap,
        roughness: 0.72,
      });

      const placeProp = (template: THREE.Object3D | undefined, x: number, y: number, z: number, scale: number, rotY: number, kind: 'pine' | 'goldTree' | 'rock' | 'flower') => {
        if (!template) return;
        const prop = template.clone(true);
        prop.position.set(x, y, z);
        prop.scale.setScalar(scale);
        prop.rotation.y = rotY;
        let meshIdx = 0;
        prop.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            if (kind === 'rock') {
              m.material = boulderMat;
            } else if (kind === 'pine') {
              m.material = meshIdx === 0 ? barkMat : foliagePineMat;
            } else if (kind === 'goldTree') {
              m.material = meshIdx === 0 ? barkMat : foliageGoldMat;
            } else {
              m.material = meshIdx === 0 ? foliagePineMat : foliageGoldMat;
            }
            meshIdx++;
          }
        });
        this.staircaseGroup.add(prop);
      };

      // Frame the staircase & cliff bastions with sacred pines, golden-blossom trees, and PBR boulders
      placeProp(pineTemplate, -19.5, -0.4, -4.2, 2.1, 0.4, 'pine');
      placeProp(pineTemplate, 19.5, -0.4, -4.2, 2.1, -0.6, 'pine');
      placeProp(treeTemplate, -13.8, -1.6, -5.2, 1.85, 1.1, 'goldTree');
      placeProp(treeTemplate, 13.8, -1.6, -5.2, 1.85, -1.2, 'goldTree');
      placeProp(rockTemplate, -9.8, -0.8, -3.4, 1.4, 0.8, 'rock');
      placeProp(rockTemplate, 9.8, -0.8, -3.4, 1.4, 2.1, 'rock');
      placeProp(flowerTemplate, -3.6, 0.0, -1.8, 1.4, 0.3, 'flower');
      placeProp(flowerTemplate, 3.6, 0.0, -1.8, 1.4, -0.5, 'flower');
    }

    // Add Jade Guardian Sentinel Lions / Finials at the base of the central steps
    if (world?.nezhaGeo) {
      for (const side of [-1, 1]) {
        const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 2), jadeMarbleMat);
        finial.position.set(side * 4.3, 0.65, 1.05);
        this.staircaseGroup.add(finial);
      }
    }
  }

  handleEvent(e: GameEvent, _game: Game): void {
    if (e.type === 'celestial_start') {
      this.active = true;
      this.group.visible = true;
      this.time = 0;
    }
  }

  update(dt: number, game: Game): void {
    // Also show CelestialScene during the second half of the 'ascend' cutscene so the soul visibly
    // rises through the clouds and stops on the white-and-gold staircase!
    const inAscendCutscene = game.phase === 'cutscene' && game.cutscene.phase === 'ascend';
    const isCelestial = game.phase === 'celestial' || inAscendCutscene;
    if (!this.active && !isCelestial) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    this.time += dt;

    // Match MountainPeakScene's exponential fog & sky horizon blending
    const cam = this.ctx.camera;
    this.skyMesh.position.copy(cam.position);
    this.seaMesh.position.copy(cam.position);

    // Drift thunderclouds and celestial sea waves smoothly
    this.uCloudShift.value.x += 0.012 * dt;
    this.uCloudShift.value.y += 0.004 * dt;
    this.uWindDrift.value.x += 1.8 * dt;
    this.uWindDrift.value.y += 0.7 * dt;

    // Periodic divine sheet lightning inside the golden thunderclouds
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) {
      this.uCelestialLightning.value = 0.75 + Math.random() * 0.45;
      const angle = (Math.random() - 0.5) * 1.4;
      this.uFlashDir.value.set(Math.sin(angle) * 0.6, 0.35 + Math.random() * 0.25, -Math.cos(angle) * 0.8).normalize();
      this.uFlashPos.value.set(Math.sin(angle) * 450, 240, -650);
      this.flashTimer = 3.2 + Math.random() * 4.5;
    } else {
      this.uCelestialLightning.value = Math.max(0, this.uCelestialLightning.value - dt * 2.8);
    }
    this.flashLight.intensity = this.uCelestialLightning.value * 4.5;

    // Update scene fog to match celestial horizon haze + lightning flare
    const f = this.uCelestialLightning.value;
    if (this.ctx.scene.fog instanceof THREE.FogExp2) {
      this.ctx.scene.fog.density = 0.0014;
      this.ctx.scene.fog.color.copy(CELESTIAL_PALETTE.haze).multiplyScalar(1 + f * 1.6);
    }

    // Keep sun shadow centered around warrior
    this.sunLight.target.position.set(cam.position.x, 0, 0);
    this.sunLight.position.set(cam.position.x - 22, 32, 18);
    this.sunLight.target.updateMatrixWorld();

    // Rotate guardian halos and flicker braziers
    for (let i = 0; i < this.guardianHalos.length; i++) {
      this.guardianHalos[i].rotation.z = this.time * 0.45 * (i % 2 === 0 ? 1 : -1);
    }
    for (let i = 0; i < this.lanternLights.length; i++) {
      this.lanternLights[i].intensity = 1.35 + Math.sin(this.time * 6.5 + i * 1.9) * 0.22;
    }

    // Drift golden stardust motes
    const posAttr = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3 + 0] += dt * 0.55;
      arr[i * 3 + 1] += Math.sin(this.time * 1.8 + i) * dt * 0.25;
      if (arr[i * 3 + 0] > 28) arr[i * 3 + 0] = -28;
      if (arr[i * 3 + 1] > 12) arr[i * 3 + 1] = -1;
    }
    posAttr.needsUpdate = true;
  }
}

function buildCelestialRange(spec: RangeSpec, rangeIndex: number, detail: number): THREE.BufferGeometry {
  const n = new Noise3(spec.seed);
  const columns = Math.round(((spec.halfLength * 2) / spec.spacing) * detail) + 1;
  const pos = new Float32Array(columns * ROWS * 3);
  const f = spec.freq;
  let k = 0;
  for (let i = 0; i < columns; i++) {
    const x = -spec.halfLength + (i / (columns - 1)) * spec.halfLength * 2;
    const massif = spec.lift + (1 - spec.lift) * smoothstep(0.18, 0.78, 0.5 + 0.5 * n.fbm(x * f * 0.45, 3.3, 1.7, 4));
    const ridge = n.ridged(x * f * 1.8, 0.5, 0.5, 6);
    const sharp = 0.45 + rangeIndex * 0.1;
    const crest01 = Math.min(1, massif * (1 - sharp + sharp * ridge));
    let land = smoothstep(spec.shore, spec.shore + 0.3, 0.5 + 0.5 * n.fbm(x * f * 0.22, 6.6, 4.1, 3));
    const az = Math.atan2(x, -spec.z);
    for (const [at, half] of spec.channels) land = Math.min(land, smoothstep(half, half * 2.6, Math.abs(az - at)));
    const height = spec.valley + (spec.summit - spec.valley) * Math.pow(crest01, 1.15);
    const crest = DROWNED_Y + (height - DROWNED_Y) * land;
    const zc = spec.z + spec.depth * 0.3 * n.noise(x * f * 0.5, 9.1, 0.3);
    const half = spec.depth * (0.8 + 0.35 * n.noise(x * f * 0.7, 2.2, 7.7));
    const relief = Math.max(0, crest - CELESTIAL_SEA_LEVEL) * 0.3;
    for (let j = 0; j < ROWS; j++) {
      const t = (j / (ROWS - 1)) * 2 - 1;
      const at = Math.abs(t);
      const fall = 1 - Math.pow(at, 0.75) * 0.55 - at * at * 0.45;
      const spur = (n.ridged(x * f * 3.2, t * 2.6, 4.4, 3) - 0.5) * relief * Math.sin(Math.PI * at);
      pos[k++] = x;
      pos[k++] = ROOT_Y + (crest - ROOT_Y) * fall + spur;
      pos[k++] = zc + t * half;
    }
  }
  const tris: number[] = [];
  for (let i = 0; i < columns - 1; i++) {
    for (let j = 0; j < ROWS - 1; j++) {
      const a = i * ROWS + j;
      const b = a + ROWS;
      tris.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(tris);
  g.computeVertexNormals();
  const range = new Float32Array(columns * ROWS);
  range.fill(rangeIndex);
  g.setAttribute('aRange', new THREE.BufferAttribute(range, 1));
  return g;
}

function buildFogSheets(depths: number[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const layer: number[] = [];
  const index: number[] = [];
  const deepest = depths[depths.length - 1];
  const SHEET_X = 95;
  const SHEET_Z0 = -340;
  const SHEET_Z1 = 60;
  for (let k = depths.length - 1; k >= 0; k--) {
    const y = depths[k];
    const base = pos.length / 3;
    pos.push(-SHEET_X, y, SHEET_Z0, SHEET_X, y, SHEET_Z0, SHEET_X, y, SHEET_Z1, -SHEET_X, y, SHEET_Z1);
    const l = y / deepest;
    layer.push(l, l, l, l);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
  g.setIndex(index);
  return g;
}

function buildFogWisps(count: number): THREE.InstancedBufferGeometry {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.attributes.position);
  const r = new Random(0x7421);
  const centre = new Float32Array(count * 3);
  const size = new Float32Array(count * 2);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const y = r.range(-65, -10);
    centre[i * 3] = r.range(-42, 42);
    centre[i * 3 + 1] = y;
    centre[i * 3 + 2] = r.range(-180, 12);
    size[i * 2] = r.range(10, 24);
    size[i * 2 + 1] = Math.min(r.range(14, 36), 2 * (-5 - y));
    seed[i] = r.next();
  }
  g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centre, 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  g.instanceCount = count;
  return g;
}
