// Renders the rigged Quaternius ninja into a sprite sheet. Run with tools/bake/serve.mjs, then open the page.
import * as THREE from 'three';
import { bathroomEnvironment } from './Materials.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadNinjaRig } from './NinjaRig.ts';

const CELL = 192;
const VIEW = 3.4; // World metres across a cell.

/** Animation name, clip, frame count, and the share of the clip to use. */
const STRIPS: [string, string, number, number, number][] = [
  ['idle', 'swordIdle', 6, 0, 1],
  ['run', 'sprint', 8, 0, 1],
  ['air', 'NinjaJump_Idle_Loop', 4, 0, 1],
  ['slide', 'Slide_Loop', 4, 0, 1],
  ['dash', 'Sword_Dash', 4, 0.15, 0.6],
  ['cutA', 'Sword_Regular_A', 6, 0.05, 0.6],
  ['cutB', 'Sword_Regular_B', 6, 0.05, 0.6],
  ['hurt', 'Hit_Knockback', 4, 0, 0.7],
  ['wire', 'NinjaJump_Idle_Loop', 2, 0, 0.5],
];

async function bake(): Promise<void> {
  THREE.ColorManagement.enabled = true;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(CELL * 2, CELL * 2);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.environment = bathroomEnvironment(renderer);
  const key = new THREE.DirectionalLight(0xfff1dd, 2.6);
  key.position.set(1, 3, 3);
  const rim = new THREE.DirectionalLight(0xa8e6ff, 3.2);
  rim.position.set(-3, 1.5, -2.5);
  scene.add(key, rim, new THREE.AmbientLight(0xbfd8e8, 0.5));

  const rig = await loadNinjaRig();
  scene.add(rig.root);
  // Faces screen right, turned a little toward the viewer so the model keeps its depth.
  rig.root.rotation.y = -Math.PI / 2 + 0.3;

  const half = VIEW / 2;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 30);
  camera.position.set(0, half - 0.45, 10);
  camera.lookAt(0, half - 0.45, 0);

  await new Promise((r) => setTimeout(r, 2500)); // Textures load in the background.

  const count = STRIPS.reduce((n, s) => n + s[2], 0);
  const columns = 8;
  const rows = Math.ceil(count / columns);
  const sheet = document.createElement('canvas');
  sheet.width = CELL * columns;
  sheet.height = CELL * rows;
  const ctx = sheet.getContext('2d')!;
  const atlas: Record<string, { start: number; count: number }> = {};
  let index = 0;
  for (const [name, clipName, frames, from, to] of STRIPS) {
    atlas[name] = { start: index, count: frames };
    const clip = rig.clips.get(clipName)!;
    for (let f = 0; f < frames; f++) {
      const u = from + ((to - from) * f) / frames;
      rig.pose(clipName, clip.duration * u);
      if (name === 'wire') rig.reach();
      renderer.render(scene, camera);
      const x = (index % columns) * CELL;
      const y = Math.floor(index / columns) * CELL;
      ctx.drawImage(renderer.domElement, x, y, CELL, CELL);
      index++;
    }
  }
  await fetch('/save/ninja.png', { method: 'POST', body: await new Promise<Blob>((r) => sheet.toBlob((b) => r(b!), 'image/png')) });
  await fetch('/save/ninja.json', {
    method: 'POST',
    body: JSON.stringify({ cell: CELL, columns, metresPerCell: VIEW, feetFromBottom: 0.45 / VIEW, strips: atlas }),
  });
  await bakeProps(renderer, scene);
  document.title = 'baked';
  document.body.append(sheet);
  sheet.style.cssText = 'width:100%;background:#7a8';
}

/** Damp-corner plants and rocks from the nature pack, each rendered from the side. */
async function bakeProps(renderer: THREE.WebGLRenderer, base: THREE.Scene): Promise<void> {
  const PROP = 256;
  const names = ['Fern_1', 'Grass_Common_Tall', 'Flower_3_Group', 'Flower_4_Group', 'Rock_Medium_1', 'Rock_Medium_2'];
  const files: Record<string, string> = { Leaves: 'n_leaves.png', Grass: 'n_grass.png', Flowers: 'n_flowers.png', Rocks: 'n_rocks.jpg' };
  const gltf = await new GLTFLoader().loadAsync('assets/world/nature.glb');
  const loader = new THREE.TextureLoader();
  const maps = new Map<string, THREE.MeshStandardMaterial>();
  for (const [name, file] of Object.entries(files)) {
    const map = await loader.loadAsync('assets/world/' + file);
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = false;
    maps.set(name, new THREE.MeshStandardMaterial({ map, roughness: 0.8, alphaTest: file.endsWith('png') ? 0.4 : 0, side: THREE.DoubleSide }));
  }
  const sheet = document.createElement('canvas');
  sheet.width = PROP * names.length;
  sheet.height = PROP;
  const ctx = sheet.getContext('2d')!;
  const scene = new THREE.Scene();
  scene.environment = base.environment;
  scene.add(new THREE.DirectionalLight(0xfff1dd, 2.4), new THREE.AmbientLight(0xbfe0d8, 0.7));
  const sizes: number[][] = [];
  names.forEach((name, i) => {
    const obj = gltf.scene.getObjectByName(name)!.clone();
    obj.position.set(0, 0, 0);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = maps.get((m.material as THREE.Material).name) ?? m.material;
    });
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y) * 1.04;
    const cx = (box.min.x + box.max.x) / 2;
    const camera = new THREE.OrthographicCamera(cx - span / 2, cx + span / 2, box.min.y + span, box.min.y, -50, 50);
    camera.position.set(0, 0, 10);
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, PROP * i, 0, PROP, PROP);
    sizes.push([size.x / span, size.y / span]);
    scene.remove(obj);
  });
  await fetch('/save/props.png', { method: 'POST', body: await new Promise<Blob>((r) => sheet.toBlob((b) => r(b!), 'image/png')) });
}

bake().catch((e) => {
  document.title = 'failed: ' + e;
  console.error(e);
});
