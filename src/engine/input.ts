import { EventBus } from '../core/events';
import { clamp } from '../core/math';
import type { ControlScheme } from '../game/save/schema';

export type GestureName =
  | 'swipe_up'
  | 'swipe_down'
  | 'swipe_left'
  | 'swipe_right'
  | 'tap'
  | 'double_tap'
  | 'hold_start'
  | 'hold_end'
  | 'circle';

export interface InputEvents {
  gesture: { name: GestureName; x: number; y: number; power: number };
  stick: { x: number; y: number; active: boolean };
  action: { id: string };
}

interface Touch {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startTime: number;
  moved: boolean;
  isStick: boolean;
  holdFired: boolean;
  /** Sampled path for circle detection. */
  path: Array<{ x: number; y: number; t: number }>;
}

const SWIPE_MIN_DIST = 42;
const SWIPE_MAX_TIME = 420;
const TAP_MAX_DIST = 16;
const TAP_MAX_TIME = 260;
const HOLD_TIME = 340;
const DOUBLE_TAP_WINDOW = 300;

/**
 * Mobile input layer: virtual stick on the movement half, gesture recognition
 * on the action half, plus a hook for on-screen buttons. Handles both control
 * schemes and left-handed mirroring.
 */
export class InputManager {
  readonly bus = new EventBus<InputEvents>();
  private el: HTMLElement;
  private touches = new Map<number, Touch>();
  private stickTouch: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lastTapTime = 0;
  private scheme: ControlScheme = 'hybrid';
  private leftHanded = false;
  private enabled = false;
  private holdTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private hapticsEnabled = true;

  /** Live stick vector, -1..1 on each axis. */
  readonly stick = { x: 0, y: 0, active: false };
  readonly stickRadius = 62;
  /** Visual state for the on-screen stick widget. */
  stickVisual = { originX: 0, originY: 0, knobX: 0, knobY: 0, visible: false };

  constructor(element: HTMLElement) {
    this.el = element;
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
  }

  configure(scheme: ControlScheme, leftHanded: boolean, haptics: boolean): void {
    this.scheme = scheme;
    this.leftHanded = leftHanded;
    this.hapticsEnabled = haptics;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.el.addEventListener('pointerdown', this.onDown, { passive: false });
    this.el.addEventListener('pointermove', this.onMove, { passive: false });
    this.el.addEventListener('pointerup', this.onUp, { passive: false });
    this.el.addEventListener('pointercancel', this.onUp, { passive: false });
    // Support keyboard for desktop testing (WASD / arrows + JKLU space).
    this.el.setAttribute?.('tabindex', '0');
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    globalThis.addEventListener?.('keydown', this.onKeyDown);
    globalThis.addEventListener?.('keyup', this.onKeyUp);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    globalThis.removeEventListener?.('keydown', this.onKeyDown);
    globalThis.removeEventListener?.('keyup', this.onKeyUp);
    this.reset();
  }

  reset(): void {
    for (const t of this.holdTimers.values()) clearTimeout(t);
    this.holdTimers.clear();
    this.touches.clear();
    this.stickTouch = null;
    this.stick.x = 0;
    this.stick.y = 0;
    this.stick.active = false;
    this.stickVisual.visible = false;
    this.keys = {};
  }

  haptic(pattern: number | number[] = 12): void {
    if (!this.hapticsEnabled) return;
    try {
      globalThis.navigator?.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }

  // ---------------------------------------------------------------- keyboard
  private keys: Record<string, boolean> = {};
  private onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;
    const k = e.key.toLowerCase();
    this.keys[k] = true;
    // Actions
    if (k === ' ') this.bus.emit('action', { id: 'guard_on' });
    if (k === 'j' || k === 'z') this.bus.emit('action', { id: 'reverse' });
    if (k === 'k' || k === 'x') this.bus.emit('action', { id: 'escape' });
    if (k === 'l' || k === 'c') this.bus.emit('action', { id: 'pin' });
    if (k === 'q') this.bus.emit('gesture', { name: 'swipe_up', x: 0, y: 0, power: 0.8 });
    if (k === 'e') this.bus.emit('gesture', { name: 'swipe_down', x: 0, y: 0, power: 0.8 });
    if (k === '1') this.bus.emit('gesture', { name: 'tap', x: 0, y: 0, power: 0.7 });
    if (k === '2') this.bus.emit('gesture', { name: 'double_tap', x: 0, y: 0, power: 1 });
  }
  private onKeyUp(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    this.keys[k] = false;
    if (k === ' ') this.bus.emit('action', { id: 'guard_off' });
  }

