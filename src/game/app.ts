import { EventBus } from '../core/events';
import { audio } from '../engine/audio';
import { InputManager } from '../engine/input';
import { GameRenderer } from '../engine/renderer';
import { probeDevice, recommendPreset, type DeviceCaps } from '../engine/quality';
import { evaluateAchievements } from './career/achievements';
import { SaveManager } from './save/storage';
import type { SaveGame, ScreenId } from './save/schema';
import { toast } from '../ui/toast';

export interface AppEvents {
  screen: { id: ScreenId; params?: Record<string, unknown> };
  saveChanged: { save: SaveGame };
  achievement: { id: string; name: string; icon: string; coins: number };
}

/**
 * Application shell: owns the save, the renderer, audio, input, the main loop
 * and screen routing. Screens are plain modules that render into #ui-root.
 */
export class App {
  readonly bus = new EventBus<AppEvents>();
  readonly saves = new SaveManager();
  readonly input: InputManager;
  readonly caps: DeviceCaps;
  renderer!: GameRenderer;

  save: SaveGame | null = null;
  /** Live match controller while a match screen is mounted (read-only use). */
  activeMatch: { sim: unknown } | null = null;
  currentScreen: ScreenId = 'onboarding';
  uiRoot: HTMLElement;
  canvas: HTMLCanvasElement;

