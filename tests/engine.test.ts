/**
 * Engine tests.
 *
 * A real WebGL context is not available in CI, but the Three.js scene graph,
 * the animation system, the camera director and all the quality/perf logic are
 * pure CPU code — so they are tested here for real.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Animator, buildWrestler, clipForMove, type Rig } from '../src/engine/wrestler';
import { CameraDirector } from '../src/engine/camera';
import { DynamicResolution, QUALITY, recommendPreset, type DeviceCaps } from '../src/engine/quality';
import { ParticleSystem } from '../src/engine/effects';
import { InputManager } from '../src/engine/input';
import { MOVES } from '../src/game/data/moves';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { clamp, damp, dampAngle, lerp, shortestAngle, smoothstep } from '../src/core/math';

// --------------------------------------------------------------- core utils

describe('math helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('lerps and smoothsteps within bounds', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 5);
  });

  it('damp converges toward the target and is framerate independent', () => {
    let a = 0;
    for (let i = 0; i < 120; i++) a = damp(a, 10, 6, 1 / 60);
    let b = 0;
    for (let i = 0; i < 240; i++) b = damp(b, 10, 6, 1 / 120);
    expect(a).toBeGreaterThan(9.8);
    // Same wall-clock time at different frame rates → nearly identical result.
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it('takes the shortest path around the circle', () => {
    expect(shortestAngle(0, Math.PI * 1.9)).toBeCloseTo(-Math.PI * 0.1, 5);
    expect(shortestAngle(0, Math.PI * 0.1)).toBeCloseTo(Math.PI * 0.1, 5);
    const r = dampAngle(0, Math.PI * 1.9, 30, 1);
    expect(r).toBeLessThan(0);
  });
});

describe('seeded RNG', () => {
  it('is reproducible', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it('produces values in [0,1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const r = new Rng(11);
    const buckets = new Array(10).fill(0);
    const n = 40000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]++;
    for (const b of buckets) expect(Math.abs(b - n / 10) / (n / 10)).toBeLessThan(0.08);
  });

  it('derives a stable seed from a string', () => {
    expect(Rng.fromString('koshti').seed).toBe(Rng.fromString('koshti').seed);
    expect(Rng.fromString('a').seed).not.toBe(Rng.fromString('b').seed);
  });

  it('int() respects inclusive bounds', () => {
    const r = new Rng(3);
    for (let i = 0; i < 2000; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('event bus', () => {
  it('delivers, unsubscribes and fires once', () => {
    const bus = new EventBus<{ ping: number }>();
    let sum = 0;
    const off = bus.on('ping', (v) => (sum += v));
    bus.emit('ping', 5);
    expect(sum).toBe(5);
    off();
    bus.emit('ping', 5);
    expect(sum).toBe(5);

    let onceCount = 0;
    bus.once('ping', () => onceCount++);
    bus.emit('ping', 1);
    bus.emit('ping', 1);
    expect(onceCount).toBe(1);
  });

  it('tolerates a listener unsubscribing during emit', () => {
    const bus = new EventBus<{ go: void }>();
    let calls = 0;
    const off1 = bus.on('go', () => {
      calls++;
      off1();
    });
    bus.on('go', () => calls++);
    expect(() => bus.emit('go', undefined)).not.toThrow();
    expect(calls).toBe(2);
  });
});

// ------------------------------------------------------------ wrestler rig

describe('wrestler model', () => {
  let rig: Rig;
  let dispose: () => void;

  beforeAll(() => {
    const built = buildWrestler(
      { height: 1, bulk: 1, skin: 0xc98a5e, trunks: 0xe8442f, accent: 0x2f6fd0 },
      QUALITY.high,
    );
    rig = built.rig;
    dispose = built.dispose;
  });

  it('builds a complete bone hierarchy', () => {
    const bones: Array<keyof Rig> = [
      'hips', 'spine', 'chest', 'neck', 'head',
      'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
      'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR',
    ];
    for (const b of bones) {
      expect(rig[b], String(b)).toBeDefined();
      expect((rig[b] as { obj: THREE.Object3D }).obj).toBeInstanceOf(THREE.Object3D);
    }
  });

  it('parents limbs correctly so the skeleton moves as one', () => {
    // Moving the hips must move the whole body.
    const worldBefore = new THREE.Vector3();
    rig.root.updateMatrixWorld(true);
    rig.handL.obj.getWorldPosition(worldBefore);

    rig.hips.obj.position.y += 1;
    rig.root.updateMatrixWorld(true);
    const worldAfter = new THREE.Vector3();
    rig.handL.obj.getWorldPosition(worldAfter);
    expect(worldAfter.y - worldBefore.y).toBeCloseTo(1, 4);
    rig.hips.obj.position.y -= 1;
  });

  it('has meshes that cast shadows', () => {
    let casters = 0;
    rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.castShadow) casters++;
    });
    expect(casters).toBeGreaterThan(8);
  });

  it('scales geometry with body parameters', () => {
    const small = buildWrestler(
      { height: 0.8, bulk: 0.8, skin: 1, trunks: 2, accent: 3 },
      QUALITY.low,
    );
    const big = buildWrestler(
      { height: 1.2, bulk: 1.3, skin: 1, trunks: 2, accent: 3 },
      QUALITY.low,
    );
    expect(big.rig.hips.obj.position.y).toBeGreaterThan(small.rig.hips.obj.position.y);
    small.dispose();
    big.dispose();
  });

  it('uses fewer segments on low quality than ultra', () => {
    const count = (q: typeof QUALITY.low): number => {
      const b = buildWrestler({ height: 1, bulk: 1, skin: 1, trunks: 2, accent: 3 }, q);
      let verts = 0;
      b.rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) verts += m.geometry.attributes.position?.count ?? 0;
      });
      b.dispose();
      return verts;
    };
    expect(count(QUALITY.ultra)).toBeGreaterThan(count(QUALITY.low));
  });

  it('disposes without throwing', () => {
    expect(() => dispose()).not.toThrow();
  });
});

// -------------------------------------------------------------- animation

describe('animator', () => {
  const makeRig = () =>
    buildWrestler({ height: 1, bulk: 1, skin: 1, trunks: 2, accent: 3 }, QUALITY.medium);

  it('advances without producing NaN in any bone', () => {
    const { rig, dispose } = makeRig();
    const anim = new Animator(rig);
    anim.play('double_leg');
    for (let i = 0; i < 200; i++) anim.update(1 / 60);
    rig.root.traverse((o) => {
      expect(Number.isFinite(o.rotation.x), o.name).toBe(true);
      expect(Number.isFinite(o.rotation.y)).toBe(true);
      expect(Number.isFinite(o.rotation.z)).toBe(true);
      expect(Number.isFinite(o.position.y)).toBe(true);
    });
    dispose();
  });

  it('actually moves bones when a clip plays', () => {
    const { rig, dispose } = makeRig();
    const anim = new Animator(rig);
    anim.play('stance');
    anim.snap();
    const before = rig.kneeL.obj.rotation.x;
    anim.play('suplex', { restart: true });
    for (let i = 0; i < 40; i++) anim.update(1 / 60);
    expect(Math.abs(rig.kneeL.obj.rotation.x - before)).toBeGreaterThan(0.05);
    dispose();
  });

  it('flags non-looping clips as finished and keeps looping ones running', () => {
    const { rig, dispose } = makeRig();
    const anim = new Animator(rig);
    anim.play('hit', { restart: true });
    for (let i = 0; i < 120; i++) anim.update(1 / 60);
    expect(anim.finished).toBe(true);

    anim.play('idle', { restart: true });
    for (let i = 0; i < 600; i++) anim.update(1 / 60);
    expect(anim.finished).toBe(false);
    dispose();
  });

  it('cross-fades smoothly — no single-frame pose snapping', () => {
    const { rig, dispose } = makeRig();
    const anim = new Animator(rig);
    anim.play('stance');
    anim.snap();
    anim.play('crusher', { fade: 0.3, restart: true });
    let maxDelta = 0;
    let prev = rig.chest.obj.rotation.x;
    for (let i = 0; i < 90; i++) {
      anim.update(1 / 60);
      maxDelta = Math.max(maxDelta, Math.abs(rig.chest.obj.rotation.x - prev));
      prev = rig.chest.obj.rotation.x;
    }
    // A pop would be a huge per-frame jump; blending keeps it small.
    expect(maxDelta).toBeLessThan(0.35);
    dispose();
  });

  it('has a clip for every move in the game', () => {
    const { rig, dispose } = makeRig();
    const anim = new Animator(rig);
    for (const m of MOVES) {
      const clip = clipForMove(m.clip);
      expect(() => anim.play(clip, { restart: true }), m.id).not.toThrow();
      anim.update(1 / 60);
      // clipForMove falls back to 'snap' for unknown keys — assert we mapped it.
      expect(clip, `${m.id} has no animation clip named "${m.clip}"`).toBe(m.clip);
    }
    dispose();
  });

  it('impact shake decays back to rest', () => {
    const { rig, dispose } = makeRig();
    const anim = new Animator(rig);
    anim.play('stance');
    anim.snap();
    const rest = rig.hips.obj.position.y;
    anim.addImpact(1.2);
    anim.update(1 / 60);
    expect(Math.abs(rig.hips.obj.position.y - rest)).toBeGreaterThan(0.001);
    for (let i = 0; i < 120; i++) anim.update(1 / 60);
    expect(Math.abs(rig.hips.obj.position.y - rest)).toBeLessThan(0.02);
    dispose();
  });
});

// ----------------------------------------------------------------- camera

describe('camera director', () => {
  const a = new THREE.Vector3(-1, 1, 0);
  const b = new THREE.Vector3(1, 1, 0);

  it('frames the action and stays finite', () => {
    const d = new CameraDirector(16 / 9);
    for (let i = 0; i < 200; i++) d.update(1 / 60, a, b, 0);
    expect(Number.isFinite(d.camera.position.x)).toBe(true);
    expect(Number.isFinite(d.camera.position.y)).toBe(true);
    expect(Number.isFinite(d.camera.position.z)).toBe(true);
    // Always above the mat and outside the fighters.
    expect(d.camera.position.y).toBeGreaterThan(0.5);
    expect(d.camera.position.length()).toBeGreaterThan(2);
  });

  it('punches in for finishers', () => {
    const d = new CameraDirector(16 / 9);
    d.snap(a, b);
    const wide = d.camera.position.distanceTo(new THREE.Vector3(0, 1, 0));
    // Hold the shot long enough that it does not expire mid-measurement.
    d.setMode('finisher', 10);
    for (let i = 0; i < 180; i++) d.update(1 / 60, a, b, 0);
    const tight = d.camera.position.distanceTo(new THREE.Vector3(0, 1, 0));
    expect(tight).toBeLessThan(wide);
    expect(d.camera.fov).toBeLessThan(50);
  });

  it('snap() fully converges so matches do not open with a camera drift', () => {
    const d = new CameraDirector(16 / 9);
    d.snap(a, b);
    const settled = d.camera.position.clone();
    for (let i = 0; i < 240; i++) d.update(1 / 60, a, b, 0);
    // Position after snap should already be the steady state.
    expect(d.camera.position.distanceTo(settled)).toBeLessThan(0.06);
  });

  it('returns to broadcast after a timed shot expires', () => {
    const d = new CameraDirector(16 / 9);
    d.setMode('closeup', 0.5);
    expect(d.currentMode).toBe('closeup');
    for (let i = 0; i < 60; i++) d.update(1 / 60, a, b, 0);
    expect(d.currentMode).toBe('broadcast');
  });

  it('orbits during the cinematic intro', () => {
    const d = new CameraDirector(16 / 9);
    d.setMode('cinematic_intro');
    d.update(1 / 60, a, b, 0);
    const start = d.camera.position.clone();
    for (let i = 0; i < 120; i++) d.update(1 / 60, a, b, 0);
    expect(d.camera.position.distanceTo(start)).toBeGreaterThan(0.5);
  });

  it('shake decays to zero', () => {
    const d = new CameraDirector(16 / 9);
    d.snap(a, b);
    d.addShake(2);
    const shaken = d.camera.position.clone();
    for (let i = 0; i < 300; i++) d.update(1 / 60, a, b, 0);
    const settled = d.camera.position.clone();
    for (let i = 0; i < 10; i++) d.update(1 / 60, a, b, 0);
    // Once settled the camera is essentially still (only gentle breathing).
    expect(d.camera.position.distanceTo(settled)).toBeLessThan(0.05);
    expect(shaken).toBeDefined();
  });

  it('updates the projection on resize', () => {
    const d = new CameraDirector(1);
    d.resize(2);
    expect(d.camera.aspect).toBe(2);
  });
});

// ---------------------------------------------------------------- quality

describe('quality profiles', () => {
  it('scale monotonically from low to ultra', () => {
    const order = [QUALITY.low, QUALITY.medium, QUALITY.high, QUALITY.ultra];
    for (let i = 1; i < order.length; i++) {
      expect(order[i].maxPixelRatio).toBeGreaterThanOrEqual(order[i - 1].maxPixelRatio);
      expect(order[i].crowdCount).toBeGreaterThanOrEqual(order[i - 1].crowdCount);
      expect(order[i].bodySegments).toBeGreaterThanOrEqual(order[i - 1].bodySegments);
      expect(order[i].renderScale).toBeGreaterThanOrEqual(order[i - 1].renderScale);
    }
  });

  it('low disables the expensive features', () => {
    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.low.bloom).toBe(false);
    expect(QUALITY.low.particles).toBe(false);
    expect(QUALITY.low.crowdCount).toBe(0);
    expect(QUALITY.low.renderScale).toBeLessThan(1);
  });

  it('recommends a preset appropriate to the device', () => {
    const dev = (gpuTier: 0 | 1 | 2 | 3, memoryGB: number): DeviceCaps => ({
      gpuTier,
      memoryGB,
      cores: 8,
      maxTextureSize: 4096,
      renderer: 'test',
      isMobile: true,
    });
    expect(recommendPreset(dev(0, 2))).toBe('low');
    expect(recommendPreset(dev(1, 3))).toBe('medium');
    expect(recommendPreset(dev(2, 4))).toBe('high');
    expect(recommendPreset(dev(3, 8))).toBe('ultra');
  });
});

describe('dynamic resolution', () => {
  it('drops the scale when frames run long', () => {
    const dr = new DynamicResolution(60, 1);
    let changed: number | null = null;
    // 40ms frames = 25fps, well under a 60fps budget.
    for (let i = 0; i < 60; i++) {
      const r = dr.update(40);
      if (r !== null) changed = r;
    }
    expect(changed).not.toBeNull();
    expect(dr.scale).toBeLessThan(1);
  });

  it('recovers the scale when frames are fast again', () => {
    const dr = new DynamicResolution(60, 1);
    for (let i = 0; i < 200; i++) dr.update(40);
    const low = dr.scale;
    for (let i = 0; i < 400; i++) dr.update(6);
    expect(dr.scale).toBeGreaterThan(low);
  });

  it('never goes below the floor or above the base scale', () => {
    const dr = new DynamicResolution(60, 1);
    for (let i = 0; i < 2000; i++) dr.update(200);
    expect(dr.scale).toBeGreaterThanOrEqual(dr.min);
    for (let i = 0; i < 4000; i++) dr.update(1);
    expect(dr.scale).toBeLessThanOrEqual(1);
  });

  it('holds a stable scale at exactly the target frame rate', () => {
    const dr = new DynamicResolution(60, 1);
    let changes = 0;
    for (let i = 0; i < 600; i++) if (dr.update(16.7) !== null) changes++;
    expect(changes).toBe(0);
  });
});

// -------------------------------------------------------------- particles

describe('particle system', () => {
  it('spawns, simulates and retires particles', () => {
    const ps = new ParticleSystem(QUALITY.high);
    const q = new THREE.Quaternion();
    ps.burst(0, 1, 0, 30, { life: 0.3 });
    ps.update(1 / 60, q);
    expect(ps.mesh.count).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) ps.update(1 / 60, q);
    expect(ps.mesh.count).toBe(0);
    ps.dispose();
  });

  it('respects the capacity cap', () => {
    const ps = new ParticleSystem(QUALITY.medium);
    for (let i = 0; i < 200; i++) ps.burst(0, 1, 0, 50, { life: 10 });
    ps.update(1 / 60, new THREE.Quaternion());
    expect(ps.mesh.count).toBeLessThanOrEqual(120);
    ps.dispose();
  });

  it('is a no-op when particles are disabled', () => {
    const ps = new ParticleSystem(QUALITY.low);
    ps.burst(0, 1, 0, 50);
    ps.update(1 / 60, new THREE.Quaternion());
    expect(ps.mesh.count).toBe(0);
    ps.dispose();
  });

  it('keeps particles above the mat', () => {
    const ps = new ParticleSystem(QUALITY.ultra);
    const q = new THREE.Quaternion();
    ps.burst(0, 2, 0, 60, { life: 3 });
    for (let i = 0; i < 200; i++) {
      ps.update(1 / 60, q);
      const m = new THREE.Matrix4();
      for (let k = 0; k < ps.mesh.count; k++) {
        ps.mesh.getMatrixAt(k, m);
        const y = m.elements[13];
        expect(y).toBeGreaterThan(-0.01);
      }
    }
    ps.dispose();
  });
});

// ----------------------------------------------------------------- input

describe('input gestures', () => {
  /** Minimal DOM stub — enough for InputManager's listener plumbing. */
  const makeElement = () => {
    const listeners = new Map<string, ((e: unknown) => void)[]>();
    const el = {
      clientWidth: 800,
      clientHeight: 400,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
      addEventListener: (t: string, fn: (e: unknown) => void) => {
        if (!listeners.has(t)) listeners.set(t, []);
        listeners.get(t)!.push(fn);
      },
      removeEventListener: (t: string, fn: (e: unknown) => void) => {
        const arr = listeners.get(t);
        if (arr) listeners.set(t, arr.filter((f) => f !== fn));
      },
    };
    const fire = (type: string, x: number, y: number, id = 1) => {
      for (const fn of listeners.get(type) ?? []) {
        fn({
          pointerId: id,
          clientX: x,
          clientY: y,
          target: null,
          preventDefault: () => {},
          stopPropagation: () => {},
        });
      }
    };
    return { el: el as unknown as HTMLElement, fire };
  };

  it('recognises a swipe on the action half', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('gestures', false, false);
    im.enable();
    const seen: string[] = [];
    im.bus.on('gesture', (g) => seen.push(g.name));

    fire('pointerdown', 600, 200);
    fire('pointermove', 600, 100);
    fire('pointerup', 600, 100);
    expect(seen).toContain('swipe_up');
  });

  it('recognises taps and distinguishes them from swipes', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('gestures', false, false);
    im.enable();
    const seen: string[] = [];
    im.bus.on('gesture', (g) => seen.push(g.name));

    fire('pointerdown', 600, 200);
    fire('pointerup', 601, 201);
    expect(seen).toContain('tap');
    expect(seen).not.toContain('swipe_right');
  });

  it('recognises a circle gesture for reversals', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('gestures', false, false);
    im.enable();
    const seen: string[] = [];
    im.bus.on('gesture', (g) => seen.push(g.name));

    const cx = 600;
    const cy = 200;
    const r = 40;
    fire('pointerdown', cx + r, cy);
    for (let i = 1; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      fire('pointermove', cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    fire('pointerup', cx + r, cy);
    expect(seen).toContain('circle');
  });

  it('drives the virtual stick from the movement half', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('hybrid', false, false);
    im.enable();

    fire('pointerdown', 150, 200);
    expect(im.stick.active).toBe(true);
    fire('pointermove', 210, 200);
    expect(im.stick.x).toBeGreaterThan(0.5);
    expect(Math.abs(im.stick.y)).toBeLessThan(0.2);
    fire('pointerup', 210, 200);
    expect(im.stick.active).toBe(false);
    expect(im.stick.x).toBe(0);
  });

  it('applies a dead zone so resting thumbs do not drift', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('hybrid', false, false);
    im.enable();
    fire('pointerdown', 150, 200);
    fire('pointermove', 153, 202);
    expect(im.stick.x).toBe(0);
    expect(im.stick.y).toBe(0);
  });

  it('clamps the stick vector to unit length', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('hybrid', false, false);
    im.enable();
    fire('pointerdown', 150, 200);
    fire('pointermove', 900, 900);
    expect(Math.hypot(im.stick.x, im.stick.y)).toBeLessThanOrEqual(1.001);
  });

  it('mirrors the stick zone for left-handed players', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('hybrid', true, false);
    im.enable();
    // Right side is now the movement zone.
    fire('pointerdown', 650, 200);
    expect(im.stick.active).toBe(true);
  });

  it('ignores gestures in buttons-only mode', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('buttons', false, false);
    im.enable();
    const seen: string[] = [];
    im.bus.on('gesture', (g) => seen.push(g.name));
    fire('pointerdown', 600, 200);
    fire('pointermove', 600, 100);
    fire('pointerup', 600, 100);
    expect(seen.length).toBe(0);
  });

  it('cleans up on disable', () => {
    const { el, fire } = makeElement();
    const im = new InputManager(el);
    im.configure('hybrid', false, false);
    im.enable();
    fire('pointerdown', 150, 200);
    im.disable();
    expect(im.stick.active).toBe(false);
    const seen: string[] = [];
    im.bus.on('gesture', (g) => seen.push(g.name));
    fire('pointerdown', 600, 200);
    fire('pointerup', 600, 100);
    expect(seen.length).toBe(0);
  });
});