  /** Drive stick from keyboard if no touch active — call each frame. */
  pollKeyboard(): void {
    if (this.stickTouch !== null) return; // touch wins
    let x = 0, y = 0;
    if (this.keys['a'] || this.keys['arrowleft']) x -= 1;
    if (this.keys['d'] || this.keys['arrowright']) x += 1;
    if (this.keys['w'] || this.keys['arrowup']) y -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) y += 1;
    const mag = Math.hypot(x, y);
    if (mag > 0) {
      x /= mag; y /= mag;
      this.stick.x = x * 0.85;
      this.stick.y = y * 0.85;
      this.stick.active = true;
    } else if (this.stick.active && !this.touches.size) {
      this.stick.x = 0;
      this.stick.y = 0;
      this.stick.active = false;
    }
  }

  /** Is this screen coordinate in the movement zone? */
  private isStickZone(x: number): boolean {
    const w = this.el.clientWidth;
    return this.leftHanded ? x > w * 0.5 : x < w * 0.5;
  }

  private onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (target?.closest?.('[data-ui-button]')) return;

    e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const useStick =
      (this.scheme === 'buttons' || this.scheme === 'hybrid') &&
      this.isStickZone(x) &&
      this.stickTouch === null;

    const touch: Touch = {
      id: e.pointerId,
      startX: x,
      startY: y,
      x,
      y,
      startTime: performance.now(),
      moved: false,
      isStick: useStick,
      holdFired: false,
      path: [{ x, y, t: performance.now() }],
    };
    this.touches.set(e.pointerId, touch);

    if (useStick) {
      this.stickTouch = e.pointerId;
      this.stickOrigin = { x, y };
      this.stick.active = true;
      this.stickVisual = { originX: x, originY: y, knobX: x, knobY: y, visible: true };
    } else if (this.scheme !== 'buttons') {
      const timer = setTimeout(() => {
        const t = this.touches.get(e.pointerId);
        if (t && !t.moved) {
          t.holdFired = true;
          this.bus.emit('gesture', { name: 'hold_start', x: t.x, y: t.y, power: 1 });
          this.haptic(8);
        }
      }, HOLD_TIME);
      this.holdTimers.set(e.pointerId, timer);
    }
  }

  private onMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    t.x = e.clientX - rect.left;
    t.y = e.clientY - rect.top;
    const dist = Math.hypot(t.x - t.startX, t.y - t.startY);
    if (dist > TAP_MAX_DIST) t.moved = true;

    if (t.path.length < 64) t.path.push({ x: t.x, y: t.y, t: performance.now() });

    if (t.isStick) {
      const dx = t.x - this.stickOrigin.x;
      const dy = t.y - this.stickOrigin.y;
      const d = Math.hypot(dx, dy);
      const clamped = Math.min(d, this.stickRadius);
      const nx = d > 0.001 ? (dx / d) * (clamped / this.stickRadius) : 0;
      const ny = d > 0.001 ? (dy / d) * (clamped / this.stickRadius) : 0;
      const dead = 0.14;
      const mag = Math.hypot(nx, ny);
      if (mag < dead) {
        this.stick.x = 0;
        this.stick.y = 0;
      } else {
        const scaled = (mag - dead) / (1 - dead);
        this.stick.x = (nx / mag) * scaled;
        this.stick.y = (ny / mag) * scaled;
      }
      this.stickVisual.knobX = this.stickOrigin.x + (d > 0 ? (dx / d) * clamped : 0);
      this.stickVisual.knobY = this.stickOrigin.y + (d > 0 ? (dy / d) * clamped : 0);
      this.bus.emit('stick', { x: this.stick.x, y: this.stick.y, active: true });
    }
  }

  private onUp(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    const timer = this.holdTimers.get(e.pointerId);
    if (timer) {
      clearTimeout(timer);
      this.holdTimers.delete(e.pointerId);
    }

    if (t.isStick) {
      this.stickTouch = null;
      this.stick.x = 0;
      this.stick.y = 0;
      this.stick.active = false;
      this.stickVisual.visible = false;
      this.bus.emit('stick', { x: 0, y: 0, active: false });
      return;
    }

    if (t.holdFired) {
      this.bus.emit('gesture', { name: 'hold_end', x: t.x, y: t.y, power: 1 });
      return;
    }

    if (this.scheme === 'buttons') return;

    const dt = performance.now() - t.startTime;
    const dx = t.x - t.startX;
    const dy = t.y - t.startY;
    const dist = Math.hypot(dx, dy);

    if (dist < 90 && t.path.length > 10 && this.detectCircle(t.path)) {
      this.bus.emit('gesture', { name: 'circle', x: t.x, y: t.y, power: 1 });
      this.haptic([10, 30, 10]);
      return;
    }

    if (dist >= SWIPE_MIN_DIST && dt <= SWIPE_MAX_TIME) {
      const power = clamp(dist / 180, 0.35, 1);
      const name: GestureName =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? 'swipe_right'
            : 'swipe_left'
          : dy > 0
            ? 'swipe_down'
            : 'swipe_up';
      this.bus.emit('gesture', { name, x: t.x, y: t.y, power });
      this.haptic(Math.round(8 + power * 14));
      return;
    }

    if (dist <= TAP_MAX_DIST && dt <= TAP_MAX_TIME) {
      const now = performance.now();
      if (now - this.lastTapTime < DOUBLE_TAP_WINDOW) {
        this.bus.emit('gesture', { name: 'double_tap', x: t.x, y: t.y, power: 1 });
        this.lastTapTime = 0;
        this.haptic([8, 20, 8]);
      } else {
        this.lastTapTime = now;
        this.bus.emit('gesture', { name: 'tap', x: t.x, y: t.y, power: 1 });
        this.haptic(6);
      }
    }
  }

  /**
   * Circle detection: total signed angular travel around the path centroid
   * exceeding ~300°.
   */
  private detectCircle(path: Array<{ x: number; y: number }>): boolean {
    let cx = 0;
    let cy = 0;
    for (const p of path) {
      cx += p.x;
      cy += p.y;
    }
    cx /= path.length;
    cy /= path.length;

    let total = 0;
    let prev = Math.atan2(path[0].y - cy, path[0].x - cx);
    let minR = Infinity;
    let maxR = 0;
    for (let i = 1; i < path.length; i++) {
      const a = Math.atan2(path[i].y - cy, path[i].x - cx);
      let d = a - prev;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      total += d;
      prev = a;
      const r = Math.hypot(path[i].x - cx, path[i].y - cy);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    const roundness = minR / Math.max(1, maxR);
    return Math.abs(total) > 5.2 && roundness > 0.32 && maxR > 18;
  }

  /** Fire an action from an on-screen button. */
  pressButton(id: string): void {
    this.bus.emit('action', { id });
    this.haptic(10);
  }
}
