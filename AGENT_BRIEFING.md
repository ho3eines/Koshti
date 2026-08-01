# AGENT BRIEFING — read this first

> You are an AI agent picking this repo back up with no memory of previous
> sessions. This file exists so you can be productive in ~3 minutes instead of
> re-deriving everything (and repeating mistakes that already cost hours).
>
> **Keep this file updated.** If you change architecture, discover a new
> environment trap, or fix something listed here, edit this file in the same
> commit.

---

## 1. What this is, in one paragraph

**Koshti — Rise of a Champion** is a 3D wrestling career game for Android. The
game itself is TypeScript + Three.js (WebGL2). It ships two ways: as an
installable PWA, and as a **real signed APK** built without Gradle. A player
enters their name, works through six training stages, then climbs five league
divisions to a world title, unlocking moves and skills along the way.

**Status: complete and working.** 229 tests pass, the APK is built and
committed. This is not a half-finished project — do not "start over".

---

## 2. Ground truth (verify before trusting anything below)

```bash
npm ci                 # node_modules is often wiped between sessions
npm test               # expect: 229 passed
npx tsc --noEmit       # expect: silent
ls -lh public/apk/     # expect: koshti-1.0.0.apk ~702K
```

If those pass, everything in this document still holds.

---

## 3. ⚠️ Environment traps that WILL bite you

These are the things that wasted the most time. Read them before doing anything.

### 3.1 The sandbox is heavily firewalled
Blocked: `dl.google.com`, `services.gradle.org`, `maven.google.com`,
`repo1.maven.org`, `objects.githubusercontent.com`,
`raw.githubusercontent.com`, `release-assets.githubusercontent.com`, all
mirrors (aliyun/tuna/tencent), Playwright/Puppeteer browser CDNs.

Reachable: **`git clone` to github.com**, `registry.npmjs.org`, `pypi.org`,
`api.github.com` (via `gh`).

**The key insight that unblocked the APK:** GitHub *git* works even though
GitHub *release assets* don't. Anything you need as a binary, look for a repo
that commits it as a tracked file.

### 3.2 State is ephemeral between sessions
- **`node_modules/` gets wiped.** Always `npm ci` first. I hit "tsc: not found"
  more than once.
- **`/tmp` toolchain gets wiped.** Re-run `npm run apk:toolchain`.
- **Git history can be rewound while the working tree is kept.** Twice, local
  commits vanished but files stayed. If `git push` is rejected as non-fast-
  forward, do NOT force-push and do NOT panic:
  ```bash
  git fetch origin arena/019fb9c4-koshti
  git reset --soft FETCH_HEAD   # keeps your files, re-stages them
  git commit && git push
  ```

### 3.3 You cannot push to `.github/workflows/`
The token lacks GitHub's `workflows` permission. Pushes containing that path
are **rejected outright**, taking the whole commit with them. The workflow
therefore lives at **`ci/build-apk.yml`**. If you stage it by accident, the
push fails — `git reset ci/build-apk.yml` and re-push.

### 3.4 No GPU, no browser, no emulator
Nothing here can render a frame or run an APK. Don't burn time trying to
install Chromium — I already tried Playwright, Puppeteer, headless-gl, and
system packages. All blocked.

The workaround in place: `tests/bundle.test.ts` boots the **real shipped
bundle** in jsdom against a hand-written WebGL2 stub and asserts the title
screen renders with zero app-level errors.

### 3.5 Vite's `publicDir` vs our `public/`
We use `public/` as the *output* folder. Vite's default treats it as a
*static-assets input* and copies it into `dist/`, so every rebuild nested
`public/app/app/app/...`. Fixed with `publicDir: false` + `emptyOutDir: true`
in `vite.config.ts`. **Don't revert those.** Guarded by a test.

---

## 4. Layout

