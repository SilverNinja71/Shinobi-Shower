# Rendering contract and art direction

This is the brief every rendering module is built against. The simulation (`src/core`, `src/scene/SuspensionBridge.ts`,
`src/scene/SnowAccumulator.ts`, `src/weather/DynamicStormSystem.ts`, `src/weather/PrecipitationDroplet.ts`,
`src/warrior/WarriorController.ts`, `src/warrior/KatanaSlash.ts`, `src/progression/*`) is finished and tested.
Renderers **read** it and never change it.

## Files that are fixed (do not edit; ask for changes in your report)

- `src/core/*` (Game, Input, Save, Rng), `src/main.ts`
- `src/render/RenderContext.ts`, `src/render/Assets.ts`, `src/render/GameRenderer.ts`, `src/shaders/WetSurfacePBR.frag`
- every simulation file listed above, and `test/*`

## Module interface

Each module is a class constructed once with the `RenderContext` and called every rendered frame:

```ts
class X implements RenderModule {
  constructor(ctx: RenderContext)
  update(dt: number, game: Game): void          // after the simulation step(s) for this frame
  handleEvent?(e: GameEvent, game: Game): void  // every simulation event, before update
}
```

`GameRenderer` builds them in this order and updates them in the same order:
`MountainPeakScene` → `BridgeRenderer` → `CosmeticsRenderer` → `StormRenderer` → `VFX` → `PostFX`.
`PostFX.update` draws the frame (it also has `resize(width, height, pixelRatio)`).

`ctx` gives: `renderer`, `scene`, `camera` (moved by GameRenderer before modules update), `assets`
(`assets.tex[stem]`, `assets.pbr(name, repeatX, repeatY)`, `assets.character`), `uniforms` (shared uniform objects,
see `RenderContext.ts`; put them by reference into your materials), and `quality` (`'high' | 'low'`).

`makeWetMaterial(params, ctx.uniforms)` (in `Assets.ts`) gives a `MeshStandardMaterial` that darkens and glosses with
`uWetness`, gathers puddles with rain ripples on upward faces, and runs rivulets down steep ones. Its `triplanar`
option maps a PBR set in world space for meshes without good UVs.

## Coordinates

- Lane x runs from 0 (west anchor) to 36 (east anchor). **World x = lane x − 18**, so the bridge is centred on the origin.
  Use `worldX()` from `RenderContext.ts`.
- y is world up. The deck is at y = 0 at both anchors and sags to y ≈ −1.6 mid-span (plus sway, ~0.2 m under the warrior).
- z points toward the camera. The deck spans z ∈ [−0.8, 0.8]. Gameplay drops carry a cosmetic `z` in that range.
- `placeOnDeck(obj, game, laneX, lift, z)` puts an object on the deck with the bridge's sag, sway, pitch and roll.
- The camera sits at z ≈ 18–40 (wider screens are closer), vertical FOV 36°, looking slightly up at the warrior. It frames
  about 11 m of lane either side. Drops spawn at y = 15.

## What the simulation exposes

- `game.warrior`: `x, vx, facing (±1), rolling, dashT, dashDir, kicking, kickT, stun, stride, stamina, snowSlow, topSpeed`
- `game.katana`: `phase ('idle'|'startup'|'active'|'wake'|'recovery'), t, sweep (0–1), cooldown, cooldownLength, facing,
  ready, exposed, swing`; `arcs(x, feetY, stance)` gives the exact cutting boxes; `reach(stance)`
- `game.stance`: `tier (1–5), dual, aura, flame, triple, focus, arcMul, speedMul, cooldown`
- `game.feetY`, `game.shieldUp`, `game.vulnerable`, `game.exposed`, `game.focusReady`, `game.dryness`, `game.combo`
- `game.bridge`: `planks[] {index, x, health (0–4), broken, brokenAge}`, `deckY(x)`, `restY(x)`, `slope(x)`, `pitch(x)`,
  `rollAt(x)`, `lateral(x)`, `energy`
