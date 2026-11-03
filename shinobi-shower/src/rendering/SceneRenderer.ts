import * as THREE from 'three';
import type { GameEvent, TrialGame } from '../core/TrialGame.ts';
import { halfFade } from '../hazards/WaterDroplet.ts';
import { raycast } from '../parkour/WallRunDetector.ts';
import { KIND, tileMaterial, waterMaterial } from './TileShader.ts';
import { LensPost } from './LensPost.ts';

const NEAR = 0.05;
const FAR = 220;
const BASE_FOV = 72;
/** How far the camera trails the ninja. Walls pull it in. */
const CAMERA_DISTANCE = 4.4;
const CAMERA_MARGIN = 0.25;
const CAMERA_MIN = 0.7;
/** Lifts the view above the head, so the crosshair sits clear of the character. */
const CAMERA_LIFT = 0.55;
const HIDE_MODEL_BELOW = 1.3;
const ROBE_DRY = new THREE.Color(0x3a609f);
const ROBE_SOAKED = new THREE.Color(0x0e1a30);
const MAX_DROPLETS = 96;
const MAX_HALVES = 30;
const MAX_MIST = 240;
const MAX_WET = 256;
const TRAIL_STEPS = 10;

const dropVertex = /* glsl */ `
  attribute float aFade;
  varying vec3 vNormalV;
  varying float vFade;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormalV = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vFade = aFade;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Real screen-space refraction: each droplet looks up the opaque scene through its own surface.
const dropFragment = /* glsl */ `
  uniform sampler2D tOpaque;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  varying vec3 vNormalV;
  varying float vFade;
  void main() {
    vec2 screen = gl_FragCoord.xy / uResolution;
    if (gl_FragCoord.z > texture2D(tDepth, screen).r) discard;
    vec3 n = normalize(vNormalV);
    float facing = max(n.z, 0.0);
    vec2 bend = -n.xy * (0.11 + 0.1 * (1.0 - facing));
    vec3 c = texture2D(tOpaque, screen + bend).rgb * vec3(0.76, 0.92, 1.02);
    float rim = pow(1.0 - facing, 2.5);
    c = mix(c, vec3(0.60, 0.85, 0.98), rim * 0.75);
    vec3 light = normalize(vec3(-0.4, 0.65, 0.65));
    float spec = pow(max(dot(n, light), 0.0), 70.0);
    float second = pow(max(dot(n, normalize(vec3(0.5, -0.55, 0.5))), 0.0), 18.0) * 0.28;
    gl_FragColor = vec4(c + spec + second, vFade);
  }
`;

const decalFragment = /* glsl */ `
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float shadow = smoothstep(1.0, 0.25, r) * 0.55;
    float ring = smoothstep(0.09, 0.0, abs(r - 0.92)) * 0.65;
    gl_FragColor = vec4(mix(vec3(0.03, 0.08, 0.2), vec3(1.0), ring / (ring + shadow + 0.001)), max(shadow, ring) * vFade);
  }
`;

const decalVertex = /* glsl */ `
  attribute float aFade;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vUv = uv;
    vFade = aFade;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const beamVertex = /* glsl */ `
  attribute float aLength;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying float vLength;
  void main() {
    vUv = uv;
    vLength = aLength;
    vNormalV = normalize(mat3(viewMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const beamFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying float vLength;
  void main() {
    float facing = max(normalize(vNormalV).z, 0.0);
    float flow = sin(vUv.y * vLength * 2.6 + uTime * 26.0 + sin(vUv.x * 40.0) * 2.0);
    float grain = sin(vUv.x * 62.0 + vUv.y * vLength * 1.2 - uTime * 18.0);
    vec3 c = mix(vec3(0.12, 0.46, 0.84), vec3(0.83, 0.97, 1.0), pow(1.0 - facing, 1.8) + (flow + grain) * 0.1 + 0.18);
    gl_FragColor = vec4(c, 0.9);
  }
`;

