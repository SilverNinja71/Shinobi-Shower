# Dropout: Shower Evasion Simulator

A small bar of soap against a running shower, built with TypeScript and Three.js.

```bash
npm install
npm run dev        # http://localhost:5199
npm test           # headless physics, hazard and balance tests
npm run typecheck
npm run build      # writes dist/index.html
```

## Layout

- `src/core`: `GameLoop` (states, shower cycles, scoring, hit rules), `MoistureMeter`, `Input`
- `src/player`: `PlayerController` (momentum, drift, hop, dash, coyote time), `FloorInteraction` (tile grid and friction)
- `src/hazards`: `DropletSpawner` (patterns), `DropletProjectile` (trajectories), `SudsVortex` (drain and foam)
- `src/rendering`: `WetFloorCaustics`, `ScreenSteamPostProcess`, `SceneRenderer`
- `src/ui`: `MoistureHUD`
- `src/audio`: `ShowerAudio`

Everything under `core`, `player` and `hazards` except `Input` runs without a browser, so tests play the real simulation.

To tune the game, start with `SURFACES` in `FloorInteraction.ts`, `COST` and `CYCLES` in `GameLoop.ts`, and the constants at the top of `PlayerController.ts`.
