import * as THREE from 'three';
import { clamp01, damp, dampAngle } from '../core/math';
import type { ArenaId } from '../game/data/leagues';
import type { FighterState, Side } from '../game/sim/types';
import { Arena } from './arena';
import { CameraDirector, type CameraMode } from './camera';
import { DamageNumbers, ParticleSystem, ScreenEffects } from './effects';
import { DynamicResolution, QUALITY, type QualityProfile } from './quality';
import { Animator, buildWrestler, clipForMove, type ClipName, type Rig } from './wrestler';
import type { GraphicsPreset } from '../game/save/schema';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  preset: GraphicsPreset;
  targetFps: 30 | 60;
  dynamicResolution: boolean;
  showDamageNumbers: boolean;
  cameraShake: number;
}

interface Actor {
  rig: Rig;
  anim: Animator;
  dispose: () => void;
  /** Smoothed world transform. */
  x: number;
  z: number;
  facing: number;
  /** Body height for spawning effects at the right place. */
  height: number;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  renderScale: number;
}

/**
 * The 3D presentation layer. Reads simulation state each frame and renders it.
 * Never mutates gameplay state — that keeps the sim deterministic.
 */
export class GameRenderer {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly director: CameraDirector;
  private quality: QualityProfile;
  private arena: Arena | null = null;
  private actors: Record<Side, Actor | null> = { player: null, opponent: null };
  private particles: ParticleSystem;
  private screen: ScreenEffects;
  private damageNumbers: DamageNumbers;
  private dynRes: DynamicResolution;
  private canvas: HTMLCanvasElement;
  private baseScale: number;
  private pixelRatio = 1;
  private disposed = false;
  private frameTimes: number[] = [];
  private lastStatsUpdate = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private timeScale = 1;
  private timeScaleTarget = 1;
  private hurtLevel = 0;

  stats: FrameStats = { fps: 60, frameMs: 16, drawCalls: 0, triangles: 0, renderScale: 1 };

  constructor(opts: RendererOptions) {
    this.canvas = opts.canvas;
    this.quality = QUALITY[opts.preset];

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: this.quality.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
      // Preserve nothing — saves bandwidth on tiled mobile GPUs.
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x04060b, 1);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = this.quality.softShadows
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.baseScale = this.quality.renderScale;
    this.pixelRatio = Math.min(globalThis.devicePixelRatio ?? 1, this.quality.maxPixelRatio);
    this.dynRes = new DynamicResolution(opts.targetFps, this.baseScale);
    if (!opts.dynamicResolution) this.dynRes.scale = this.baseScale;

    this.director = new CameraDirector(this.aspect);
    this.director.shakeScale = opts.cameraShake;

    this.particles = new ParticleSystem(this.quality);
    this.scene.add(this.particles.mesh);
    this.screen = new ScreenEffects(this.quality);
    this.damageNumbers = new DamageNumbers(opts.showDamageNumbers);
    this.scene.add(this.damageNumbers.group);