const bubbleVertex = /* glsl */ `
  varying vec3 vNormalV;
  void main() {
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bubbleFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormalV;
  void main() {
    vec3 n = normalize(vNormalV);
    float f = 1.0 - max(n.z, 0.0);
    vec3 film = 0.5 + 0.5 * cos(6.283 * (f * 1.8 + n.y * 0.4 + uTime * 0.09 + vec3(0.0, 0.33, 0.67)));
    float spec = pow(max(dot(n, normalize(vec3(-0.4, 0.6, 0.65))), 0.0), 50.0);
    gl_FragColor = vec4(mix(vec3(1.0), film, 0.6) + spec, clamp(0.18 + pow(f, 2.0) * 0.85 + spec, 0.0, 1.0));
  }
`;

function chrome(time: { value: number }): THREE.ShaderMaterial {
  const fakeBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 }, wetBands: [] } as never;
  return tileMaterial(fakeBox, KIND.chrome, time);
}

/** Points draw as squares unless textured, and mist should read as round motes. */
function roundDot(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const fill = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  fill.addColorStop(0, 'rgba(255,255,255,1)');
  fill.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, faded = false): THREE.InstancedMesh {
  if (faded) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', attr);
  }
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly dropScene = new THREE.Scene();
  private readonly copyScene = new THREE.Scene();
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, NEAR, FAR);
  private readonly post = new LensPost(NEAR, FAR);
  private readonly opaque: THREE.WebGLRenderTarget;
  private readonly composite: THREE.WebGLRenderTarget;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly dropMaterial: THREE.ShaderMaterial;
  private readonly time = { value: 0 };
  private readonly boxMeshes: { mesh: THREE.Mesh; box: TrialGame['level']['boxes'][number] }[] = [];
  private readonly droplets: THREE.InstancedMesh;
  private readonly halves: THREE.InstancedMesh;
  private readonly shadows: THREE.InstancedMesh;
  private readonly wetCells: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private readonly beamLength: THREE.InstancedBufferAttribute;
  private readonly splashes: THREE.Mesh[] = [];
  private readonly bubbleMeshes: THREE.Mesh[] = [];
  private readonly mist: THREE.Points;
  private readonly mistPositions: THREE.BufferAttribute;
  private readonly trails: THREE.LineSegments;
  private readonly trailPositions: THREE.BufferAttribute;
  private readonly wire: THREE.Mesh;
  private readonly model = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly tails = new THREE.Group();
  private readonly robe = new THREE.MeshStandardMaterial({ color: ROBE_DRY.clone(), roughness: 0.75 });
  private readonly slashRoot = new THREE.Group();
  private readonly arc: THREE.Mesh;
  private heading = 0;
  private stride = 0;
  private cameraDistance = CAMERA_DISTANCE;
  private pivotY = 0;
  private pivotReady = false;
  private readonly dummy = new THREE.Object3D();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private roll = 0;
  private dip = 0;
  private hitFlash = 0;
  private steam = 0;
  private blade = 0;
  private menuTime = 0;

  constructor(canvas: HTMLCanvasElement, game: TrialGame) {
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene.background = new THREE.Color(0xdfeee8);
    this.scene.add(this.camera);
    const sky = new THREE.HemisphereLight(0xffffff, 0x8fb5ab, 3.4);
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(-3, 8, 4);
    this.scene.add(sky, sun);

    const depth = new THREE.DepthTexture(4, 4);
    depth.type = THREE.UnsignedIntType;
    this.opaque = new THREE.WebGLRenderTarget(4, 4, { depthTexture: depth, depthBuffer: true });
    this.composite = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });

    this.copyMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main() { gl_FragColor = texture2D(t, vUv); }',
      uniforms: { t: { value: this.opaque.texture } },
    });
    this.copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial));

    this.post.material.uniforms.tScene.value = this.composite.texture;
    this.post.material.uniforms.tDepth.value = depth;

    this.dropMaterial = new THREE.ShaderMaterial({
      vertexShader: dropVertex,
      fragmentShader: dropFragment,
      transparent: true,
      uniforms: {
        tOpaque: { value: this.opaque.texture },
        tDepth: { value: depth },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.droplets = instanced(new THREE.SphereGeometry(1, 28, 20), this.dropMaterial, MAX_DROPLETS, true);
    this.halves = instanced(
      new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: dropVertex,
        fragmentShader: dropFragment,
        transparent: true,
        side: THREE.DoubleSide,
        uniforms: this.dropMaterial.uniforms,
      }),
      MAX_HALVES,
      true,
    );
    this.dropScene.add(this.droplets, this.halves);

    this.trailPositions = new THREE.BufferAttribute(new Float32Array(MAX_DROPLETS * TRAIL_STEPS * 6), 3);
    this.trailPositions.setUsage(THREE.DynamicDrawUsage);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', this.trailPositions);
    this.trails = new THREE.LineSegments(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.trails.frustumCulled = false;
    this.dropScene.add(this.trails);

    this.shadows = instanced(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: decalVertex,
        fragmentShader: decalFragment,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      MAX_DROPLETS,
      true,
    );
    this.scene.add(this.shadows);

    this.wetCells = instanced(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x1f6569, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide }),
      MAX_WET,
    );
    this.scene.add(this.wetCells);

    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0);
    this.beamLength = new THREE.InstancedBufferAttribute(new Float32Array(game.streams.length), 1);
    this.beamLength.setUsage(THREE.DynamicDrawUsage);
    beamGeo.setAttribute('aLength', this.beamLength);
    this.beams = instanced(
      beamGeo,
      new THREE.ShaderMaterial({ vertexShader: beamVertex, fragmentShader: beamFragment, transparent: true, uniforms: { uTime: this.time } }),
      game.streams.length,
    );
    this.scene.add(this.beams);

    const mistGeo = new THREE.BufferGeometry();
    this.mistPositions = new THREE.BufferAttribute(new Float32Array(MAX_MIST * 3), 3);
    this.mistPositions.setUsage(THREE.DynamicDrawUsage);
    mistGeo.setAttribute('position', this.mistPositions);
    this.mist = new THREE.Points(mistGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, map: roundDot(), transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true }));
    this.mist.frustumCulled = false;
    this.scene.add(this.mist);

    this.wire = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0x18242c }));
    this.wire.visible = false;
    this.scene.add(this.wire);

    this.buildWorld(game);
    this.arc = this.buildNinja();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private buildWorld(game: TrialGame): void {
    const level = game.level;
    for (const box of level.boxes) {
      const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z] as const;
      // A unit cube scaled per box. The tile pattern comes from world position, so it doesn't stretch.
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tileMaterial(box, KIND[box.look === 'bottle' ? 'bottle' : box.look], this.time));
      mesh.scale.set(...size);
      mesh.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
      this.scene.add(mesh);
      this.boxMeshes.push({ mesh, box });
    }

    const water = new THREE.Mesh(new THREE.PlaneGeometry(64, 64).rotateX(-Math.PI / 2), waterMaterial(this.time));
    water.position.y = 0;
    this.scene.add(water);

    const metal = chrome(this.time);
    for (const rail of level.rails) {
      for (let i = 0; i + 1 < rail.points.length; i++) {
        const a = new THREE.Vector3(rail.points[i].x, rail.points[i].y, rail.points[i].z);
        const b = new THREE.Vector3(rail.points[i + 1].x, rail.points[i + 1].y, rail.points[i + 1].z);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1, 12).translate(0, 0.5, 0), metal);
        mesh.position.copy(a).setY(a.y - 0.05);
        mesh.scale.y = a.distanceTo(b);
        mesh.quaternion.setFromUnitVectors(this.up, this.dir.copy(b).sub(a).normalize());
        this.scene.add(mesh);
      }
    }
    for (const a of level.anchors) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.13, 10, 28), metal);
      ring.position.set(a.x, a.y, a.z);
      this.scene.add(ring);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 80, 8), metal);
      stem.position.set(a.x, a.y + 40.5, a.z);
      this.scene.add(stem);
    }
    for (let i = 0; i < game.bouncers.length; i++) {
      const b = game.bouncers[i];
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(b.spec.r, 28, 20),
        new THREE.ShaderMaterial({ vertexShader: bubbleVertex, fragmentShader: bubbleFragment, transparent: true, depthWrite: false, uniforms: { uTime: this.time } }),
      );
      this.scene.add(mesh);
      this.bubbleMeshes.push(mesh);
    }

    // The Master Showerhead looms over the top stage.
    const head = new THREE.Mesh(new THREE.CylinderGeometry(3, 8, 2.4, 40), metal);
    head.position.set(0, 73.4, 10);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 40, 16).rotateX(Math.PI / 2), metal);
    neck.position.set(0, 75, -10);
    this.scene.add(head, neck);

    // The summit spout: a chrome faucet, with a paper lantern marking the end of the trial.
    const g = level.goal;
    const spoutBase = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 7, 20), metal);
    spoutBase.position.set(29, 49.5, g.z);
    const spoutArm = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3.5, 16).rotateZ(Math.PI / 2), metal);
    spoutArm.position.set(27.4, 52.6, g.z);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffeec4 }));
    lantern.scale.y = 1.25;
    lantern.position.set(g.x, g.y + 0.6, g.z);
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.75, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc2452d, side: THREE.DoubleSide }));
    halo.position.set(g.x, 46.03, g.z);
    this.scene.add(spoutBase, spoutArm, lantern, halo);
  }

  /** The shinobi: limbs hang from pivots at the hip and shoulder. Facing -z at rest, feet at the origin. */
  private buildNinja(): THREE.Mesh {
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const dark = new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe6bd98, roughness: 0.7 });
    const seal = new THREE.MeshStandardMaterial({ color: 0xc2452d, roughness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xf1f5f8, roughness: 0.15, metalness: 0.2, emissive: 0x555a60 });

    part(new THREE.CylinderGeometry(0.17, 0.29, 0.62, 12), this.robe, 0, 0.96, 0, this.body);
    part(new THREE.CylinderGeometry(0.205, 0.175, 0.42, 12), this.robe, 0, 1.31, 0, this.body);
    part(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 12), seal, 0, 1.15, 0, this.body);
    part(new THREE.SphereGeometry(0.155, 16, 12), dark, 0, 1.62, 0, this.body);
    part(new THREE.BoxGeometry(0.2, 0.055, 0.04), skin, 0, 1.63, -0.14, this.body);
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16), seal, 0, 1.69, 0, this.body);

    // Headband tails stream out behind, the one part that shows speed from the camera's seat.
    this.tails.position.set(0, 1.69, 0.15);
    for (const side of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.5).translate(0, 0, 0.25), seal);
      tail.position.x = side * 0.035;
      tail.rotation.y = side * 0.14;
      this.tails.add(tail);
    }
    this.body.add(this.tails);

    for (const [leg, x] of [[this.legL, -0.13], [this.legR, 0.13]] as const) {
      leg.position.set(x, 0.74, 0);
      part(new THREE.BoxGeometry(0.15, 0.7, 0.16).translate(0, -0.33, 0), this.robe, 0, 0, 0, leg);
      part(new THREE.BoxGeometry(0.15, 0.07, 0.27), dark, 0, -0.7, -0.05, leg);
      this.body.add(leg);
    }
    for (const [arm, x] of [[this.armL, -0.25], [this.armR, 0.25]] as const) {
      arm.position.set(x, 1.47, 0);
      part(new THREE.BoxGeometry(0.11, 0.58, 0.12).translate(0, -0.27, 0), this.robe, 0, 0, 0, arm);
      part(new THREE.SphereGeometry(0.06, 10, 8), skin, 0, -0.58, 0, arm);
      this.body.add(arm);
    }

    // The katana sits in the right hand and points forward along the arm's swing.
    const katana = new THREE.Group();
    katana.position.set(0, -0.6, 0);
    katana.rotation.x = -Math.PI / 2 - 0.5;
    part(new THREE.BoxGeometry(0.034, 0.26, 0.04), dark, 0, 0.04, 0, katana);
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.016, 14), dark, 0, 0.18, 0, katana);
    part(new THREE.BoxGeometry(0.014, 1.0, 0.045).translate(0, 0.5, 0), steel, 0, 0.19, 0, katana);
    this.armR.add(katana);

    this.model.add(this.body);
    this.model.visible = false;
    this.scene.add(this.model);

    // The white sweep shows the blade's real reach: 100 degrees, out to the range of the cut.
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 3.4, 48, 1, Math.PI / 2 - 0.873, 1.746).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    arc.renderOrder = 11;
    this.slashRoot.add(arc);
    this.scene.add(this.slashRoot);
    return arc;
  }

  private resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    this.opaque.setSize(pw, ph);
    this.composite.setSize(pw, ph);
    this.dropMaterial.uniforms.uResolution.value.set(pw, ph);
    this.post.material.uniforms.uAspect.value = w / h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  handleEvent(e: GameEvent, game: TrialGame): void {
    switch (e.type) {
      case 'hit':
        this.hitFlash = 1;
        this.addSplash(e.x, e.y, e.z, 1.2);
        this.post.addDrop(0.2 + Math.random() * 0.6);
        break;
      case 'graze': {
        // Put the drop on the side of the lens the water passed.
        const n = game.ninja;
        const rightX = Math.cos(n.yaw);
        const rightZ = -Math.sin(n.yaw);
        const side = (e.x - n.pos.x) * rightX + (e.z - n.pos.z) * rightZ;
        this.post.addDrop(0.5 + Math.sign(side || 1) * (0.1 + Math.random() * 0.25));
        break;
      }
      case 'splash':
        this.addSplash(e.x, e.y, e.z, 0.7);
        break;
      case 'cleave':
      case 'parry':
      case 'pop':
        this.addSplash(e.x, e.y, e.z, 1);
        break;
      case 'land':
        this.dip = Math.max(this.dip, e.value * 0.28);
        break;
      case 'flood':
        this.hitFlash = 1;
        this.post.clearDrops();
        break;
      default:
        break;
    }
  }

  private addSplash(x: number, y: number, z: number, size: number): void {
    if (this.splashes.length > 14) return;
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.03, 6, 28).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, depthWrite: false }),
    );
    mesh.position.set(x, y, z);
    mesh.userData = { age: 0, size };
    this.scene.add(mesh);
    this.splashes.push(mesh);
  }

  render(realDt: number, game: TrialGame): void {
    const live = game.phase !== 'menu';
    this.time.value = game.time;
    for (const { mesh, box } of this.boxMeshes) {
      if (!box.motion) continue;
      mesh.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
    }

    this.updateDroplets(game);
    this.updateBeams(game);
    this.updateWetCells(game);
    this.updateBubbles(game);
    this.updateMist(game);
    this.updateSplashes(realDt);
    this.updateCamera(realDt, game, live);
    this.updateNinja(realDt, game, live);
    this.updateWire(game);

    this.post.update(realDt);
    this.hitFlash = Math.max(0, this.hitFlash - realDt * 2.2);
    const targetSteam = live && game.level.steamAt(game.ninja.eye) ? 1 : 0;
    this.steam += (targetSteam - this.steam) * (1 - Math.exp(-2.4 * realDt));
    this.blade += ((live && game.blade.active ? 1 : 0) - this.blade) * (1 - Math.exp(-12 * realDt));

    const u = this.post.material.uniforms;
    u.uSteam.value = this.steam;
    u.uBlade.value = this.blade;
    u.uHit.value = this.hitFlash;
    u.uSpeed.value = live ? Math.min(1, Math.max(0, game.ninja.speed - 9) / 16) : 0;

    const r = this.renderer;
    r.autoClear = true;
    r.setRenderTarget(this.opaque);
    r.render(this.scene, this.camera);
    r.setRenderTarget(this.composite);
    r.render(this.copyScene, this.ortho);
    r.autoClear = false;
    r.render(this.dropScene, this.camera);
    r.autoClear = true;
    this.post.render(r);
  }

  private updateDroplets(game: TrialGame): void {
    const dummy = this.dummy;
    const fade = this.droplets.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute;
    const shadowFade = this.shadows.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute;
    const list = game.droplets;
    const count = Math.min(list.length, MAX_DROPLETS);
    for (let i = 0; i < count; i++) {
      const d = list[i];
      const stretch = 1 + Math.min(0.5, Math.abs(d.vel.y) * 0.015);
      dummy.position.set(d.pos.x, d.pos.y, d.pos.z);
      dummy.quaternion.identity();
      dummy.scale.set(d.r / Math.sqrt(stretch), d.r * stretch, d.r / Math.sqrt(stretch));
      dummy.updateMatrix();
      this.droplets.setMatrixAt(i, dummy.matrix);
      fade.setX(i, 1);

      // The shadow tightens as the drop nears the surface it will hit.
      const height = Math.max(0, d.pos.y - d.landY);
      dummy.position.set(d.pos.x, d.landY + 0.03, d.pos.z);
      dummy.scale.setScalar(1.1 + Math.min(1.8, height * 0.13));
      dummy.updateMatrix();
      this.shadows.setMatrixAt(i, dummy.matrix);
      shadowFade.setX(i, Math.min(1, 1.25 - height * 0.05));
    }
    this.droplets.count = count;
    this.shadows.count = count;
    this.droplets.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    fade.needsUpdate = true;
    shadowFade.needsUpdate = true;

    const halfFadeAttr = this.halves.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute;
    const halves = game.halves;
    const halfCount = Math.min(halves.length, MAX_HALVES);
    for (let i = 0; i < halfCount; i++) {
      const h = halves[i];
      dummy.position.set(h.pos.x, h.pos.y, h.pos.z);
      // The dome points away from the flat cut, so the geometry's +y maps to minus the cut axis.
      dummy.quaternion.setFromUnitVectors(this.up, this.dir.set(-h.axis.x, -h.axis.y, -h.axis.z));
      dummy.scale.setScalar(h.r);
      dummy.updateMatrix();
      this.halves.setMatrixAt(i, dummy.matrix);
      halfFadeAttr.setX(i, halfFade(h));
    }
    this.halves.count = halfCount;
    this.halves.instanceMatrix.needsUpdate = true;
    halfFadeAttr.needsUpdate = true;

    // In blade time every droplet shows a white line along its future path.
    const showTrails = game.phase === 'playing' && game.blade.active;
    this.trails.visible = showTrails;
    if (showTrails) {
      const p = this.trailPositions;
      let w = 0;
      for (let i = 0; i < count; i++) {
        const d = list[i];
        let x = d.pos.x;
        let y = d.pos.y;
        let z = d.pos.z;
        let vy = d.vel.y;
        for (let s = 0; s < TRAIL_STEPS; s++) {
          const dt = 0.08;
          const nx = x + d.vel.x * dt;
          const nz = z + d.vel.z * dt;
          vy -= 22 * dt;
          const ny = Math.max(d.landY, y + vy * dt);
          p.setXYZ(w++, x, y, z);
          p.setXYZ(w++, nx, ny, nz);
          x = nx;
          y = ny;
          z = nz;
        }
      }
      this.trails.geometry.setDrawRange(0, w);
      p.needsUpdate = true;
    }
  }

  private updateBeams(game: TrialGame): void {
    let n = 0;
    for (const s of game.streams) {
      const length = Math.min(s.length, s.blockedAt);
      if (!s.on || length <= 0.01) continue;
      this.dummy.position.set(s.spec.origin.x, s.spec.origin.y, s.spec.origin.z);
      this.dummy.quaternion.setFromUnitVectors(this.up, this.dir.set(s.dir.x, s.dir.y, s.dir.z));
      this.dummy.scale.set(s.spec.radius, length, s.spec.radius);
      this.dummy.updateMatrix();
      this.beams.setMatrixAt(n, this.dummy.matrix);
      this.beamLength.setX(n, length);
      n++;
    }
    this.beams.count = n;
    this.beams.instanceMatrix.needsUpdate = true;
    this.beamLength.needsUpdate = true;
  }

  private updateWetCells(game: TrialGame): void {
    let n = 0;
    const dummy = this.dummy;
    for (const c of game.grid.cells.values()) {
      if (n >= MAX_WET) break;
      const off = 0.015 * c.sign;
      dummy.position.set(c.x + (c.axis === 0 ? off : 0), c.y + (c.axis === 1 ? off : 0), c.z + (c.axis === 2 ? off : 0));
      dummy.rotation.set(c.axis === 1 ? -Math.PI / 2 : 0, c.axis === 0 ? Math.PI / 2 : 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.wetCells.setMatrixAt(n++, dummy.matrix);
    }
    dummy.rotation.set(0, 0, 0);
    this.wetCells.count = n;
    this.wetCells.instanceMatrix.needsUpdate = true;
  }

  private updateBubbles(game: TrialGame): void {
    game.bouncers.forEach((b, i) => {
      const mesh = this.bubbleMeshes[i];
      mesh.visible = b.gone <= 0;
      mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
      const s = b.squash;
      mesh.scale.set(1 + s * 0.28, 1 - s * 0.36, 1 + s * 0.28);
    });
  }

  private updateMist(game: TrialGame): void {
    const count = Math.min(game.mist.length, MAX_MIST);
    for (let i = 0; i < count; i++) {
      const m = game.mist[i].pos;
      this.mistPositions.setXYZ(i, m.x, m.y, m.z);
    }
    this.mist.geometry.setDrawRange(0, count);
    this.mistPositions.needsUpdate = true;
  }

  private updateSplashes(dt: number): void {
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      const data = s.userData as { age: number; size: number };
      data.age += dt;
      const t = data.age / 0.34;
      if (t >= 1) {
        this.scene.remove(s);
        s.geometry.dispose();
        (s.material as THREE.Material).dispose();
        this.splashes.splice(i, 1);
        continue;
      }
      const r = data.size * (0.2 + t);
      s.scale.set(r, 1, r);
      (s.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
  }

  private updateCamera(dt: number, game: TrialGame, live: boolean): void {
    const cam = this.camera;
    if (!live) {
      // On the menu, a slow look across the course from above the first ledge.
      this.menuTime += dt;
      cam.position.set(-27, 9, 27.5);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(0.3 + Math.sin(this.menuTime * 0.13) * 0.03, -1.0 + Math.sin(this.menuTime * 0.09) * 0.1, 0);
      cam.fov = 66;
      cam.updateProjectionMatrix();
      return;
    }
    const n = game.ninja;
    this.dip = Math.max(0, this.dip - dt * 1.3);
    // Orbit a point above the head, directly along the look ray, so the crosshair still shows where you aim.
    const eye = n.eye;
    const headY = eye.y + CAMERA_LIFT - this.dip;
    this.pivotY = this.pivotReady ? this.pivotY + (headY - this.pivotY) * (1 - Math.exp(-16 * dt)) : headY;
    this.pivotReady = true;
    const pivot = { x: eye.x, y: this.pivotY, z: eye.z };
    const c = Math.cos(n.pitch);
    const back = { x: Math.sin(n.yaw) * c, y: -Math.sin(n.pitch), z: Math.cos(n.yaw) * c };
    const hit = raycast(game.level, pivot, back, CAMERA_DISTANCE + CAMERA_MARGIN);
    const room = hit ? Math.max(CAMERA_MIN, hit.t - CAMERA_MARGIN) : CAMERA_DISTANCE;
    // Walls pull the camera in at once, and it eases back out when they clear.
    this.cameraDistance = room < this.cameraDistance ? room : this.cameraDistance + (room - this.cameraDistance) * (1 - Math.exp(-5 * dt));
    cam.position.set(
      pivot.x + back.x * this.cameraDistance,
      Math.max(0.3, pivot.y + back.y * this.cameraDistance),
      pivot.z + back.z * this.cameraDistance,
    );
    const targetRoll = n.state === 'wallrun' ? -n.wallSide * 0.09 : 0;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-9 * dt));
    cam.rotation.order = 'YXZ';
    cam.rotation.set(n.pitch, n.yaw, this.reducedMotion ? 0 : this.roll);
    const fov = BASE_FOV + (this.reducedMotion ? 0 : Math.min(16, Math.max(0, n.speed - 9) * 0.7));
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-8 * dt));
    cam.updateProjectionMatrix();
  }

  private updateNinja(dt: number, game: TrialGame, live: boolean): void {
    this.model.visible = live;
    this.slashRoot.visible = live;
    if (!live) {
      this.pivotReady = false;
      return;
    }
    const n = game.ninja;
    const k = game.katana;
    const t = k.swinging ? k.progress : 0;

    // Face where you're going, and turn to the crosshair to cut or stand.
    const moving = n.speed > 1.5 && !k.swinging;
    const target = moving ? Math.atan2(-n.vel.x, -n.vel.z) : n.yaw;
    const delta = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
    this.heading += delta * (1 - Math.exp(-(k.swinging ? 40 : 13) * dt));
    this.model.position.set(n.pos.x, n.pos.y, n.pos.z);
    this.model.rotation.y = this.heading;

    this.stride += n.speed * dt * 1.5;
    const run = n.grounded ? Math.min(1, n.speed / 7) : 0;
    const swing = Math.sin(this.stride);
    let legL = swing * 0.95 * run;
    let legR = -swing * 0.95 * run;
    let armL = -swing * 0.7 * run;
    let armR = swing * 0.3 * run + 0.5;
    let armRSide = 0;
    let lean = Math.min(0.28, n.speed * 0.028);
    let tilt = 0;
    let drop = 0;

    if (n.state === 'slide') {
      // Knee-slide: leaning back with the front leg out, low enough to fit the 0.9 m hitbox.
      lean = -1.05;
      drop = 0.2;
      legL = 1.25;
      legR = 0.35;
      armL = 0.6;
      armR = 0.8;
    } else if (n.state === 'wallrun') {
      tilt = -n.wallSide * 0.55;
      legL = swing * 1.1;
      legR = -swing * 1.1;
      armL = -swing * 0.8;
    } else if (n.state === 'dash') {
      lean = 1.0;
      legL = -0.9;
      legR = -1.15;
      armL = -1.1;
      armR = 1.5;
    } else if (n.state === 'grind') {
      lean = 0.12;
      legL = 0.45;
      legR = -0.45;
      armL = 0.25;
      armRSide = 0.9;
    } else if (!n.grounded) {
      legL = 0.8;
      legR = -0.35;
      armL = -0.5;
      armR = 0.8;
    }
    if (n.wire.attached) armL = Math.PI - 0.15;
    if (k.swinging) {
      // A flat cut across the body, in whichever direction this swing runs.
      armR = 1.5;
      armRSide = (t - 0.5) * 2.6 * k.side;
    }

    const blend = 1 - Math.exp(-18 * dt);
    const ease = (from: number, to: number) => from + (to - from) * blend;
    this.legL.rotation.x = ease(this.legL.rotation.x, legL);
    this.legR.rotation.x = ease(this.legR.rotation.x, legR);
    this.armL.rotation.x = ease(this.armL.rotation.x, armL);
    this.armR.rotation.x = k.swinging ? armR : ease(this.armR.rotation.x, armR);
    this.armR.rotation.y = k.swinging ? armRSide : ease(this.armR.rotation.y, armRSide);
    this.body.rotation.x = ease(this.body.rotation.x, -lean);
    this.body.rotation.z = ease(this.body.rotation.z, tilt);
    this.body.position.y = ease(this.body.position.y, -drop);
    this.tails.rotation.x = -Math.min(0.2, n.speed * 0.02) + Math.sin(this.time.value * 13) * 0.08;

    // The robe darkens as it soaks, and flickers while protected after a hit.
    this.robe.color.copy(ROBE_SOAKED).lerp(ROBE_DRY, game.dryness / 100);
    const flicker = n.iframes > 0 && n.state !== 'dash' && Math.floor(this.time.value * 40) % 2 === 0;
    this.model.visible = this.cameraDistance > HIDE_MODEL_BELOW && !flicker;

    const center = n.center;
    this.slashRoot.position.set(center.x, center.y + 0.3, center.z);
    this.slashRoot.rotation.order = 'YXZ';
    this.slashRoot.rotation.set(n.pitch, n.yaw, 0);
    const mat = this.arc.material as THREE.MeshBasicMaterial;
    mat.opacity = k.swinging ? Math.sin(t * Math.PI) * 0.5 : Math.max(0, mat.opacity - dt * 7);
    this.arc.visible = mat.opacity > 0.01;
  }

  private updateWire(game: TrialGame): void {
    const a = game.ninja.wire.anchor;
    this.wire.visible = a !== null;
    if (!a) return;
    const from = game.ninja.eye;
    from.y += 0.1;
    const dx = a.x - from.x;
    const dy = a.y - from.y;
    const dz = a.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.wire.position.set(from.x, from.y, from.z);
    this.wire.scale.y = l;
    this.wire.quaternion.setFromUnitVectors(this.up, this.dir.set(dx / l, dy / l, dz / l));
  }
}
