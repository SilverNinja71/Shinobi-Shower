# Shinobi Shower: The Dry Blade

First-person parkour and water-slicing in a giant bathroom, built with TypeScript and Three.js.

```bash
npm install
npm run dev        # http://localhost:5198
npm test           # mechanics tests, plus a scripted run through the whole course
npm run typecheck
npm run build      # writes dist/index.html
```

## Layout

- `src/parkour`: `NinjaController`, `WallRunDetector`, `GrappleWire`
- `src/combat`: `KatanaSlice`, `BladeTime`
- `src/hazards`: `WaterDroplet`, `ShowerStreamEmitter`, `TileHazardGrid`
- `src/core`: `Level` (the course as data), `TrialGame` (rules and scoring), `Input`
- `src/rendering`: `SceneRenderer`, `TileShader`, `LensPost`
- `src/ui`, `src/audio`: `TrialHUD`, `TrialAudio`

When you change `Level.ts`, run `npm test`: `test/course.test.ts` drives the real controller along a route and fails if the course can't be finished.
