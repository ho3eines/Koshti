# KOSHTI — Rise of a Champion

A 3D wrestling career game built for Android. Real-time WebGL2 combat, a full
career ladder from amateur mats to a world title, procedural audio, and a save
system that never loses your progress.

```
┌─────────────────────────────────────────────────────────────┐
│  Name your wrestler  →  Training Hall  →  Amateur Circuit    │
│  →  Semi-Pro  →  Professional  →  Elite  →  Champion's Circle│
└─────────────────────────────────────────────────────────────┘
```

---

## Quick start

```bash
npm install
npm run dev            # play in a browser at localhost:5173
npm test               # 217 tests
npm run build          # production bundle
```

### Android

```bash
npm run android:sync   # build web assets + sync into the native project
npm run android:open   # open in Android Studio
npm run android:run    # build, install and launch on a connected device
npm run android:apk    # assemble a release APK
```

Requires JDK 21 and the Android SDK (API 36). The native project already lives
in `android/` — icons, splash screens, manifest and ProGuard rules are all
configured.

---

## What's in the game

### Career progression

Enter your name on first launch and the game builds a profile around it. From
there:

| Stage | What happens |
|---|---|
| **Training Hall** | Six interactive stages teach movement, attack, defense, counters, ground control and combos. Each has live objective tracking, star ratings for speed, and unlocks abilities. |
| **League** | Five divisions. Win enough bouts to earn a **promotion match**, beat the division's best, move up. Each division has a deterministic 12-wrestler roster and a live standings table. |
| **Tournaments** | 4- and 8-wrestler single-elimination brackets, plus club championships with large prize pools. |
| **Skill tree** | Four branches (Power, Technique, Conditioning, Showmanship) across 5 tiers. Unlocks signature moves, finishers and passive combat modifiers. |
| **Attributes** | Six stats trainable with coins on a rising cost curve, capped at 99. |
| **Achievements** | 21 achievements paying out coins, from your first pinfall to the world title. |

### Combat

A deterministic, fixed-step (60 Hz) simulation — identical results on a budget
phone and a flagship, and fully reproducible from a seed.

- **17 moves** across standing, clinch and ground positions: strikes, grapples,
  takedowns, throws, submissions, signatures and finishers.
- **Stance system** — your available moves change with position, so the match
  flows standing → clinch → ground and back.
- **Counter & reversal** — every committed move opens a timing window on the
  defender. Hit it and you flip the exchange; a *perfect* counter scores more.
- **Stamina, fatigue and momentum** — stamina gates what you can throw, fatigue
  accumulates permanently over a match, and momentum charges signatures
  (50%) and finishers (100%).
- **Pins and submissions** — hold them down while they struggle to escape.
- **Scoring** — real wrestling points (takedown 2, throw 4, reversal 2…), so a
  match can be won on the scorecard or by finish.

### AI

Three layers, so opponents feel like people rather than difficulty sliders:

1. **Style personality** — power / technical / speed / all-round, each with its
   own move preferences, aggression and patience.
2. **Situational tactics** — reacts to stamina, health, the scoreboard and the
   clock. Behind late? It hunts throws. Ahead late? It stalls safely.
3. **Adaptation** — builds a model of *your* habits. Reverse it often and it
   switches to moves that resist reversals; turtle up and it stops striking and
   starts grappling.

### Presentation

- **Procedurally built wrestlers** — a fully rigged 17-bone skeleton generated
  from parametric primitives, with body proportions driven by attributes. No
  30 MB model downloads; the whole game is ~200 KB gzipped plus Three.js.
- **26 hand-authored animation clips** with cross-fade blending and additive
  impact shake.
- **Cinematic camera director** — broadcast framing, punch-ins for finishers,
  ground cameras, orbiting intros, handheld breathing and impact shake.
- **Five arenas** scaling from an empty training hall to a 68,000-seat
  colosseum, with instanced crowds that react to the action.
- **Procedural audio** — every sound is synthesised at runtime with the Web
  Audio API: impacts, slams, a pink-noise crowd bed that swells with the match,
  an adaptive score, and optional TTS commentary that reads real match context.
  Zero audio assets to download.

### Controls

Three schemes, switchable in settings, plus a left-handed mirror.

| Gesture | Action |
|---|---|
| Tap | Quick strike / tie-up |
| Swipe up | Throw or signature |
| Swipe down | Takedown or submission |
| Hard swipe sideways | Grapple |
| Soft swipe sideways | Escape / disengage |
| Draw a circle | Reversal |
| Double tap | Finisher |
| Press and hold | Guard |

A virtual stick (with dead-zone and clamping) handles movement on the other
half of the screen, alongside contextual on-screen buttons.

---

## Performance

