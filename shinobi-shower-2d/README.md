# Shinobi Shower: The Dry Blade (2D)

A side-on parkour climb up a giant shower, with mouse-aimed sword cuts. TypeScript and Canvas 2D, with no runtime libraries.

```bash
npm install
npm run dev        # http://localhost:5196, with sound off
npm test           # mechanics tests, plus a scripted run up the whole course
npm run typecheck
npm run build      # writes dist/index.html, one file with all its art inside
```

## Layout

- `src/parkour`: `NinjaController`, `WallRunDetector`, `GrappleWire`
- `src/combat`: `KatanaSlice`, `BladeTime`
- `src/hazards`: `WaterDroplet`, `ShowerStreamEmitter`, `TileHazardGrid`
- `src/core`: `Level` (the climb as data), `TrialGame` (rules and scoring), `Input`
- `src/rendering/CanvasRenderer.ts`: everything you see
- `src/ui`, `src/audio`: `TrialHUD`, `TrialAudio`
- `sprites/`: the character and plants, rendered from the 3D art packs by `tools/bake/`

When you change `Level.ts`, run `npm test`: `test/course.test.ts` drives the real controller up a route and fails if the climb can't be finished.

To re-render the sprites, run `node tools/bake/serve.mjs` and open http://localhost:5197.