```
src/
├── core/       137 loc   event bus, seeded RNG (mulberry32), math helpers
├── engine/    3353 loc   PRESENTATION ONLY — never mutates game state
│   ├── renderer.ts   Three.js scene, actors, frame loop, perf stats
│   ├── wrestler.ts   procedural 17-bone rig + 26 keyframed clips + animator
│   ├── arena.ts      mats, lighting, instanced crowd, 5 venues
│   ├── camera.ts     cinematic shot director
│   ├── effects.ts    particle pool, screen shader, damage numbers
│   ├── audio.ts      100% procedural Web Audio + TTS commentary
│   ├── input.ts      gestures, virtual stick, haptics
│   └── quality.ts    4 presets, device probing, dynamic resolution
├── game/      4660 loc
│   ├── data/         moves, styles, skills, leagues, attributes (pure data)
│   ├── sim/          DETERMINISTIC combat + adaptive AI
│   ├── career/       progression, roster, league, tournaments, training
│   ├── save/         schema + migration + storage adapters
│   ├── match/        controller binding sim <-> engine
│   └── app.ts        shell: routing, main loop, lifecycle
├── ui/        3794 loc   screens (no framework, plain DOM helpers)
tests/         3367 loc   7 files, 229 tests

android-native/   dependency-free Activity used by the no-Gradle APK build
android/          full Capacitor + Gradle project (for people with the SDK)
scripts/          fetch-toolchain.sh, build-apk.sh, make-public.mjs
public/           index.html (landing) + app/ (PWA) + apk/ (the APK)
ci/               build-apk.yml — needs `git mv` into .github/workflows/
```

### The one architectural rule
**The simulation never touches the renderer; the renderer never mutates the
simulation.** That is what makes combat deterministic, testable headlessly, and
frame-rate independent. If you break this, the whole test strategy collapses.

---

## 5. How the game works (enough to make changes)

- **Combat** is a fixed-step 60 Hz state machine (`src/game/sim/combat.ts`).
  Same seed + same inputs = same result, always. Moves have
  windup → active → recovery phases; committing to one opens a **counter
  window** on the defender.
- **Stances** are `standing` / `clinch` / `ground`. A move is only legal in its
  own stance, and moves push you between stances. This is why a fighter can be
  "stuck" with no legal move — that's intended.
- **Momentum** gates specials: 50% for signatures, 100% for finishers.
- **AI** (`src/game/sim/ai.ts`) has three layers: style personality →
  situational tactics → adaptation (it models your habits and counters them).
- **Progression:** XP/levels → skill points → skill tree (4 branches) →
  unlocks moves + passives. Coins separately buy attribute points.
- **Save** autosaves after every meaningful action, keeps a rotating backup,
  supports a manual slot, and migrates old versions forward.

---

## 6. The APK — how it actually gets built

Gradle and Maven are unreachable, so `npm run apk` bypasses them entirely and
drives `aapt2 + javac + d8 + apksigner` by hand.

```bash
npm run apk:toolchain   # once per session: ~350 MB via git clone
npm run apk             # → public/apk/koshti-1.0.0.apk
```

Toolchain sources (all *git-tracked binaries*, which is why they work here):

| tool | repo |
|---|---|
| JDK 8 (`javac`, `jar`, `keytool`) | `khadas/android_prebuilts_jdk_jdk8` |
| `aapt2`, `d8`, `apksigner`, `zipalign` | `lipeedev/gendroid` |
| `android.jar` (API 33) | `Sable/android-platforms` |

Because AndroidX/Capacitor AARs are unreachable, the APK uses
`android-native/` — **one Activity, framework classes only**, wrapping a
fullscreen WebView that loads the game from `assets/www`. The save layer
already falls back to `localStorage` when Capacitor is absent, so nothing is
lost.

