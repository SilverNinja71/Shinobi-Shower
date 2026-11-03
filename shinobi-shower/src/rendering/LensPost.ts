import * as THREE from 'three';

export const MAX_LENS_DROPS = 6;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform float uAspect;
  uniform float uNear;
  uniform float uFar;
  uniform float uSteam;
  uniform float uBlade;
  uniform float uHit;
  uniform float uSpeed;
  uniform vec4 uDrops[${MAX_LENS_DROPS}];
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    float cover = 0.0;
    vec2 offset = vec2(0.0);
    for (int i = 0; i < ${MAX_LENS_DROPS}; i++) {
      vec4 d = uDrops[i];
      if (d.w <= 0.0) continue;
      vec2 p = (uv - d.xy) * vec2(uAspect, 1.0);
      // A rounded head with a tapering tail running up behind it.
      float wide = d.z * (p.y > 0.0 ? max(0.12, 1.0 - p.y / (d.z * 3.2)) : 1.0);
      float q = length(vec2(p.x / max(wide, 0.001), min(p.y, 0.0) / d.z + max(p.y / (d.z * 3.2), 0.0) * 0.9));
      float m = smoothstep(1.0, 0.82, q) * d.w;
      offset += -normalize(p + 0.0001) * q * d.z * 1.6 * m;
      cover = max(cover, m);
    }
    vec2 centered = uv - 0.5;
    float radial = dot(centered, centered);
    // Speed pulls the picture slightly outward.
    vec2 st = uv + offset - centered * radial * uSpeed * 0.07;

    vec3 col = texture2D(tScene, st).rgb;
    if (uBlade > 0.01) {
      float s = uBlade * 0.0035 * (0.2 + radial * 4.0);
      col.r = texture2D(tScene, st + centered * s).r;
      col.b = texture2D(tScene, st - centered * s).b;
    }

    // Depth-based haze, with a thick wall of it in the steam zones.
    float z = texture2D(tDepth, st).r * 2.0 - 1.0;
    float linear = 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
    float haze = 1.0 - exp(-linear * (0.006 + uSteam * 0.085));
    col = mix(col, vec3(0.88, 0.95, 0.92), haze);

    // Blade time drains the colour from everything but keeps water bright.
    float gray = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(gray) * vec3(0.92, 0.98, 1.04), uBlade * 0.72);
    col *= 1.0 - uBlade * smoothstep(0.1, 0.5, radial) * 0.55;

    col = mix(col, vec3(0.1, 0.26, 0.42), uHit * smoothstep(0.05, 0.5, radial) * 0.75);
    col += cover * 0.05;
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface LensDrop {
  x: number;
  y: number;
  size: number;
  age: number;
  life: number;
  speed: number;
}

/** The last pass: drops on the camera lens, steam, blade-time grading. */
export class LensPost {
  readonly material: THREE.ShaderMaterial;
  private readonly drops: LensDrop[] = [];
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(near: number, far: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        uAspect: { value: 1 },
        uNear: { value: near },
        uFar: { value: far },
        uSteam: { value: 0 },
        uBlade: { value: 0 },
        uHit: { value: 0 },
        uSpeed: { value: 0 },
        uDrops: { value: Array.from({ length: MAX_LENS_DROPS }, () => new THREE.Vector4()) },
      },
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** A graze runs a drop down the lens, near the side the water passed. */
  addDrop(xHint: number): void {
    if (this.drops.length >= MAX_LENS_DROPS) this.drops.shift();
    this.drops.push({
      x: Math.max(0.1, Math.min(0.9, xHint)),
      y: 0.7 + Math.random() * 0.25,
      size: 0.022 + Math.random() * 0.02,
      age: 0,
      life: 2.6 + Math.random(),
      speed: 0.07 + Math.random() * 0.1,
    });
  }

  clearDrops(): void {
    this.drops.length = 0;
  }

  update(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.y -= d.speed * dt * (1 + d.age * 0.6);
      d.x += Math.sin(d.age * 3 + d.size * 400) * 0.006 * dt;
      if (d.age > d.life || d.y < -0.1) this.drops.splice(i, 1);
    }
    const u = this.material.uniforms.uDrops.value as THREE.Vector4[];
    for (let i = 0; i < MAX_LENS_DROPS; i++) {
      const d = this.drops[i];
      if (d) u[i].set(d.x, d.y, d.size, Math.min(1, (d.life - d.age) * 2));
      else u[i].set(0, 0, 0, 0);
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
