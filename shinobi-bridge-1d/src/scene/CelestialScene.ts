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
  private readonly fillLight: THREE.DirectionalLight;
  private readonly ambientHemi: THREE.HemisphereLight;
  private readonly sunDisc: THREE.Mesh;
  private readonly sunHalo: THREE.Mesh;
  private readonly sunRays: THREE.Mesh;

  // Sky dome with celestial dawn/twilight gradient
  private readonly skyDome: THREE.Mesh;

  // Cloud floor meshes and custom volumetric cloud shader
  private readonly cloudMaterial: THREE.ShaderMaterial;
  private readonly cloudBillows: THREE.Mesh[] = [];

  // Soft Crepuscular God Rays
  private readonly godRays: THREE.Mesh[] = [];
  private readonly godRayMats: THREE.ShaderMaterial[] = [];

  // Distant Holy Mountain Silhouettes
  private readonly mountainSilhouettes: THREE.Mesh[] = [];

  // Floating sacred Torii gates & lanterns
  private readonly floatingStructures: THREE.Group[] = [];
  private readonly lanternLights: THREE.PointLight[] = [];

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

    // 1. Celestial Sky Dome (Deep twilight royal violet to golden dawn horizon)
    const skyGeo = new THREE.SphereGeometry(680, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          // Zenith (deep celestial violet) -> Mid (rose twilight & amber) -> Horizon (golden solar dawn)
          vec3 zenith = vec3(0.08, 0.04, 0.15);
          vec3 upper = vec3(0.35, 0.12, 0.22);
          vec3 mid = vec3(0.72, 0.25, 0.24);
          vec3 dawn = vec3(0.98, 0.52, 0.24);
          vec3 horizon = vec3(1.0, 0.82, 0.44);

          vec3 col = mix(horizon, dawn, smoothstep(-0.06, 0.14, h));
          col = mix(col, mid, smoothstep(0.12, 0.38, h));
          col = mix(col, upper, smoothstep(0.35, 0.65, h));
          col = mix(col, zenith, smoothstep(0.60, 0.96, h));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.name = 'celestial_sky_dome';
    this.group.add(this.skyDome);

    // 2. Divine Sunlight & Ambient Fill
    this.sunLight = new THREE.DirectionalLight(0xfffaee, 2.6);
    this.sunLight.position.set(-25, 28, 20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.bias = -0.0003;
    this.group.add(this.sunLight);

    // Front-fill directional light from camera side so character PBR & normal maps are brilliant
    this.fillLight = new THREE.DirectionalLight(0xffecd4, 1.35);
    this.fillLight.position.set(0, 10, 24);
    this.group.add(this.fillLight);

    // Warm golden sky light with deep twilight dusk bounce
    this.ambientHemi = new THREE.HemisphereLight(0xffc570, 0x3d1b28, 1.25);
    this.group.add(this.ambientHemi);

    // 3. Radiant Sun Disc, Multi-tier Golden Halo & Solar Corona
    const sunGeo = new THREE.CircleGeometry(5.2, 32);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfffae8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sunDisc = new THREE.Mesh(sunGeo, sunMat);
    this.sunDisc.position.set(-36, 26, -55);
    this.group.add(this.sunDisc);

    const haloGeo = new THREE.RingGeometry(5.2, 26.0, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffb844,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sunHalo = new THREE.Mesh(haloGeo, haloMat);
    this.sunHalo.position.copy(this.sunDisc.position);
    this.group.add(this.sunHalo);

    const raysGeo = new THREE.RingGeometry(6.0, 36.0, 8);
    const raysMat = new THREE.MeshBasicMaterial({
      color: 0xffdf66,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sunRays = new THREE.Mesh(raysGeo, raysMat);
    this.sunRays.position.copy(this.sunDisc.position);
    this.group.add(this.sunRays);

    // 4. Volumetric Golden Cloud Ocean (Custom GLSL Shader)
    this.cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(-0.6, 0.7, 0.4).normalize() },
        uSunColor: { value: new THREE.Color(0xffdf80) }, // Radiant solar gold
        uCloudBaseColor: { value: new THREE.Color(0xfcf0d8) }, // Warm luminous ivory cream
        uCloudShadowColor: { value: new THREE.Color(0x4a1f33) }, // Deep dusk violet-rose shadow
      },
      side: THREE.FrontSide,
    });

    // Walking cloud deck (overlapping smooth domes forming a solid walking deck at y = 0)
    const baseCloudGeo = new THREE.SphereGeometry(3.6, 24, 20);
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(baseCloudGeo, this.cloudMaterial);
      const x = (i - 24) * 2.6 + (Math.random() - 0.5) * 1.5;
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
    const bgCloudGeo = new THREE.SphereGeometry(8.5, 18, 14);
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(bgCloudGeo, this.cloudMaterial);
      const x = (i - 14) * 8.0 + (Math.random() - 0.5) * 4;
      const y = -6.2 + Math.random() * 1.5;
      const z = -28 - Math.random() * 18;
      mesh.position.set(x, y, z);
      mesh.scale.set(1.7, 0.85, 1.35);
      this.cloudBillows.push(mesh);
      this.group.add(mesh);
    }

    // 5. Distant Holy Mountain Silhouettes (Deep Sapphire / Indigo with golden rim)
    const slatePbr = ctx.assets.pbr('slate', 2, 2);
    const mtnGeo = new THREE.ConeGeometry(16, 26, 4);
    const mtnMat = new THREE.MeshStandardMaterial({
      color: 0x161828,
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

    // 6. Soft Crepuscular God Rays (Atmospheric light shafts with soft gaussian falloff)
    const rayGeo = new THREE.PlaneGeometry(12.0, 52.0);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform float uTime;
          uniform float uIndex;
          void main() {
            float x = vUv.x * 2.0 - 1.0;
            float y = vUv.y;
            float horiz = exp(-x * x * 4.2);
            float vert = smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.65, 1.0, y));
            float pulse = 0.85 + 0.15 * sin(uTime * 1.4 + uIndex * 1.3);
            float alpha = horiz * vert * 0.13 * pulse;
            vec3 col = vec3(1.0, 0.88, 0.55);
            gl_FragColor = vec4(col * alpha, alpha);
          }
        `,
        uniforms: {
          uTime: { value: 0 },
          uIndex: { value: i },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ray = new THREE.Mesh(rayGeo, mat);
      ray.position.set(-36 + i * 14, 24, -28 - i * 3);
      ray.rotation.z = -0.32 + i * 0.06;
      ray.rotation.y = 0.15;
      this.godRays.push(ray);
      this.godRayMats.push(mat);
      this.group.add(ray);
    }

    // 7. Floating Sacred Vermilion Torii Archways & Stone Lanterns
    const woodPbr = ctx.assets.pbr('plank', 1, 3);
    const toriiMat = new THREE.MeshStandardMaterial({
      color: 0xc43218, // Vibrant sacred vermilion
      map: woodPbr.map,
      normalMap: woodPbr.normalMap,
      roughnessMap: woodPbr.roughnessMap,
      roughness: 0.45,
      metalness: 0.12,
    });
    const blackLacquerMat = new THREE.MeshStandardMaterial({
      color: 0x141418,
      roughness: 0.32,
      metalness: 0.28,
    });
    const goldBrassMat = new THREE.MeshStandardMaterial({
      color: 0xffd244,
      metalness: 0.92,
      roughness: 0.2,
      emissive: 0x8a6410,
      emissiveIntensity: 0.4,
    });

    for (const offset of [-20, 19]) {
      const archGroup = new THREE.Group();
      archGroup.position.set(offset, 3.8, -12);
      archGroup.rotation.y = (Math.random() - 0.5) * 0.25;

      const pillarGeo = new THREE.CylinderGeometry(0.34, 0.44, 8.2, 16);
      const baseGeo = new THREE.CylinderGeometry(0.52, 0.58, 1.5, 16);

      for (const side of [-3.4, 3.4]) {
        const p = new THREE.Mesh(pillarGeo, toriiMat);
        p.position.set(side, 0, 0);
        const b = new THREE.Mesh(baseGeo, blackLacquerMat);
        b.position.set(side, -3.35, 0);
        archGroup.add(p, b);
      }

      // Upper curved kasagi beam
      const lintelGeo = new THREE.BoxGeometry(9.6, 0.68, 0.78);
      const lintel = new THREE.Mesh(lintelGeo, toriiMat);
      lintel.position.set(0, 4.05, 0);

      // Black lacquer roof cap with gold tips
      const capGeo = new THREE.BoxGeometry(10.1, 0.16, 0.88);
      const cap = new THREE.Mesh(capGeo, blackLacquerMat);
      cap.position.set(0, 4.45, 0);

      for (const endSide of [-5.0, 5.0]) {
        const goldCap = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.22, 0.92), goldBrassMat);
        goldCap.position.set(endSide, 4.45, 0);
        archGroup.add(goldCap);
      }

      // Lower tie nuki beam
      const tieGeo = new THREE.BoxGeometry(7.8, 0.45, 0.48);
      const tie = new THREE.Mesh(tieGeo, toriiMat);
      tie.position.set(0, 2.75, 0);

      // Central plaque strut (gakuzuka)
      const strutGeo = new THREE.BoxGeometry(0.35, 1.25, 0.4);
      const strut = new THREE.Mesh(strutGeo, toriiMat);
      strut.position.set(0, 3.4, 0);

      archGroup.add(lintel, cap, tie, strut);
      this.floatingStructures.push(archGroup);
      this.group.add(archGroup);
    }

    // Floating Stone Lanterns (Tōrō) with warm flickering fire
    const lanternGeo = new THREE.BoxGeometry(0.75, 1.25, 0.75);
    const fireGeo = new THREE.SphereGeometry(0.24, 12, 12);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });

    for (let i = 0; i < 4; i++) {
      const lanternGroup = new THREE.Group();
      lanternGroup.position.set(-24 + i * 16, 2.2 + (i % 2) * 1.2, -6 - (i % 2) * 4);
      const stone = new THREE.Mesh(lanternGeo, blackLacquerMat);
      const fire = new THREE.Mesh(fireGeo, fireMat);
      fire.position.y = 0.1;
      const pointLight = new THREE.PointLight(0xff9922, 1.2, 7.5);
      pointLight.position.y = 0.1;

      lanternGroup.add(stone, fire, pointLight);
      this.lanternLights.push(pointLight);
      this.floatingStructures.push(lanternGroup);
      this.group.add(lanternGroup);
    }

    // 8. Golden Stardust & Divine Sakura Petal Motes
    const moteCount = 180;
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
      size: 0.22,
      transparent: true,
      opacity: 0.88,
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
      this.ctx.scene.fog = new THREE.FogExp2(0x5a2432, 0.0032);
      this.ctx.scene.background = new THREE.Color(0x1a0c20);
    }
  }

  update(dt: number, game: Game): void {
    const isCelestial = game.phase === 'celestial';
    if (!this.active && !isCelestial) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    this.time += dt;

    // Keep celestial atmosphere active
    this.ctx.scene.fog = new THREE.FogExp2(0x5a2432, 0.0032);
    this.ctx.scene.background = new THREE.Color(0x1a0c20);

    this.cloudMaterial.uniforms.uTime.value = this.time;

    // Slowly rotate solar rays corona
    this.sunRays.rotation.z += dt * 0.04;

    for (const mat of this.godRayMats) {
      mat.uniforms.uTime.value = this.time;
    }

    // Flicker lantern lights gently
    for (let i = 0; i < this.lanternLights.length; i++) {
      this.lanternLights[i].intensity = 1.1 + Math.sin(this.time * 7 + i * 2.3) * 0.25;
    }

    for (let i = 0; i < this.floatingStructures.length; i++) {
      const s = this.floatingStructures[i];
      s.position.y += Math.sin(this.time * 1.2 + i * 1.5) * dt * 0.18;
      s.rotation.z = Math.sin(this.time * 0.8 + i) * 0.02;
    }

    for (let i = 0; i < this.godRays.length; i++) {
      const r = this.godRays[i];
      r.rotation.z += Math.sin(this.time * 0.5 + i) * dt * 0.012;
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
