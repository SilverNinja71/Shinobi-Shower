import * as THREE from 'three';
import type { GameEvent, GameLoop } from '../core/GameLoop.ts';
import { DROPLET_KINDS, HEAVY_RADIUS } from '../hazards/DropletProjectile.ts';
import type { DropletKind } from '../hazards/DropletProjectile.ts';
import { HEAD_POS } from '../hazards/DropletSpawner.ts';
import { FoamBubbles } from '../hazards/SudsVortex.ts';
import { STALL_HALF } from '../player/FloorInteraction.ts';
import { ScreenSteamPostProcess } from './ScreenSteamPostProcess.ts';
import { MAX_RIPPLES, WetFloorCaustics } from './WetFloorCaustics.ts';

const WALL_HEIGHT = 6;
const MAX_TELEGRAPHS = 64;
const MAX_BUBBLES = 12;
const MIST_VISUAL_SCALE = 1.6;

/** Water looks, by droplet kind. Deep blue against the pink floor keeps threats readable. */
const DROPLET_LOOK: Record<DropletKind, { core: number; rim: number; alpha: number; capacity: number }> = {
  mist: { core: 0xffffff, rim: 0xffffff, alpha: 0.28, capacity: 200 },
  spray: { core: 0x2f86d8, rim: 0xd8f4ff, alpha: 0.95, capacity: 500 },
  stream: { core: 0x0d5fc0, rim: 0x9fe8ff, alpha: 1, capacity: 300 },
  heavy: { core: 0x123f9c, rim: 0x98d8ff, alpha: 1, capacity: MAX_TELEGRAPHS },
  bead: { core: 0x1766c9, rim: 0xcdf1ff, alpha: 1, capacity: 300 },
};

const dropletVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const dropletFragment = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uRim;
  uniform float uAlpha;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
    vec3 col = mix(uCore, uRim, rim);
    float spec = pow(max(dot(n, normalize(vec3(0.3, 0.8, 0.35))), 0.0), 40.0);
    gl_FragColor = vec4(col + spec, uAlpha);
  }
`;

const decalVertex = /* glsl */ `
  attribute float aProgress;
  varying vec2 vUv;
  varying float vProgress;
  void main() {
    vUv = uv * 2.0 - 1.0;
    vProgress = aProgress;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

// The expanding shadow of a heavy drop, with a ring that closes on the impact radius at exactly 0.75 s.
const decalFragment = /* glsl */ `
  varying vec2 vUv;
  varying float vProgress;
  void main() {
    float r = length(vUv);
    float t = vProgress;
    float impact = 0.5;
    float shadow = smoothstep(impact * (0.3 + 0.7 * t), impact * (0.3 + 0.7 * t) - 0.08, r) * (0.25 + 0.55 * t * t);
    float ringR = mix(1.0, impact, t);
    float ring = smoothstep(0.035, 0.0, abs(r - ringR)) * (0.35 + 0.65 * t);
    float bound = smoothstep(0.018, 0.0, abs(r - impact)) * 0.55;
    vec3 col = mix(vec3(0.07, 0.06, 0.24), vec3(1.0), ring);
    float alpha = max(max(shadow, ring), bound);
    gl_FragColor = vec4(col, alpha);
  }
`;

const bubbleFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    float f = 1.0 - max(dot(n, v), 0.0);
    float rim = pow(f, 2.2);
    vec3 film = 0.5 + 0.5 * cos(6.283 * (f * 1.7 + n.y * 0.4 + uTime * 0.07 + vec3(0.0, 0.33, 0.67)));
    vec3 col = mix(vec3(1.0), film, 0.55);
    float spec = pow(max(dot(n, normalize(vec3(-0.4, 0.8, 0.3))), 0.0), 50.0);
    gl_FragColor = vec4(col + spec, clamp(0.14 + rim * 0.82 + spec, 0.0, 1.0));
  }
