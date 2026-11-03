# Shinobi Shower 1D

A one-lane reflex game. A ninja runs left and right along a single rooftop and dodges or cuts the weather: drizzle, rain, snow and hail. The blade needs exactly 0.35 seconds between swings.

## Play

```
npm install
npm run dev     # http://localhost:5199, sound starts muted, debug hook on window.shinobi1d
npm run build   # dist/index.html and dist/shinobi-1d-artifact.html, one self-contained file each
npm test        # simulation tests (node --test)
```

| Input | Action |
| --- | --- |
| A / D or arrows | Run (with momentum) |
| Space, Shift or right click | Dash roll, invulnerable while rolling |
| J, K or left click | Slash |
| F | Focus Cut (level 50) |
| Esc / P | Pause |
| M | Mute |

On touch screens, thumb pads appear while playing.

## Weather

| Type | Behaviour | Hit |
| --- | --- | --- |
| Drizzle | Dense, tiny, everywhere | 1% |
| Rain | Fast streaks in volleys on a beat, with gaps | 5% |
| Snow | Slow, drifts with the wind, flakes merge into wide clumps | 2.5%, scaling with clump area up to 25% |
| Hail | Heavy, accelerates as it falls, aims near you | 25–40% and a 0.6s stun |

Hail only breaks when the blade meets it in the dashed sweet-spot box. An off-centre cut knocks it aside.

Waves last 18 seconds. Waves 1–4 each teach one type; after that they combine (Monsoon, Sleet, Squall, Blizzard, Tempest) and get denser.

## Levels 1–50

Mastery comes from every cut, with a streak bonus, and from every wave survived. Levels persist in the browser.

| Level | Stance | Perk | Trade-off |
| --- | --- | --- | --- |
| 10 | Dual-Wield | Slash arc +35% wider | Run speed −10% |
| 20 | Spirit Armor | Drizzle and rain do 80% less | Hail shatters it: +50% damage for 3s, reforms after 12s |
| 30 | Flame-Wreathed Edge | Each cut bursts into steam, clearing drops nearby | Blade cooldown +25% |
| 40 | Triple-Blade | Cuts left and right at once | Run speed −10% more, dash costs double |
| 50 | Focus Cut | Clears the whole sky | Once every 45 seconds |

Any unlocked stance can be switched off on the menu to avoid its trade-off.

Cosmetic tiers change at levels 1, 10, 20, 30 and 50: straw hat and tattered robes, dark ronin kimono with scabbards, glowing haori with ribbons, ashen coat with ember footsteps, and white sovereign robes with three floating spectral swords.

## Layout

```
src/main.ts                     loop, input buffering, screens, saving
src/engine/Game.ts              the whole simulation, no DOM (what the tests drive)
src/engine/WeatherSystem.ts     waves, seasons, spawning
src/engine/DropletPhysics.ts    drop profiles, wind, snow clumping, hitboxes
src/engine/AudioEngine.ts       synthesized Web Audio
src/entities/Ninja.ts           lane movement and dash roll
src/entities/Katana.ts          startup, active frames, cooldown, arcs, sweet spot
src/progression/LevelManager.ts the 1–50 mastery curve
src/progression/StanceModifiers.ts  perks, trade-offs, damage rules
src/ui/Renderer.ts              Canvas 2D drawing
src/ui/PostProcessVFX.ts        ripples, steam, shards, shake, flashes
src/ui/HUD.ts                   the DOM overlay
```

All art is drawn in code; there are no image assets.