### Two `file://` quirks the build must keep handling
`scripts/build-apk.sh` patches the packaged `index.html`:
1. strips `crossorigin` (CORS checks fail on `file://`)
2. removes the service-worker registration (can't register on `file://`)

Both are asserted by `tests/apk.test.ts`. If you change the build, keep them.

### Verified APK facts
`com.koshti.wrestling`, v1.0.0, minSdk 24, targetSdk 33, **v1+v2+v3 signatures
all verify**, GL ES 3.0 required, 702 KB, full game inside `assets/www`.
Signed with a **throwaway key** — fine for sideloading, not for Play Store.

---

## 7. Tests (229) — and what they've caught

```
tests/sim.test.ts        31  combat rules, determinism, invariants
tests/career.test.ts     63  saves, migration, progression, league, brackets
tests/engine.test.ts     50  rig, animation, camera, quality, particles, input
tests/ui.test.ts         50  every screen, onboarding, navigation, persistence
tests/gameplay.test.ts   23  full match loops, frame-rate independence, balance
tests/bundle.test.ts      5  boots the SHIPPED bundle, PWA manifest, chunks
tests/apk.test.ts         7  APK structure, signing, DEX, bundled assets
```

`npm test` needs `NODE_OPTIONS=--experimental-vm-modules` (already in the
script) because `bundle.test.ts` links ES modules via `node:vm`.

**Real bugs these caught — don't reintroduce them:**
- `startIntro(0)` left matches **permanently paused** (timer never ticked below
  zero, bell never rang).
- **Null-deref crash**: the AI's auto-struggle could break a pin *mid-update*,
  then code read `.progress` off the now-null hold. Snapshot the hold locally
  and re-check identity before finishing.
- Skill nodes stored an **unlock token** (`power_suplex`) in the moveset
  instead of the real move id (`suplex`) — poisoned saves, threw
  `Unknown move` on the next match. Fixed with `resolveUnlockToMoveId()` plus
  defensive `hasMove()` filtering at every boundary.
- `CameraDirector.snap()` didn't converge → visible camera drift at match start.
- Vite `publicDir` nesting (see §3.5).

There are **balance guardrail tests** in `gameplay.test.ts`. They assert skill
beats button-mashing by a wide margin, amateur stays winnable, and the top
division punishes sloppy play. If you retune combat numbers, expect these to
move — re-measure, don't just loosen the thresholds.

---

## 8. Known gaps (be honest about these with the user)

1. **The APK has never been run on a device.** Structurally valid and fully
   asserted, but no emulator/phone was available. First-launch behaviour on
   real hardware is genuinely unverified.
2. **Nobody has ever seen a rendered frame.** No GPU anywhere in this
   environment. The bundle provably boots and reaches the title screen, but the
   visuals are unvalidated.
3. **Commentary is platform TTS**, not recorded VO — it reads real match
   context but sounds synthetic.
4. **Wrestlers are stylised parametric figures**, not scanned character art.
   This is a deliberate tradeoff: the whole game is ~200 KB gzipped + Three.js.
5. **CI workflow is not active** (see §3.3).

---

## 9. Session rules

- Branch is fixed: **`arena/019fb9c4-koshti`**. Never switch, never force-push.
- Commit messages here are detailed and explain *why*; match that style.
- The user communicates in **Persian/Farsi** — reply in Persian, keep code and
  identifiers in English.
- The user pushed back when I gave up too early on the APK, and they were
  right. Exhaust the options before declaring something impossible.

---

## 10. Fast recipes

```bash
# fresh session warm-up
npm ci && npm test

# play it locally (only way to actually see the game)
npm run dev                    # http://localhost:5173

# rebuild the distributable + PWA
npm run build:public
npm run serve:public           # http://localhost:8080

# rebuild the APK from scratch
npm run apk:toolchain && npm run apk

# enable CI (needs a human with workflows permission)
mkdir -p .github/workflows && git mv ci/build-apk.yml .github/workflows/
```

---

_Last updated: commit `cd673ae` — APK built and committed, 229 tests passing._
