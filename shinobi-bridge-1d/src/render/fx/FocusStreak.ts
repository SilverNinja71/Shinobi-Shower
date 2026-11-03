import * as THREE from 'three';
import fragmentShader from '../../shaders/ParticleFocus.frag';
import vertexShader from '../../shaders/ParticleFocus.vert';

/** Height of the focus cut's line above the warrior's feet (m): chest height, where the blade runs flat. */
export const FOCUS_LIFT = 1.5;
/** Depth of the line (m): just past the deck's near edge, so it crosses in front of the warrior. */
export const FOCUS_Z = 1.0;
/** How long the streak shows (s). */
const LIFE = 0.8;
/** Height of the quad (m): room for the glows either side of the line. */
const THICKNESS = 1.8;

const { smoothstep } = THREE.MathUtils;

/**
 * The focus cut's stroke across the whole sky: a quad at the cut's height, stretched every frame to
 * the full width of the view at its depth, drawn additively over everything (ParticleFocus.frag).
 * PostFX projects the same line (FOCUS_LIFT, FOCUS_Z) to split the frame along it. One draw call
 * while it shows.
 */
export class FocusStreak {
  readonly mesh: THREE.Mesh;
  private readonly u = {
    uAge: { value: 0 },
    uDir: { value: 1 },
    uOrigin: { value: 0.5 },
    uSize: { value: new THREE.Vector2(1, THICKNESS) },
    uFade: { value: 1 },
  };
  private age = Infinity;
  /** World x of the blade when it cut, and the line's world height. */
  private originX = 0;
  private y = 0;

  constructor() {
    const material = new THREE.ShaderMaterial({
      name: 'FocusStreak',
      uniforms: this.u,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.name = 'vfx-focus-streak';
    this.mesh.frustumCulled = false;
    // Over every other transparent thing in the scene.
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
  }

  get active(): boolean {
    return this.age < LIFE;
  }

  /** Starts a stroke from the blade at world (x, y), running toward `dir` (±1) on screen. */
  fire(x: number, y: number, dir: number): void {
    this.age = 0;
    this.originX = x;
    this.y = y;
    this.u.uDir.value = dir >= 0 ? 1 : -1;
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    if (!this.active) {
      this.mesh.visible = false;
      return;
    }
    this.age += dt;
    // Span the whole view at the line's depth, wherever the camera has moved or shaken to.
    const dist = Math.max(1, camera.position.z - FOCUS_Z);
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfW = halfH * camera.aspect * 1.1;
    const left = camera.position.x - halfW;
    this.mesh.position.set(camera.position.x, this.y, FOCUS_Z);
    this.mesh.scale.set(halfW * 2, THICKNESS, 1);
    const u = this.u;
    u.uSize.value.set(halfW * 2, THICKNESS);
    u.uOrigin.value = (this.originX - left) / (halfW * 2);
    u.uAge.value = this.age;
    u.uFade.value = 1 - smoothstep(this.age, LIFE * 0.55, LIFE);
    this.mesh.visible = this.active;
  }
}
