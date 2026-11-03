import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform float uTime;
  uniform float uSteam;
  uniform float uAspect;
  uniform float uHit;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // One grid layer of drops running down glass. xy is a refraction offset, z clears fog along the trail.
  vec3 glass(vec2 uv, float size, float t) {
    vec2 aspect = vec2(2.0, 1.0);
    vec2 g = uv * size * aspect;
    g.y += t * 0.22;
    vec2 cell = floor(g);
    vec2 gv = fract(g) - 0.5;
    float n = hash(cell);
    if (n < 0.45) return vec3(0.0);
    float phase = t * (0.7 + n) + n * 6.283;
    float wiggle = (n - 0.5) * 0.6 + sin(uv.y * 34.0 + n * 40.0) * 0.06;
    float y = -sin(phase + sin(phase + sin(phase) * 0.5) * 0.5) * 0.42;
    vec2 pos = (gv - vec2(wiggle, y)) / aspect;
    float drop = smoothstep(0.075, 0.035, length(pos));
    vec2 trailPos = (gv - vec2(wiggle, 0.0)) / aspect;
    float trail = smoothstep(0.035, 0.01, abs(trailPos.x)) * smoothstep(y - 0.02, y + 0.5, gv.y) * smoothstep(0.5, 0.2, gv.y);
    return vec3(pos * drop * 7.0, max(drop, trail * 0.75));
  }

  void main() {
    vec2 uv = vUv;
    vec2 centered = (uv - 0.5) * vec2(min(uAspect, 1.5) / 1.5 + 0.35, 1.0);
    // Fog creeps in from the perimeter, and the middle of the play area stays readable.
    float perimeter = smoothstep(0.26, 0.74, length(centered) * 1.12);
    float fogAmount = clamp(uSteam * (0.08 + perimeter * 1.15), 0.0, 0.9);

    vec3 big = glass(uv * vec2(uAspect, 1.0), 4.0, uTime);
    vec3 small = glass(uv * vec2(uAspect, 1.0) + 1.7, 8.5, uTime * 1.2);
    float glassMask = smoothstep(0.08, 0.5, perimeter * (0.25 + uSteam * 1.2));
    vec2 offset = (big.xy + small.xy * 0.6) * glassMask;
    float cleared = clamp(big.z + small.z * 0.7, 0.0, 1.0) * glassMask;
    fogAmount *= 1.0 - cleared * 0.6;

    vec2 st = uv + offset * 0.05;
    vec3 sharp = texture2D(tScene, st).rgb;
    vec3 soft = sharp * 0.2;
    float spread = 0.012 * fogAmount;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981;
      soft += texture2D(tScene, st + vec2(cos(a), sin(a) * uAspect) * spread).rgb * 0.1;
    }
    vec3 col = mix(sharp, soft, smoothstep(0.12, 0.45, fogAmount));

    vec3 steamTint = vec3(0.96, 0.88, 0.88);
    col = mix(col, steamTint, fogAmount * 0.82);
    col += cleared * glassMask * 0.1;

    // A crushing hit flashes the edges a cold blue.
    col = mix(col, vec3(0.08, 0.22, 0.42), uHit * perimeter * 0.7);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Renders the scene to a texture, then draws it through fogged-up glass with drops running down it. */
export class ScreenSteamPostProcess {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.UnsignedByteType });
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uTime: { value: 0 },
        uSteam: { value: 0 },
        uAspect: { value: 1 },
        uHit: { value: 0 },
      },
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.uAspect.value = width / Math.max(1, height);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number, steam: number, hit: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uSteam.value = steam;
    u.uHit.value = hit;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