Targets a locked 60 FPS on mid-range Android hardware.

- **Four quality presets** (Low / Medium / High / Ultra) controlling shadows,
  crowd density, mesh segments, particles, post effects and render scale.
- **Auto-detection** probes the GPU renderer string, device memory and core
  count on first launch and picks a preset — overridable at any time.
- **Dynamic resolution** watches the p90 frame time and nudges render scale
  between 0.55× and 1.0× to hold your target frame rate.
- **Fixed-step simulation** decoupled from rendering, so gameplay speed never
  depends on frame rate (verified by test at both 30 and 60 FPS).
- Instanced crowds, pooled particles, zero per-frame allocation in hot paths,
  and a single fullscreen quad instead of a post-processing stack.

Enable the performance overlay in Settings to see live FPS, draw calls,
triangle count and render scale.

---

## Saving

- **Autosave** after every match, unlock, purchase and milestone, plus a
  debounced background save while you play.
- **Resume** — the game remembers which screen you were on and drops you back
  there. The title screen shows your name, level, division and last checkpoint.
- **Rotating backup** — the previous good save is kept, so a corrupt write
  can't destroy a career (there's a test for exactly this).
- **Manual save slot**, independent of autosave.
- **Export / import** save codes to move a career between devices.
- **Cloud backup** via Android's backup framework (`backup_rules.xml`), so a
  device transfer brings the career with it.
- **Versioned migration** — old saves are upgraded and backfilled, never
  dropped.

Storage uses Capacitor Preferences on device and falls back to localStorage in
the browser.

---

## Architecture

```
src/
├── core/          # event bus, seeded RNG, math helpers
├── engine/        # presentation layer (never mutates game state)
│   ├── renderer   # Three.js scene, actors, frame loop
│   ├── wrestler   # procedural rig + keyframe animator
│   ├── arena      # mats, lighting, instanced crowd
│   ├── camera     # cinematic shot director
│   ├── effects    # particles, screen effects, damage numbers
│   ├── audio      # procedural synthesis + commentary
│   ├── input      # gestures, virtual stick, haptics
│   └── quality    # presets, device probing, dynamic resolution
├── game/
│   ├── data/      # moves, styles, skills, leagues, attributes
│   ├── sim/       # deterministic combat + adaptive AI
│   ├── career/    # progression, roster, league, tournaments, training
│   ├── save/      # schema, migration, storage adapters
│   ├── match/     # controller binding sim ↔ engine
│   └── app.ts     # shell: routing, main loop, lifecycle
└── ui/            # screens, styles, DOM helpers
```

The **simulation never touches the renderer** and the **renderer never mutates
the simulation**. That separation is what makes the combat deterministic,
testable headlessly, and safe to run at any frame rate.

---

## Tests

```
tests/sim.test.ts        31   combat rules, determinism, invariants
tests/career.test.ts     63   saves, migration, progression, league, brackets
tests/engine.test.ts     50   rig, animation, camera, quality, particles, input
tests/ui.test.ts         50   every screen, full onboarding, navigation, persistence
tests/gameplay.test.ts   23   full match loops, frame-rate independence, balance
                        ───
                        217
```

Run with `npm test`.

The gameplay suite plays complete matches through the real controller with a
scripted bot, and the balance guardrails assert the difficulty curve holds:
skill must beat button-mashing by a wide margin, the amateur circuit must stay
winnable, and the Champion's Circle must punish sloppy play.

### Bugs these tests caught

Worth recording, because they were all real:

- `startIntro(0)` left the match **permanently paused** — the timer never
  ticked below zero, so the bell never rang.
- A **null-dereference crash** in `updateHolds`: the AI's auto-struggle could
  break a pin mid-update, after which the code still read `.progress` off the
  now-null hold.
- Skill nodes stored an **unlock token** (`power_suplex`) in the player's
  moveset instead of the real move id (`suplex`), so buying Suplex Mastery
  poisoned the save and threw `Unknown move` on the next match. Fixed with a
  resolver plus defensive filtering at every boundary.
- `CameraDirector.snap()` didn't fully converge, so matches opened with a
  visible camera drift.

---

## Known limitations

- **No WebGL in CI.** Browser binaries couldn't be downloaded in the build
  sandbox, so the rendered output has not been visually verified on a device.
  Everything CPU-side (scene graph, rig, animation, camera, quality logic) is
  tested for real; the actual pixels are not. Run `npm run dev` to see it.
- **Commentary** uses the platform TTS voice rather than recorded VO — it reads
  real match context, but it sounds synthetic.
- **Cloud sync** is Android's backup framework plus manual export codes; there
  is no account system or cross-platform server.
- Wrestlers are stylised parametric figures, not scanned character art.

---

## License

MIT