`;

const chromeFragment = /* glsl */ `
  varying vec3 vNormalW;
  void main() {
    vec3 n = normalize(vNormalW);
    float band = 0.5 + 0.5 * sin(n.y * 5.0 + n.x * 3.0);
    vec3 col = mix(vec3(0.23, 0.25, 0.30), vec3(0.96, 0.97, 1.0), smoothstep(0.15, 0.9, band));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const plainVertex = /* glsl */ `
  varying vec3 vNormalW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const wallVertex = /* glsl */ `
  varying vec2 vTile;
  varying float vHeight;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vTile = vec2(abs(normal.x) > 0.5 ? world.z : world.x, world.y);
    vHeight = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const wallFragment = /* glsl */ `
  uniform float uHeight;
  varying vec2 vTile;
  varying float vHeight;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 p = vTile + vec2(7.0, 0.0);
    vec2 cell = floor(p);
    vec2 f = p - cell;
    vec2 e = min(f, 1.0 - f);
    float grout = 1.0 - smoothstep(0.022, 0.04, min(e.x, e.y));
    vec3 col = mix(vec3(0.86, 0.50, 0.56), vec3(0.91, 0.57, 0.60), hash(cell));
    float streak = smoothstep(0.92, 1.0, hash(vec2(floor(p.x * 7.0), 3.0)));
    col = mix(col, vec3(0.98, 0.86, 0.86), streak * 0.14);
    col = mix(col, vec3(0.32, 0.22, 0.26), grout);
    // Black bullnose trim at the floor and at dado height, as in a 1950s bathroom.
    float base = smoothstep(0.34, 0.31, vHeight);
    float dado = smoothstep(0.1, 0.08, abs(vHeight - uHeight + 1.2));
    col = mix(col, vec3(0.07, 0.06, 0.09), max(base, dado));
    col *= 0.62 + 0.38 * smoothstep(0.0, 2.4, vHeight);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function roundedBox(width: number, height: number, depth: number, radius: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(width, height, depth, 10, 8, 10);
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const inner = new THREE.Vector3(width / 2 - radius, height / 2 - radius, depth / 2 - radius);
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.copy(v).clamp(inner.clone().negate(), inner);
    const n = v.sub(c).normalize();
    pos.setXYZ(i, c.x + n.x * radius, c.y + n.y * radius, c.z + n.z * radius);
    norm.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

interface Pop {
  mesh: THREE.Mesh;
  age: number;
}

export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  private readonly post = new ScreenSteamPostProcess();
  private readonly floor = new WetFloorCaustics();
  private readonly dropletMeshes = {} as Record<DropletKind, THREE.InstancedMesh>;
  private readonly decals: THREE.InstancedMesh;
  private readonly decalProgress: THREE.InstancedBufferAttribute;
  private readonly bubbles: THREE.InstancedMesh;
  private readonly bubbleMaterial: THREE.ShaderMaterial;
  private readonly player = new THREE.Group();
  private readonly soap: THREE.Mesh;
  private readonly playerBubble: THREE.Mesh;
  private readonly warning: THREE.Mesh;
  private readonly splash: Pop[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private cameraBack = 1;
  private shake = 0;
  private hitFlash = 0;
  private squash = 0;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    // Colours are authored directly in display space, so everything is left unconverted.
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene.background = new THREE.Color(0x6b4450);

    const lightA = new THREE.HemisphereLight(0xffffff, 0xf0a0b0, 1.5);
    const lightB = new THREE.DirectionalLight(0xffffff, 1.5);
    lightB.position.set(2, 8, 4);
    this.scene.add(lightA, lightB);

    this.buildRoom();

    for (const kind of DROPLET_KINDS) {
      const look = DROPLET_LOOK[kind];
      const mesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, kind === 'mist' ? 6 : 12, kind === 'mist' ? 4 : 8),
        new THREE.ShaderMaterial({
          vertexShader: dropletVertex,
          fragmentShader: dropletFragment,
          transparent: look.alpha < 1,
          depthWrite: look.alpha >= 0.9,
          uniforms: {
            uCore: { value: new THREE.Color(look.core) },
            uRim: { value: new THREE.Color(look.rim) },
            uAlpha: { value: look.alpha },
          },
        }),
        look.capacity,
      );
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.dropletMeshes[kind] = mesh;
      this.scene.add(mesh);
    }

    const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalProgress = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TELEGRAPHS), 1);
    this.decalProgress.setUsage(THREE.DynamicDrawUsage);
    decalGeo.setAttribute('aProgress', this.decalProgress);
    this.decals = new THREE.InstancedMesh(
      decalGeo,
      new THREE.ShaderMaterial({
        vertexShader: decalVertex,
        fragmentShader: decalFragment,
        transparent: true,
        depthWrite: false,
      }),
      MAX_TELEGRAPHS,
    );
    this.decals.frustumCulled = false;
    this.decals.count = 0;
    this.decals.renderOrder = 1;
    this.scene.add(this.decals);

    this.bubbleMaterial = new THREE.ShaderMaterial({
      vertexShader: dropletVertex,
      fragmentShader: bubbleFragment,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
    });
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 28, 20), this.bubbleMaterial, MAX_BUBBLES);
    this.bubbles.frustumCulled = false;
    this.bubbles.count = 0;
    this.bubbles.renderOrder = 3;
    this.scene.add(this.bubbles);

    this.soap = this.buildCharacter();
    this.playerBubble = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 16), new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vNormalW;
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: bubbleFragment,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.bubbleMaterial.uniforms.uTime },
    }));
    this.playerBubble.position.y = 0.4;
    this.playerBubble.renderOrder = 4;
    this.playerBubble.visible = false;
    this.player.add(this.playerBubble);
    this.scene.add(this.player);

    this.warning = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0d5fc0, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.warning.visible = false;
    this.warning.renderOrder = 1;
    this.scene.add(this.warning);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private buildRoom(): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(STALL_HALF * 2, STALL_HALF * 2).rotateX(-Math.PI / 2), this.floor.material);
    this.scene.add(floor);

    const wallMat = new THREE.ShaderMaterial({
      vertexShader: wallVertex,
      fragmentShader: wallFragment,
      side: THREE.DoubleSide,
      uniforms: { uHeight: { value: WALL_HEIGHT } },
    });
    const wall = (x: number, z: number, rotY: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(STALL_HALF * 2, WALL_HEIGHT), wallMat);
      mesh.position.set(x, WALL_HEIGHT / 2, z);
      mesh.rotation.y = rotY;
      this.scene.add(mesh);
    };
    wall(0, -STALL_HALF, 0);
    wall(-STALL_HALF, 0, Math.PI / 2);
    wall(STALL_HALF, 0, -Math.PI / 2);

    const chrome = new THREE.ShaderMaterial({ vertexShader: plainVertex, fragmentShader: chromeFragment });
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 12).rotateX(Math.PI / 2), chrome);
    arm.position.set(HEAD_POS.x, HEAD_POS.y + 0.55, -STALL_HALF + 0.5);
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 20).rotateX(Math.PI / 2), chrome);
    flange.position.set(HEAD_POS.x, HEAD_POS.y + 0.55, -STALL_HALF + 0.03);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.62, 0.34, 28), chrome);
    head.position.set(HEAD_POS.x, HEAD_POS.y + 0.2, HEAD_POS.z + 0.15);
    head.rotation.x = 0.3;
    this.scene.add(arm, flange, head);
  }

  private buildCharacter(): THREE.Mesh {
    const soap = new THREE.Mesh(
      roundedBox(0.98, 0.5, 0.66, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xc9f2dc, roughness: 0.32, metalness: 0 }),
    );
    soap.position.y = 0.25;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x151018 });
    const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 10), eyeMat);
      eye.position.set(side * 0.2, 0.19, 0.22);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), glint);
      spark.position.set(side * 0.2 + 0.02, 0.245, 0.26);
      soap.add(eye, spark);
    }
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.05), eyeMat);
    brow.position.set(0, 0.255, 0.17);
    soap.add(brow);
    this.player.add(soap);
    // A thin ring keeps him findable when the floor gets busy.
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.62, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc9f2dc, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    marker.position.y = 0.035;
    marker.renderOrder = 2;
    this.player.add(marker);
    return soap;
  }

  private resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    // A page opened in a hidden tab can report no size until it is shown.
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
    this.camera.aspect = w / h;
    // Portrait screens pull back so the whole floor stays in frame.
    this.cameraBack = Math.max(1, 1.28 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  /** Spawns visuals for this frame's game events. The events themselves are consumed by main. */
  handleEvent(e: GameEvent): void {
    switch (e.type) {
      case 'plink':
        this.floor.stampBead(e.x, e.z, 0.32 + e.size, 0.42);
        break;
      case 'impact':
        this.floor.stampBead(e.x, e.z, 1.25, 1);
        this.addPop(e.x, e.z, 1.4, 0xd8f4ff);
        this.addShake(0.12);
        break;
      case 'crush':
        this.hitFlash = 1;
        this.addShake(0.42);
        this.squash = 1;
        break;
      case 'hit':
        this.hitFlash = Math.max(this.hitFlash, 0.4);
        this.addShake(0.1);
        break;
      case 'land':
        this.floor.stampBead(e.x, e.z, 0.6, 0.55);
        this.addPop(e.x, e.z, 0.9, 0xffffff);
        this.squash = Math.max(this.squash, e.size * 0.8);
        break;
      case 'wall':
        this.addShake(0.08 * e.size);
        break;
      case 'burst':
        this.addPop(e.x, e.z, 1.4, 0xf3e6ff);
        break;
      default:
        break;
    }
  }

  private addShake(amount: number): void {
    if (!this.reducedMotion) this.shake = Math.min(0.6, this.shake + amount);
  }

  /** A splash ring, drawn as an expanding flat torus. */
  private addPop(x: number, z: number, size: number, color: number): void {
    if (this.splash.length > 16) return;
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.04, 6, 32).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }),
    );
    mesh.position.set(x, 0.04, z);
    mesh.userData.size = size;
    this.scene.add(mesh);
    this.splash.push({ mesh, age: 0 });
  }

  render(dt: number, game: GameLoop): void {
    this.time += dt;
    this.updateFloor(dt, game);
    this.updateDroplets(game);
    this.updateBubbles(game);
    this.updatePlayer(dt, game);
    this.updateWarning(game);
    this.updateSplashes(dt);
    this.updateCamera(dt, game);

    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.4);
    this.post.render(this.renderer, this.scene, this.camera, this.time, this.steamLevel(game), this.hitFlash);
  }

  /** Heat, moisture and airborne mist all fog the glass. */
  private steamLevel(game: GameLoop): number {
    const heat = (game.heat - 37) / 15;
    const live = game.state !== 'attract';
    const moisture = live ? game.moisture.value / 100 : 0;
    return Math.min(0.85, 0.1 + heat * 0.42 + moisture * 0.22);
  }

  private updateFloor(dt: number, game: GameLoop): void {
    this.floor.update(dt, this.time, game.grid, game.drainStrength);
    this.floor.setPlayer(game.player.x, game.player.z, game.state === 'attract' ? 100 : game.player.y);
    const ripples = game.spawner.ripples;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = ripples[ripples.length - 1 - i];
      if (r) this.floor.setRipple(i, r.x, r.z, r.r, 1 - r.r / r.maxR);
      else this.floor.setRipple(i, 0, 0, 0, 0);
    }
  }

  private updateDroplets(game: GameLoop): void {
    const counts: Record<DropletKind, number> = { mist: 0, spray: 0, stream: 0, heavy: 0, bead: 0 };
    let decalCount = 0;
    const dummy = this.dummy;
    for (const d of game.spawner.pool.alive) {
      const mesh = this.dropletMeshes[d.kind];
      if (counts[d.kind] < mesh.instanceMatrix.count) {
        dummy.position.set(d.x, d.y, d.z);
        const speed = Math.hypot(d.vx, d.vy, d.vz);
        if (d.kind === 'mist') {
          dummy.quaternion.identity();
          dummy.scale.setScalar(d.r * MIST_VISUAL_SCALE);
        } else if (speed > 1) {
          // Stretch along velocity: fast water reads as streaks.
          this.dir.set(d.vx / speed, d.vy / speed, d.vz / speed);
          dummy.quaternion.setFromUnitVectors(this.up, this.dir);
          const stretch = 1 + Math.min(1.6, speed * 0.075);
          dummy.scale.set(d.r / Math.sqrt(stretch), d.r * stretch, d.r / Math.sqrt(stretch));
        } else {
          dummy.quaternion.identity();
          dummy.scale.setScalar(d.r);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(counts[d.kind]++, dummy.matrix);
      }
      if (d.kind === 'heavy' && decalCount < MAX_TELEGRAPHS) {
        dummy.position.set(d.x, 0.025, d.z);
        dummy.quaternion.identity();
        dummy.scale.setScalar(HEAVY_RADIUS * 4);
        dummy.updateMatrix();
        this.decals.setMatrixAt(decalCount, dummy.matrix);
        this.decalProgress.setX(decalCount, d.age / d.life);
        decalCount++;
      }
    }
    for (const kind of DROPLET_KINDS) {
      const mesh = this.dropletMeshes[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.decals.count = decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
    this.decalProgress.needsUpdate = true;
  }

  private updateBubbles(game: GameLoop): void {
    this.bubbleMaterial.uniforms.uTime.value = this.time;
    const items = game.bubbles.items;
    const count = Math.min(items.length, MAX_BUBBLES);
    for (let i = 0; i < count; i++) {
      const b = items[i];
      this.dummy.position.set(b.x, FoamBubbles.heightOf(b), b.z);
      this.dummy.quaternion.identity();
      const wobble = Math.sin(b.age * 4.8) * 0.05;
      this.dummy.scale.set(b.r * (1 + wobble), b.r * (1 - wobble), b.r * (1 + wobble));
      this.dummy.updateMatrix();
      this.bubbles.setMatrixAt(i, this.dummy.matrix);
    }
    this.bubbles.count = count;
    this.bubbles.instanceMatrix.needsUpdate = true;
  }

  private updatePlayer(dt: number, game: GameLoop): void {
    const p = game.player;
    const live = game.state !== 'attract';
    this.player.visible = live;
    if (!live) return;

    this.player.position.set(p.x, p.y, p.z);
    this.player.rotation.y = p.facing;
    this.playerBubble.visible = p.encased;
    if (p.encased) {
      const pulse = 1 + Math.sin(this.time * 7) * 0.04;
      this.playerBubble.scale.set(pulse, 2 - pulse, pulse);
    }

    this.squash = Math.max(0, this.squash - dt * 4.5);
    // He melts as he gets wetter. This is cosmetic, the hitbox stays the same.
    const melt = 1 - (game.moisture.value / 100) * 0.3;
    let sx = melt;
    let sy = melt;
    if (p.sliding) {
      sx *= 1.2;
      sy *= 0.68;
    }
    if (!p.grounded) sy *= 1 + Math.min(0.25, Math.abs(p.vy) * 0.04);
    if (p.dashing) {
      sx *= 0.75;
      sy *= 0.78;
    }
    sy *= 1 - this.squash * 0.42;
    sx *= 1 + this.squash * 0.3;
    this.soap.scale.set(sx, sy, p.dashing ? melt * 1.5 : sx);
    this.soap.position.y = 0.25 * sy;
    // Lean into the skid.
    this.soap.rotation.z = -Math.min(0.32, p.drift * 0.045) * Math.sign(p.vx * Math.cos(p.facing) - p.vz * Math.sin(p.facing));

    // Flicker while protected after a hit.
    this.soap.visible = p.iframes <= 0 || Math.floor(this.time * 18) % 2 === 0;
  }

  private updateWarning(game: GameLoop): void {
    const w = game.spawner.streamWarning;
    this.warning.visible = w !== null;
    if (!w) return;
    const horizontal = w.side < 2;
    const sign = w.side % 2 === 0 ? -1 : 1;
    const inset = STALL_HALF - 0.6;
    this.warning.position.set(horizontal ? 0 : sign * inset, 0.03, horizontal ? sign * inset : 0);
    this.warning.scale.set(horizontal ? STALL_HALF * 2 : 1.2, 1, horizontal ? 1.2 : STALL_HALF * 2);
    (this.warning.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.3 * Math.sin(this.time * 28);
  }

  private updateSplashes(dt: number): void {
    for (let i = this.splash.length - 1; i >= 0; i--) {
      const s = this.splash[i];
      s.age += dt;
      const t = s.age / 0.38;
      if (t >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.splash.splice(i, 1);
        continue;
      }
      const size = (s.mesh.userData.size as number) * (0.25 + t);
      s.mesh.scale.set(size, 1, size);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
  }

  private updateCamera(dt: number, game: GameLoop): void {
    const live = game.state !== 'attract';
    const px = live ? game.player.x : 0;
    const pz = live ? game.player.z : 0;
    this.shake = Math.max(0, this.shake - dt * 1.9);
    const sx = (Math.sin(this.time * 57) + Math.sin(this.time * 31)) * this.shake * 0.28;
    const sz = Math.sin(this.time * 43) * this.shake * 0.28;
    this.camera.position.set(
      px * 0.1 + sx,
      18.6 * this.cameraBack,
      11.8 * this.cameraBack + pz * 0.1 + sz,
    );
    this.lookAt.set(px * 0.12 + sx * 0.4, 0, 0.75 + pz * 0.12);
    this.camera.lookAt(this.lookAt);
  }
}