    this.scene.fog = new THREE.FogExp2(0x05070d, 0.028);
    this.resize();
  }

  private get aspect(): number {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    return w / h;
  }

  // -------------------------------------------------------------- lifecycle

  loadArena(id: ArenaId): void {
    this.arena?.dispose();
    if (this.arena) this.scene.remove(this.arena.group);
    this.arena = new Arena(id, this.quality);
    this.scene.add(this.arena.group);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(this.arena.def.mood.fogColor);
    fog.density = this.arena.def.mood.fogDensity;
    this.renderer.setClearColor(this.arena.def.mood.fogColor, 1);
  }

  spawnFighter(
    side: Side,
    look: { tint: number; trunks: number; height?: number; bulk?: number },
  ): void {
    this.despawn(side);
    const height = look.height ?? 1.0;
    const built = buildWrestler(
      {
        height,
        bulk: look.bulk ?? 1.0,
        skin: side === 'player' ? 0xc98a5e : 0xb8794f,
        trunks: look.trunks,
        accent: look.tint,
      },
      this.quality,
    );
    const anim = new Animator(built.rig);
    anim.play('stance');
    anim.snap();
    this.scene.add(built.rig.root);
    this.actors[side] = {
      rig: built.rig,
      anim,
      dispose: built.dispose,
      x: side === 'player' ? -1 : 1,
      z: 0,
      facing: 0,
      height: height * 1.7,
    };
  }

  private despawn(side: Side): void {
    const a = this.actors[side];
    if (!a) return;
    this.scene.remove(a.rig.root);
    a.dispose();
    this.actors[side] = null;
  }

  setQuality(preset: GraphicsPreset): void {
    if (this.quality.id === preset) return;
    this.quality = QUALITY[preset];
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = this.quality.softShadows
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    this.baseScale = this.quality.renderScale;
    this.pixelRatio = Math.min(globalThis.devicePixelRatio ?? 1, this.quality.maxPixelRatio);
    this.dynRes = new DynamicResolution(this.dynResTarget, this.baseScale);
    // Rebuild quality-dependent content.
    const arenaId = this.arena?.def.id;
    this.particles.dispose();
    this.scene.remove(this.particles.mesh);
    this.particles = new ParticleSystem(this.quality);
    this.scene.add(this.particles.mesh);
    this.screen.dispose();
    this.screen = new ScreenEffects(this.quality);
    if (arenaId) this.loadArena(arenaId);
    this.resize();
  }

  private dynResTarget = 60;
  setTargetFps(fps: 30 | 60): void {
    this.dynResTarget = fps;
    this.dynRes.setTarget(fps);
  }

  setCameraShake(scale: number): void {
    this.director.shakeScale = scale;
  }

  resize(): void {
    const w = this.canvas.clientWidth || globalThis.innerWidth || 800;
    const h = this.canvas.clientHeight || globalThis.innerHeight || 600;
    const scale = this.pixelRatio * this.dynRes.scale;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.floor(w * scale), Math.floor(h * scale), false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.director.resize(w / h);
    this.stats.renderScale = scale;
  }

  // ---------------------------------------------------------------- effects

  impact(side: Side, strength: number, color = 0xfff0c0): void {
    const a = this.actors[side];
    if (!a) return;
    this.director.addShake(strength * 0.55);
    this.screen.impactFlash(clamp01(strength * 0.22), color);
    a.anim.addImpact(strength * 0.5, side === 'player' ? -1 : 1);
    this.particles.burst(a.x, 1.1, a.z, Math.round(6 + strength * 12), {
      speed: 2 + strength * 2.6,
      color,
      life: 0.45,
      size: 0.9 + strength * 0.4,
    });
  }

  showDamage(side: Side, amount: number, critical: boolean): void {
    const a = this.actors[side];
    if (!a) return;
    this.damageNumbers.spawn(
      a.x + (Math.random() - 0.5) * 0.3,
      1.5,
      a.z,
      critical ? `${Math.round(amount)}!` : `${Math.round(amount)}`,
      critical ? '#ffd24a' : '#ff6b5b',
      critical ? 1.35 : 1,
    );
  }

  sweat(side: Side): void {
    if (!this.quality.sweatParticles) return;
    const a = this.actors[side];
    if (!a) return;
    this.particles.burst(a.x, 1.5, a.z, 3, {
      speed: 1.2,
      color: 0x9fd8ff,
      life: 0.7,
      size: 0.5,
      up: 0.9,
    });
  }

  /** Dust/sand kick-up on a mat slam. Pass a side or explicit (x,z). */
  matDust(sideOrX: Side | number, zOrStrength?: number, strength = 1): void {
    let x: number;
    let z: number;
    let s: number;
    if (typeof sideOrX === 'string') {
      const a = this.actors[sideOrX];
      if (!a) return;
      x = a.x;
      z = a.z;
      s = (zOrStrength as number | undefined) ?? 1;
    } else {
      x = sideOrX;
      z = zOrStrength as number;
      s = strength;
    }
    const count = Math.round(14 * s);
    this.particles.burst(x, 0.08, z, count, {
      speed: 2.8 * s,
      color: 0xd9b48a,
      life: 0.9,
      size: 1.3,
      up: 0.35,
    });
    this.particles.burst(x, 0.08, z, Math.round(6 * s), {
      speed: 4.2 * s,
      color: 0xfff3c4,
      life: 0.5,
      size: 0.7,
      up: 0.6,
    });
  }

  celebrate(): void {
    this.particles.confetti(140);
    this.screen.impactFlash(0.5, 0xffe9a8);
  }

  slowmo(duration = 1.2, scale = 0.35): void {
    this.timeScaleTarget = scale;
    this.screen.slowmo = 1;
    globalThis.setTimeout(() => {
      this.timeScaleTarget = 1;
    }, duration * 1000);
  }

  setCameraMode(mode: CameraMode, hold = 0): void {
    this.director.setMode(mode, hold);
  }

  playClip(side: Side, clip: string, opts?: { speed?: number; fade?: number }): void {
    const a = this.actors[side];
    if (!a) return;
    a.anim.play(clipForMove(clip), { ...opts, restart: true });
  }

  get timeScaleValue(): number {
    return this.timeScale;
  }

  // ----------------------------------------------------------------- update

  /**
   * @param dtRaw real elapsed seconds
   * @param states current fighter states from the sim
   * @param crowd crowd intensity 0..1
   */
  render(
    dtRaw: number,
    states: { player: FighterState; opponent: FighterState } | null,
    crowd: number,
  ): void {
    if (this.disposed) return;
    const t0 = performance.now();

    this.timeScale = damp(this.timeScale, this.timeScaleTarget, 8, dtRaw);
    const dt = Math.min(dtRaw, 1 / 20);

    if (states) {
      this.syncActor('player', states.player, dt);
      this.syncActor('opponent', states.opponent, dt);
      const p = states.player;
      this.hurtLevel = damp(this.hurtLevel, 1 - clamp01(p.health / p.maxHealth), 3, dt);
      this.screen.setHurt(this.hurtLevel * 0.8);
    }

    this.arena?.update(dt, crowd);
    this.particles.update(dt, this.director.camera.quaternion);
    this.damageNumbers.update(dt);
    this.screen.update(dt);

    const a = this.actors.player;
    const b = this.actors.opponent;
    this.tmpA.set(a?.x ?? -1, 1, a?.z ?? 0);
    this.tmpB.set(b?.x ?? 1, 1, b?.z ?? 0);
    this.director.update(dt, this.tmpA, this.tmpB, a?.facing ?? 0);

    this.renderer.info.reset();
    this.renderer.render(this.scene, this.director.camera);
    this.screen.render(this.renderer);

    // ----- perf accounting + dynamic resolution
    const frameMs = performance.now() - t0;
    this.frameTimes.push(dtRaw * 1000);
    if (this.frameTimes.length > 90) this.frameTimes.shift();

    const newScale = this.dynRes.update(dtRaw * 1000);
    if (newScale !== null) this.resize();

    if (t0 - this.lastStatsUpdate > 400) {
      this.lastStatsUpdate = t0;
      const avg = this.frameTimes.reduce((s, v) => s + v, 0) / Math.max(1, this.frameTimes.length);
      this.stats.fps = Math.round(1000 / Math.max(0.001, avg));
      this.stats.frameMs = Math.round(frameMs * 100) / 100;
      this.stats.drawCalls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
    }
  }

  private syncActor(side: Side, f: FighterState, dt: number): void {
    const a = this.actors[side];
    if (!a) return;

    a.x = damp(a.x, f.x, 9, dt);
    a.z = damp(a.z, f.z, 9, dt);
    a.facing = dampAngle(a.facing, f.facing, 10, dt);
    a.rig.root.position.set(a.x, 0, a.z);
    a.rig.root.rotation.y = a.facing;

    // Choose the clip from the sim state.
    const clip = this.clipFor(f);
    if (a.anim.clip !== clip) {
      const fast = f.phase === 'windup' || f.phase === 'active';
      a.anim.play(clip, { fade: fast ? 0.07 : 0.18, restart: fast });
    }

    // Fatigued athletes breathe harder and move slower.
    const staminaRatio = f.stamina / f.maxStamina;
    if (staminaRatio < 0.3 && Math.random() < dt * 2.4) this.sweat(side);

    a.anim.update(dt * this.timeScale);
  }

  private clipFor(f: FighterState): ClipName {
    if (f.phase === 'downed' || f.downedTimer > 0) return 'down';
    if (f.move && (f.phase === 'windup' || f.phase === 'active' || f.phase === 'recovery')) {
      return clipForMove(f.move.clip);
    }
    if (f.phase === 'stunned') return 'hit';
    if (f.phase === 'blocking' || f.guarding) return 'guard';
    if (f.stamina < f.maxStamina * 0.18) return 'exhausted';
    return 'stance';
  }

  /** Idle render loop for menus — spins a hero model. */
  renderMenu(dt: number): void {
    if (this.disposed) return;
    const a = this.actors.player;
    if (a) {
      a.rig.root.rotation.y += dt * 0.35;
      a.anim.update(dt);
    }
    this.arena?.update(dt, 0.12);
    this.particles.update(dt, this.director.camera.quaternion);
    this.screen.update(dt);
    this.renderer.render(this.scene, this.director.camera);
    this.screen.render(this.renderer);
  }

  clearFighters(): void {
    this.despawn('player');
    this.despawn('opponent');
    this.particles.clear();
    this.damageNumbers.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.clearFighters();
    this.arena?.dispose();
    this.particles.dispose();
    this.screen.dispose();
    this.damageNumbers.dispose();
    this.renderer.dispose();
  }
}
