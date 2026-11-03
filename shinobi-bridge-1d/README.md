# Shinobi Shower 1D: The Precarious Peak

A lone warrior on a rotting rope bridge between two peaks of wet black slate, in a night storm, above a gorge that ends in
fog. Movement is one line, left and right along the swaying deck. The weather is relentless: diagonal rain curtains,
suffocating mist, snow that piles into drifts, and hail that splits the planks. Cut it, dodge it, or kick it off the
bridge.

Three.js (WebGL2) with CC0 PBR textures, a rigged and animated warrior, and a fully synthesized soundtrack.

## Play

```
npm install
npm run dev     # http://localhost:5200 (sound starts muted; debug hook on window.bridgeDebug)
npm run build   # dist/index.html + dist/assets/ (serve the folder; the page loads its art over HTTP)
npm test        # simulation tests (node --test)
```

| Input | Action |
| --- | --- |
| A / D or arrows | Run (with momentum; the deck's pitch helps downhill and drags uphill) |
| Space, Shift or right click | Dash roll: untouchable while rolling, rocks the bridge |
| J, K or left click | Slash |
| S, L or down arrow | Kick: throws snow off the deck in front of you |
| F | Focus Cut (level 50) |
| Esc / P | Pause |
| M | Mute |

## The blade

A slash has a short startup, 0.12 s of cutting frames, then a 0.16 s wake in which the air the blade just passed through
still cuts rain, mist and small flakes. The next slash cannot start until the cooldown has fully passed: **0.4 s**, or
**0.55 s** with Flame Edge. A slash whose cutting frames meet nothing is a miss: until the blade is ready again the
warrior is exposed, taking 25% more damage and unable to dash or kick.

Hail only breaks when the blade meets it at the sweet spot (a box about two-thirds of the way along the reach, shown when
a stone is close). Off-centre, the blade knocks it aside.

## Weather

| Hazard | Behaviour | Hit |
| --- | --- | --- |
| Rain | Falls at 35°–60° from vertical, 34–42 m/s, slanting with a crosswind that swings both ways. A light steady fall plus dense curtains that sweep along the bridge. Facing into the wind and keeping a slash rhythm holds a curtain off. | 1.2% |
| Mist | A fine drizzle that drifts on the wind, chips at the robe and fogs the lens | 0.45% |
| Snow | Drifts with the wind; flakes merge into wide clumps in the air. Landed snow builds drifts on the planks that slump into mounds and slow the stride by up to 50%, until kicked away or burned off by a flaming cut. Rain and time melt it. | 1.2%, up to 25% for big clumps |
| Hail | Massive stones that speed up as they fall and aim near the warrior. Landing on the deck they rock the bridge and crack planks (four hits break one; big stones count double). A missing plank trips anyone who walks onto it rather than rolling over. | 25%–40% and a 0.6 s stun |

Waves get longer and nastier: **30 s** at wave 1, **90 s** at 10, **180 s** at 25, **300 s** from 50, linear between.
Waves 1–4 teach one hazard each. After that each wave is a sequence of cross-fading fronts (Monsoon, Sleet, Squall,
Whiteout, Blizzard, Tempest and so on). From wave 25 a second storm layer runs underneath, and from wave 50 rain and hail
never stop. Between waves the planks are lashed back in place.

## Levels 1–50

Mastery comes from every cut (with up to +50% for an unbroken streak) and from every wave survived. Progress is saved in
the browser.

| Level | Stance | Perk | Trade-off |
| --- | --- | --- | --- |
| 10 | Dual-Wield | Slash radius +35% | Movement −10% |
| 20 | Spirit Shield | Drizzle and rain do 80% less | A direct hail hit breaks it: +50% damage for 3 s; it reforms after 12 s |
| 30 | Flame Edge | Cuts vaporize snowdrifts and burst nearby rain into steam | Slash cooldown 0.55 s |
| 40 | Triple-Blade Mastery | Cuts left and right at once | Movement −20% (the loadout's total, replacing dual-wield's −10%) |
| 50 | Focus Cut | One cut across the whole sky | Once every 45 s |

Any unlocked stance can be switched off on the title screen to avoid its trade-off.

| Levels | Tier | Look |
| --- | --- | --- |
| 1–9 | The Wandering Exile | Burlap poncho, frayed straw kasa, one chipped katana in a wooden scabbard |
| 10–19 | The Dual Ronin | Indigo silk haori, leather arm guards, two katanas at the left hip, cloth mask |
| 20–29 | The Armored Kenshi | Black-and-gold lacquered sode, purple spirit ribbons, a blade wrapped in spirit mist |
| 30–39 | The Ashen Warlord | Scarred fur cloak, an ember-etched katana that ignites when drawn |
| 40–50 | The Apex Sovereign | Crimson cape, celestial eye glint, black-varnished blades with crimson lightning; three blades when Triple-Blade is on |

## Layout

```
src/main.ts                         loop, screens, saving, debug hook
src/core/Game.ts                    the whole simulation, no DOM (what the tests drive)
src/core/Input.ts                   keyboard, mouse and touch
src/progression/WaveDirector.ts     wave lengths and cross-fading weather fronts
src/progression/StanceModifiers.ts  perks, trade-offs, damage rules
src/progression/LevelManager.ts     the 1–50 mastery curve
src/weather/DynamicStormSystem.ts   crosswind, diagonal rain curtains, mist, snow and hail spawning, lightning
src/weather/PrecipitationDroplet.ts drop profiles, motion, clumping, swept collision
src/scene/SuspensionBridge.ts       sag, sway modes and plank health
src/scene/SnowAccumulator.ts        snow depth along the deck
src/warrior/WarriorController.ts    lane movement, dash roll, kick, stumbles
src/warrior/KatanaSlash.ts          slash timing, arcs, sweet spot, misses
src/render/                         renderer, camera, assets, wet PBR, post-processing, effects
src/scene/MountainPeakScene.ts      sky, peaks, cliffs, gorge fog, sea, moon and lightning
src/scene/BridgeRenderer.ts         planks, ropes, posts, lanterns, deck snow
src/weather/StormRenderer.ts        rain sheets, drops, hail and its warnings, mist, splashes
src/warrior/CosmeticsRenderer.ts    the animated warrior, tiers 1–5, blades and slash arcs
src/ui/, src/audio/                 HUD, screens, synthesized audio
src/shaders/                        GLSL (RainSheet, WetSurfacePBR and the rest)
docs/RENDER_CONTRACT.md             how the rendering modules fit together
```

Art credits are in [CREDITS.md](CREDITS.md).