  private rafId = 0;
  private lastFrame = 0;
  private frameCb: ((dt: number) => void) | null = null;
  private playTimeAccum = 0;
  private visible = true;
  private showPerf = false;
  private perfNode: HTMLElement | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.caps = probeDevice();
    this.input = new InputManager(canvas);
  }

  async boot(onProgress: (pct: number, label: string) => void): Promise<void> {
    onProgress(0.1, 'Probing device…');
    await this.saves.init();

    onProgress(0.3, 'Loading career…');
    const existing = await this.saves.load();
    if (existing) {
      this.save = existing;
      this.saves.attach(existing);
    }

    const preset = this.save?.settings.manualGraphics
      ? this.save.settings.graphics
      : recommendPreset(this.caps);

    if (this.save && !this.save.settings.manualGraphics) {
      this.save.settings.graphics = preset;
      this.save.settings.autoDetected = preset;
    }

    onProgress(0.55, 'Compiling shaders…');
    this.renderer = new GameRenderer({
      canvas: this.canvas,
      preset,
      targetFps: this.save?.settings.targetFps ?? 60,
      dynamicResolution: this.save?.settings.dynamicResolution ?? true,
      showDamageNumbers: this.save?.settings.showDamageNumbers ?? true,
      cameraShake: this.save?.settings.cameraShake ?? 1,
    });

    onProgress(0.78, 'Building arena…');
    this.renderer.loadArena('training_hall');

    onProgress(0.9, 'Warming up…');
    this.applyInputSettings();
    this.attachLifecycle();
    this.startLoop();

    // Let one frame render so the arena is visible behind the menus.
    await new Promise((r) => globalThis.setTimeout(r, 60));
    onProgress(1, 'Ready');
  }

  // ------------------------------------------------------------- lifecycle

  private lifecycleAttached = false;

  /**
   * Install global listeners (resize, visibility, Android back button).
   * Idempotent so it is safe to call from boot and from tests.
   */
  attachLifecycle(): void {
    if (this.lifecycleAttached) return;
    this.lifecycleAttached = true;
    globalThis.addEventListener('resize', () => this.renderer.resize());
    globalThis.addEventListener('orientationchange', () =>
      globalThis.setTimeout(() => this.renderer.resize(), 220),
    );

    document.addEventListener('visibilitychange', () => {
      this.visible = document.visibilityState === 'visible';
      if (!this.visible) {
        audio.suspend();
        void this.saves.flush('Auto-saved on exit');
      } else {
        void audio.resume();
      }
    });

    // Android back button (Capacitor) + browser back.
    globalThis.addEventListener('popstate', () => this.handleBack());
    document.addEventListener('backbutton', () => this.handleBack());
    globalThis.addEventListener('pagehide', () => {
      void this.saves.flush('Auto-saved');
    });
  }

  private backHandler: (() => boolean) | null = null;

  /** Screens register a back handler; returning true swallows the event. */
  setBackHandler(fn: (() => boolean) | null): void {
    this.backHandler = fn;
  }

  private handleBack(): void {
    if (this.backHandler?.()) return;
    if (this.currentScreen !== 'hub' && this.currentScreen !== 'onboarding') {
      this.go('hub');
    }
  }

  // ------------------------------------------------------------- main loop

  private startLoop(): void {
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      if (!this.visible) return;

      const dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 1 / 60);
      this.lastFrame = now;

      if (this.frameCb) this.frameCb(dt);
      else this.renderer.renderMenu(dt);

      // Track playtime for the profile screen.
      this.playTimeAccum += dt;
      if (this.playTimeAccum > 30 && this.save) {
        this.save.stats.totalPlaySeconds += this.playTimeAccum;
        this.playTimeAccum = 0;
        this.saves.queue('Autosave');
      }

      if (this.showPerf) this.updatePerfHud();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Screens with their own update logic install a frame callback. */
  setFrameCallback(cb: ((dt: number) => void) | null): void {
    this.frameCb = cb;
  }

  stopLoop(): void {
    cancelAnimationFrame(this.rafId);
  }

  // --------------------------------------------------------------- routing

  private screenRenderers = new Map<ScreenId, (app: App, params?: Record<string, unknown>) => void>();

  registerScreen(id: ScreenId, fn: (app: App, params?: Record<string, unknown>) => void): void {
    this.screenRenderers.set(id, fn);
  }

  go(id: ScreenId, params?: Record<string, unknown>): void {
    this.setFrameCallback(null);
    this.setBackHandler(null);
    this.input.disable();
    this.input.reset();
    this.currentScreen = id;

    // Persist the resume point for anything that isn't transient.
    if (this.save && id !== 'match' && id !== 'results' && id !== 'onboarding') {
      this.save.checkpoint.screen = id;
      this.saves.queue('Autosave');
    }

    const fn = this.screenRenderers.get(id);
    if (!fn) {
      console.warn(`No renderer for screen: ${id}`);
      return;
    }
    this.uiRoot.replaceChildren();
    fn(this, params);
    this.bus.emit('screen', { id, params });
  }

  mount(node: HTMLElement): void {
    this.uiRoot.appendChild(node);
  }

  // ---------------------------------------------------------------- saving

  requireSave(): SaveGame {
    if (!this.save) throw new Error('No active save');
    return this.save;
  }

  async createCareer(name: string): Promise<SaveGame> {
    const save = await this.saves.create(name);
    save.settings.graphics = recommendPreset(this.caps);
    save.settings.autoDetected = save.settings.graphics;
    this.save = save;
    this.applyAudioSettings();
    this.applyInputSettings();
    await this.saves.flush('Career created');
    this.bus.emit('saveChanged', { save });
    return save;
  }

  /** Persist and run achievement checks. Call after every meaningful action. */
  async commit(label = 'Autosave'): Promise<void> {
    if (!this.save) return;
    const fresh = evaluateAchievements(this.save);
    await this.saves.flush(label);
    this.bus.emit('saveChanged', { save: this.save });
    for (const a of fresh) {
      audio.play('unlock');
      toast.show(`${a.name} — +${a.coins} coins`, 'gold', 3400, a.icon);
      this.bus.emit('achievement', { id: a.id, name: a.name, icon: a.icon, coins: a.coins });
    }
  }

  queueSave(label = 'Autosave'): void {
    this.saves.queue(label);
  }

  // -------------------------------------------------------------- settings

  applyAudioSettings(): void {
    if (!this.save) return;
    const s = this.save.settings;
    audio.applySettings({
      master: s.masterVolume,
      music: s.musicVolume,
      sfx: s.sfxVolume,
      crowd: s.crowdVolume,
      commentary: s.commentary,
    });
  }

  applyInputSettings(): void {
    if (!this.save) {
      this.input.configure('hybrid', false, true);
      return;
    }
    const s = this.save.settings;
    this.input.configure(s.controls, s.leftHanded, s.haptics);
  }

  applyGraphicsSettings(): void {
    if (!this.save) return;
    const s = this.save.settings;
    this.renderer.setQuality(s.graphics);
    this.renderer.setTargetFps(s.targetFps);
    this.renderer.setCameraShake(s.cameraShake);
  }

  togglePerfHud(on?: boolean): void {
    this.showPerf = on ?? !this.showPerf;
    if (!this.showPerf) {
      this.perfNode?.remove();
      this.perfNode = null;
    }
  }

  get perfVisible(): boolean {
    return this.showPerf;
  }

  private updatePerfHud(): void {
    if (!this.perfNode) {
      this.perfNode = document.createElement('div');
      this.perfNode.className = 'perf-hud';
      this.uiRoot.appendChild(this.perfNode);
    }
    if (!this.perfNode.isConnected) this.uiRoot.appendChild(this.perfNode);
    const s = this.renderer.stats;
    this.perfNode.textContent = `${s.fps} FPS · ${s.frameMs}ms\n${s.drawCalls} calls · ${(s.triangles / 1000).toFixed(1)}k tris\nscale ${s.renderScale.toFixed(2)}`;
    this.perfNode.style.whiteSpace = 'pre';
  }
}
