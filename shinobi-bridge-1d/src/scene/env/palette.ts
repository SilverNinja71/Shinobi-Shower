import * as THREE from 'three';

/**
 * The environment's colours, in linear scene-referred units. ACES Filmic crushes the darkest tones,
 * so the sky values here are the inputs that land on the art direction's display colours after tone
 * mapping (#05070c at the zenith, #141b26 at the horizon), worked out by inverting the curve.
 * The sky dome, scene.fog and the aerial perspective on the far ranges all read from here, so
 * distant geometry fades into exactly the colour of the sky behind it.
 */
const linear = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export const PALETTE = {
  zenith: linear(0.0074, 0.0092, 0.0135),
  horizon: linear(0.0193, 0.026, 0.0384),
  /** Fog and haze: the horizon colour, a touch greyer so mist does not turn blue. */
  haze: linear(0.0205, 0.0262, 0.0362),
  /** Cloud bodies: blue-black, darker than the sky between them (they are backlit). */
  cloud: linear(0.0036, 0.0046, 0.0068),
  /** Moonlit cloud undersides and edges. */
  cloudLit: linear(0.05, 0.062, 0.088),
  moon: new THREE.Color(0xc8d6ff),
  lightning: new THREE.Color(0xdfe8ff),
  /** Gorge fog: the haze, lifted a little so the banks read against the dark depths. */
  gorgeFog: linear(0.025, 0.031, 0.043),
};

/**
 * Draw order of the environment's opaque parts. Everything else in the scene draws first (order 0)
 * and hides some of it; then the nearest rock, then what lies behind it, and the sky and sea last,
 * at the far plane, so their shaders only run on pixels nothing else covered. The sea goes after
 * the sky, so it owns everything below the horizon.
 */
export const RENDER_ORDER = { slabs: 1, core: 2, peaks: 3, sky: 9, sea: 10 };

/**
 * Where the moon hangs: upper left and behind the bridge, low enough to sit in frame, so the
 * warrior is rim-lit and wet surfaces facing the camera catch its glint.
 */
export const MOON_DIR = new THREE.Vector3(-0.4, 0.24, -0.885).normalize();
/**
 * The moonlight itself comes from higher and further left than the disc (a cinematic key-light
 * cheat): from behind and above it still rims the warrior, but it is steep enough that the
 * shadows of the ropes and the warrior land on the 1.6 m deck instead of falling off its edge.
 */
export const MOON_LIGHT_DIR = new THREE.Vector3(-0.45, 0.72, -0.53).normalize();