- `game.snow`: `depth` (Float32Array, one cell per 0.15 m of lane), `cells`, `open`, `version` (bumps on change), `depthAt(x)`
- `game.storm`: `drops[] {kind, x, y, vx, vy, r, z, phase, age}`, `curtains[] {center, speed, width, flux, age, life}`,
  `wind`, `rainDir`, `rainAngle`, `rainSpeed`, `mist`, `rainVelocity()`
- `game.waves`: `wave, t (negative in the lull), duration, weights {drizzle, rain, snow, hail}, intensity, frontNow, title`
- `game.levels`, `game.stats`, `game.time`, `game.phase`
- Events: the `GameEvent` union in `src/core/Game.ts`.

## Art direction

**Hyper-real dark fantasy, cinematic.** A rotting rope bridge strung between two jagged peaks of wet black slate, at
night, in a storm, above a gorge so deep it ends in fog, with a storm sea far below and snow-capped ranges on the
horizon that only show when lightning lights them.

- **Palette.** Sky blue-black (#05070c at the zenith, #141b26 at the horizon). Moonlight cold (#c8d6ff). Slate is
  blue-black and glossy when wet. Wood is grey-brown, weathered, splintered. The only warm light is the lanterns on the
  anchor posts (#ff9a4a). Accents: lightning (#dfe8ff), spirit (#a77bff), flame (#ff5a1f to #ffb347), crimson
  lightning (#ff1f3d), crimson cape (#7a0d14).
- **Readability first.** The warrior, every gameplay drop and every hail telegraph must read against the background at a
  glance. Use rim light (the moon sits behind and above the scene, slightly toward the camera), contrast, and brighter
  gameplay rain than cosmetic rain.
- **Lighting ownership.** MountainPeakScene owns the moon (shadow-casting DirectionalLight), the hemisphere fill, the
  lightning light, `scene.fog`, `scene.background` and `scene.environment` (a PMREM storm sky for reflections), and
  writes `uniforms.uLightning`. BridgeRenderer owns the two lantern PointLights. CosmeticsRenderer may add one blade
  light (flame or crimson tiers only). No one else adds lights.
- **Tone mapping** is ACES Filmic at exposure 1.0 (set by GameRenderer; PostFX's OutputPass applies it).
- **Custom ShaderMaterials** in the scene should respect fog (`fog: true` with the fog chunks) or fade with distance
  themselves.

## Performance

Target 60 fps at 1080p on a mid-range laptop GPU. Draw-call budgets: environment ≤ 40, bridge ≤ 25, warrior ≤ 40,
storm ≤ 12, VFX ≤ 10, post ≤ 4 passes plus bloom. Prefer `InstancedMesh` and GPU-animated geometry. No per-frame
allocations in hot loops. On `quality === 'low'` (phones), cut particle counts and shadow resolution roughly in half.

Headless Chromium here renders with SwiftShader (software WebGL2). Expect 10–30 fps there; that is not a bug, but if your
module alone drops it sharply, it is too heavy.

## Seeing your work

```bash
ln -s /home/user/Shinobi-Shower/shinobi-bridge-1d/node_modules node_modules   # in a worktree, once
PORT=52xx npm run dev                                                          # your assigned port
PORT=52xx node tools/shot.cjs out.png "autostart=1&level=40&wave=9&t=20&simtime=3&invincible=1" 6000
```

Debug query parameters (dev builds): `autostart=1`, `level=N`, `wave=N`, `t=S` (seconds into that wave),
`simtime=S` (run the simulation S seconds before showing), `seed=N`, `x=laneX`, `freeze=1` (stop the simulation;
rendering continues), `invincible=1`. In the page, `window.bridgeDebug` has `game`, `view` (the GameRenderer),
`fps`, `setLevel(n)`, `jumpWave(w, t)`, `advance(s)`, `freeze(on)`, `spawn(kind, x, y, r)`. To fire an event by hand:
`bridgeDebug.game.events.push({ type: 'lightning', x: 10, power: 1 })`.
