# Surf Rush

**An endless 3D surfing arcade game for the browser — by CodingWithBashir.**

You drop into a procedurally generated ocean, carve between five lanes of
moving hazards, launch off the swell, duck under driftwood, hoover up coins, and
outrun a Kraken that wakes up when you get too good.

Everything you see and hear is generated at runtime: the ocean surface, the
waves, the sky, the islands, the surfer, the hazards, the music and every sound
effect. There is not a single image, model or audio file in the repository.

```
npm install
npm run dev      # http://localhost:5173
```

---

## Contents

- [Quick start](#quick-start)
- [Controls](#controls)
- [How to play](#how-to-play)
- [Game modes](#game-modes)
- [Hazards](#hazards)
- [Collectibles and power-ups](#collectibles-and-power-ups)
- [The Kraken](#the-kraken)
- [Progression](#progression)
- [Settings and accessibility](#settings-and-accessibility)
- [Project layout](#project-layout)
- [Architecture notes](#architecture-notes)
- [Testing](#testing)
- [Build and package](#build-and-package)
- [Browser support](#browser-support)
- [Performance](#performance)
- [Known limitations](#known-limitations)
- [Dependencies](#dependencies)
- [Originality](#originality)
- [Licence](#licence)

---

## Quick start

You need **Node.js 18 or newer** (Node 20+ recommended). Nothing else — no
database, no accounts, no API keys, no network at runtime.

```bash
git clone https://github.com/CodingWithBashir/edge-surf.git
cd edge-surf
npm install
npm run dev
```

Vite prints a local URL; open it and press a key to start. The dev server binds
to `0.0.0.0`, so it also works from another device on your network or from a
sandboxed preview host.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the full automated test suite |
| `npm run zip` | Build, then package everything into `release/` as one ZIP |

### Downloadable build

`npm run zip` produces `release/surf-rush-<date>.zip`. Inside is a single
`surf-rush/` folder with `index.html`, the bundled assets, this README,
`package.json` and a short `PLAY.md` quick-start card.

The build is static and uses **relative paths**, so you can drop the folder on
any static host (GitHub Pages, Netlify, S3, an intranet share). To run it
locally, serve the folder — do not open `index.html` with `file://`, because
browsers refuse to load ES modules from the file system:

```bash
cd surf-rush
npx serve .          # or: python3 -m http.server 8080
```

---

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move left | `A` or `←` | Swipe left, or the ◀ button |
| Move right | `D` or `→` | Swipe right, or the ▶ button |
| Jump | `Space`, `↑` or `W` | Swipe up, or the ▲ button |
| Duck | `S` or `↓` | Swipe down, or the ▼ button |
| Pause | `P` or `Esc` | The pause button in the HUD |
| Confirm | `Enter` | Tap |

On a touch-capable device the on-screen buttons appear automatically; they are
labelled for screen readers ("Move left", "Jump", and so on). Swipes are
recognised with a distance threshold rather than a fixed time window, so a slow
drag still counts. If you would rather always see the buttons, or want the
horizontal axis flipped, both are options under **Settings → Controls**.

The first click or keypress also unlocks audio — browsers require a user gesture
before a page may make sound, so the game stays silent until you interact.

---

## How to play

You ride down a five-lane channel that scrolls toward you. Three things end a
run: hitting three hazards, running out of time, or being caught by the Kraken.

- **Steer** between hazards. Rocks, coral and buoys cannot be jumped — go
  around them.
- **Jump** logs and breaking waves. The jump has a short hop and a committed
  double-jump; you cannot steer much mid-air, so line up first.
- **Duck** under driftwood. Ducking also tucks you in and slightly reduces your
  collision height on the landing.
- **Chain** coins without wiping out to build a score multiplier, up to ×5.
  A wipeout resets it.
- **Near misses** — passing a hazard by a hair — award bonus points and a
  score popup. They are worth hunting.

Difficulty ramps continuously with distance: the surf speeds up, hazard groups
get denser, and new hazard types unlock as you go.

---

## Game modes

| Mode | Rules |
| --- | --- |
| **Endless Surf** | The main event. Three lives, no time limit, difficulty keeps climbing, Kraken every 1,200 m. |
| **Time Trial** | 90 seconds. Every wipeout costs three seconds. No lives — you surf until the clock runs out. |
| **Zigzag Challenge** | A narrow three-lane channel packed with moving hazards. Reach 2,500 m to complete it. |
| **Daily Challenge** | One course per calendar day, generated from the date, with two random modifiers applied. Your best daily score is kept. |
| **Practice Mode** | Forgiving course, no lives, no time limit. Scores and records are **not** saved here. |

Daily modifiers are drawn from a fixed pool — Tailwind, Crowded Water, Squall,
Golden Hour, Night Surf, Big Swell, Scarcity and Gauntlet — so everyone in the
world surfs the same course on the same day.

Environments (day, sunset, night) and weather (clear, cloudy, storm) change the
palette, the fog, the swell size and the lighting.

---

## Hazards

Thirteen hazard types, each with a collider shaped to match the thing you are
looking at — boxes for logs and driftwood, spheres and capsules for rocks and
coral, cylinders for buoys.

| Hazard | Behaviour |
| --- | --- |
| Rock | Steer around it |
| Coral | Steer around it |
| Log | Jump over it |
| Buoy | Steer around it; some drift across lanes |
| Breaking wave (whitewater) | Jump over it |
| Driftwood | Duck under it |
| Rock formation | A multi-rock cluster that blocks several lanes |
| Moving buoy | Slides side to side across the channel |
| Jellyfish | Steer around it; drifts with the swell |
| Storm debris | Churning clutter that jumps between lanes |
| Whirlpool | A swirling gap you must not enter |
| Spinner | Rotating arms; time the gap |
| Narrow passage | Walls leave one or two open lanes |

The spawner guarantees **at least one reachable lane** in every group it
generates, at every difficulty level. That property is covered by tests across
hundreds of seeds, because an unavoidable wall is the one bug that makes an
endless runner feel unfair.

---

## Collectibles and power-ups

**Collectibles** — coins (10), shells (25) and pearls (60). They also feed the
score and the coin wallet you spend in the shop.

| Power-up | Duration | Effect |
| --- | --- | --- |
| Coin Magnet | 9 s | Pulls nearby collectibles to your board |
| Shield | 14 s | Absorbs exactly one wipeout, then pops |
| Speed Boost | 6 s | +55% board speed and double distance points |
| Score ×2 | 10 s | Adds +2 to your score multiplier |
| Extra Life | instant | One more chance, where the mode has lives |

Active power-ups show as chips in the HUD with a draining ring, and the chip
pulses in the last two seconds. Power-ups never spawn inside a hazard, and there
is a cooldown between them so they stay special.

---

## The Kraken

An original chase event, not a reskin of anything.

At a distance interval (1,200 m in Endless) the water darkens, the music drops
into a low motif and a **warning** banner plays. The Kraken surfaces behind you
and gives chase for a fixed stretch of course. During the chase:

- The camera pulls back and the water churns behind you.
- Extra hazards — thrown debris and whirlpools — join the normal spawns.
- **Escape orbs** appear in your line. Collect enough and you escape.
- Every hit costs you ground. Take too many and the Kraken catches you.

Escape, and the ocean returns to normal with a score bonus. Get caught, and the
run ends with its own game-over screen. Escapes are tracked for two
achievements.

---

## Progression

Everything is stored in `localStorage` under `surf-rush:save:v1`. There is no
account and no server; clearing your browser data clears your progress.

**Achievements** — 18 of them, spread across distance, coins, jumps, clean
runs, combos, Kraken escapes and per-mode milestones. Each pays out coins.

**Shop** — 5 surfers and 6 boards. Two are unlocked from the start; the rest are
bought with coins or earned by hitting a milestone (for example, escaping the
Kraken unlocks a board). Cosmetics change the surfer's wetsuit, hair and board
colours and the board's graphics.

**Records** — your top runs per mode, stored on the device. The screen is
labelled **Local Records** and plainly says the data lives on this device only.

---

## Settings and accessibility

- Separate **music** and **SFX** volume, plus a master and a global mute.
- Graphics quality: `auto`, `low`, `medium`, `high`. `auto` watches the frame
  rate and steps down if the device is struggling.
- **Reduce motion** — calms camera shake, screen flash and banner animation.
- **High contrast** — stronger outlines and a darker UI scrim.
- **Large text** — scales UI text up.
- **Colour assist** — adds symbols to hazard cues so they do not rely on colour
  alone.
- **Lane guides** — toggleable lane lines on the water.
- **Force touch controls** — show the on-screen controls on a desktop too.
- **Invert swipe** — flip the horizontal swipe axis.

All of these persist.

---

## Project layout

```
index.html                 markup for every screen
src/
  main.js                  boot sequence, loading bar, fatal-error screen
  styles/                  base.css, ui.css, hud.css
  core/
    MathUtils.js           lerp, clamp, easing, formatters
    Rng.js                 seeded PRNG (mulberry32) + daily seed + date label
    ObjectPool.js          generic pool + named PoolGroup
    StateMachine.js        explicit state machine with enter/exit hooks
    EventBus.js            tiny pub/sub
    InputManager.js        keyboard, touch swipe and buttons, edge detection
  game/
    Game.js                orchestrator: state machine, run loop, wiring
    AudioManager.js        procedural Web Audio music and SFX
    config/
      Content.js           hazards, collectibles, power-ups, cosmetics, balance
      Modes.js             mode definitions, modifiers, run configs
      Environments.js      environment and weather palettes
    rules/                 pure, testable game logic — no Three.js
      Difficulty.js        speed and density curve
      LaneSystem.js        lane positions and movement
      JumpPhysics.js       jump arc, double jump, input buffering
      CollisionSystem.js   AABB / sphere / capsule tests
      ScoreManager.js      score, combo, multiplier, breakdown
      PowerUpManager.js    durations, stacking, expiry
      KrakenAI.js          warning → chase → escape-or-caught state machine
      SpawnDirector.js     seeded hazard and pickup spawning
    three/                 rendering, procedural meshes, scene graph
      Ocean.js Sky.js Scenery.js SurferModel.js Particles.js
      HazardFactory.js ObstacleManager.js CollectibleManager.js
      Player.js Kraken.js CameraRig.js World.js GeometryUtils.js
      shaders/common.glsl.js
  storage/SaveManager.js   localStorage persistence, migration, purchases
  ui/
    HUD.js                 score, lives, power-ups, toasts, countdown
    Menu.js                all 14 screens, settings binding, results
tests/                     node:test suites (see below)
tools/build-zip.mjs        packages dist/ into a ZIP
```

The `rules/` directory is deliberately free of Three.js imports. That is what
makes the game logic testable headlessly, without a GPU.

---

## Architecture notes

**Fixed-timestep simulation.** The run loop accumulates real time and steps the
simulation in fixed 1/60 s slices, with a cap on how many slices a single frame
may consume. Movement, collision and difficulty are therefore identical at 30,
60 or 144 FPS; only interpolation between steps varies.

**Object pooling.** Hazards, collectibles, particles and floating text all come
from pools. Nothing is allocated mid-run, so there is no garbage-collection
stutter.

**Streaming.** The world scrolls the surfer, not the ocean. Hazard groups are
spawned ahead of the camera and recycled once they fall behind, so the course is
effectively infinite at constant memory cost.

**Collision reference frame.** Hazards bob with the swell for looks, but
collision is tested against a shared waterline — otherwise a hazard sitting on a
crest while you are in a trough becomes impossible to jump. This was a real bug
found by the simulation tests; see `hazard.collisionY` in `CollisionSystem.js`.

**Procedural audio.** `AudioManager` synthesises every sound with oscillators,
noise buffers and filters: the wave bed, the music loop, coin pickups, jump and
land thumps, wipeouts and the Kraken motif. Per-frame setters are diffed so the
audio graph is not rebuilt when a value has not changed.

**Determinism.** Every run is driven by a seeded PRNG. Endless uses a random
seed; the Daily Challenge derives its seed from the calendar date, so the
course is the same for everyone that day and reproducible in tests.

**State machine.** `Loading → MainMenu → ModeSelect → Ready → Playing ⇄ Paused →
Wipeout → GameOver → Results`. Transitions are declarative, with `enter`/`exit`
hooks and a guard against illegal transitions.

**WebGL failure handling.** If a WebGL context cannot be created, the game does
not hang or render a black rectangle — it stops the boot sequence and shows a
fatal-error screen that explains what happened and offers a reload button.

---

## Testing

```bash
npm test
```

128 tests across four suites, run with Node's built-in `node:test`. No browser
and no GPU required.

| Suite | Covers |
| --- | --- |
| `tests/rules.test.js` | RNG determinism, math helpers, pools, state machine, event bus, lanes, jump physics, per-hazard collision geometry, difficulty curve, scoring, power-ups, Kraken AI, spawn reachability, modes |
| `tests/simulation.test.js` | Headless full-run integration: an autopiloted surfer plays real runs against the real ocean, obstacle and scoring systems; checks jump clearance at five speeds, duck geometry, coin magnet, power-ups, shield, Kraken wake-up, hazard-type coverage, NaN stability and difficulty monotonicity |
| `tests/save.test.js` | Persistence, migration, corruption recovery, coin economy, purchases, achievement evaluation and payouts, records and daily bests |
| `tests/ui.test.js` | jsdom DOM tests: every screen renders with real content, no dead buttons, no missing element ids, settings binding and mirroring, HUD updates, pause/game-over/results screens |

The simulation suite is the interesting one: `tests/helpers/harness.js` builds
the real systems at a fixed timestep and drives them with an autopilot that
scores lanes and times its jumps on time-to-impact. It is what caught the
collision-reference-frame bug above.

---

## Build and package

```bash
npm run build     # -> dist/  (~700 kB JS, ~200 kB gzipped)
npm run zip       # -> release/surf-rush-<date>.zip
```

`build-zip.mjs` writes the archive with Node's own `zlib`, so it works the same
on Windows, macOS and Linux with no system `zip` binary. It keeps only the
newest archive in `release/`.

---

## Browser support

Tested and targeted at:

- **Microsoft Edge** (Chromium) — primary target
- **Google Chrome**
- **Mozilla Firefox**
- **Safari** on macOS and iOS

Requires WebGL 2 and ES module support — effectively any browser from 2021
onwards. The game runs on Windows, macOS, Linux and touch devices.

Mobile: the layout adapts to portrait and landscape, the on-screen controls
scale to thumb reach, and quality auto-steps down on weaker GPUs.

---

## Performance

Target is 60 FPS. Techniques in use:

- A single trapezoidal water mesh with dense tessellation near the camera and a
  coarse fan toward the horizon, instead of a uniform grid big enough to reach
  the horizon.
- Wave maths evaluated in a vertex shader, not on the CPU.
- Instanced or merged geometry for hazards, collectibles and scenery.
- Object pooling throughout — no per-frame allocation.
- Shadow maps only on `high` quality; cheap shadow decals below that.
- Adaptive quality: if the rolling frame time is bad for a sustained period, the
  renderer drops pixel ratio, then shadow quality, then wave detail.

---

## Known limitations

Honest list of what this build does *not* do.

- **Offline and single-device only.** There is no server, no account and no
  cross-device sync. The leaderboard is explicitly device-local and labelled as
  such; it is not an online leaderboard and does not pretend to be one.
- **Progress is per-browser.** It lives in `localStorage`. Clearing site data,
  using private browsing, or switching browsers loses it. There is no export or
  import.
- **No gamepad support.** Keyboard and touch only.
- **No screenshots or replay sharing.** The results screen is text only.
- **Adaptive quality is one-way.** It steps down when the frame rate suffers but
  does not step back up within a run, to avoid oscillation. Changing the setting
  manually (or restarting) resets it.
- **Safari and low-end mobile GPUs** fall back to `medium` or `low` quality,
  which means smaller waves and no real-time shadows. The game stays playable.
- **ES modules need a server.** Opening `index.html` from the file system will
  not work; see [Quick start](#quick-start).
- **Surfer animation is procedural**, not keyframed motion capture — poses are
  blended from sine curves and state. It reads well in motion but is not
  animation-studio quality.
- **The Daily Challenge uses local time.** Two players in different time zones
  can be on different calendar dates near midnight, so they may briefly get
  different daily courses.

---

## Dependencies

Two, and one of them is only for tests.

| Package | Version | Why |
| --- | --- | --- |
| `three` | `^0.170.0` | WebGL rendering |
| `vite` | `^5.4.21` | Dev server and bundler (dev only) |
| `jsdom` | `^25.0.1` | DOM for the UI tests (dev only) |

That is the whole manifest. No analytics, no ads, no telemetry, no tracking
scripts, no fonts loaded from a CDN, no network requests of any kind at runtime.
All art and audio is generated in code, so there are no asset licences to honour
and no copyrighted material in the repository.

---

## Originality

Surf Rush is an original game inspired by the *genre* of endless surf runners,
including Microsoft Edge Surf as a point of reference for feel and pacing.

It contains **no** Microsoft code, assets, art, audio, characters or branding.
The name, the surfer characters, the Kraken event, the course generator, the
audio synthesis and every mesh and texture in this repository were written from
scratch for this project. Microsoft Edge Surf is a trademark of Microsoft
Corporation; this project is not affiliated with, endorsed by, or connected to
Microsoft.

---

## Licence

MIT. See the repository for details.
