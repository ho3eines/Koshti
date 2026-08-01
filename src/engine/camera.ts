import * as THREE from 'three';
import { damp, clamp01, lerp } from '../core/math';
import { Rng } from '../core/rng';

export type CameraMode = 'broadcast' | 'closeup' | 'ground' | 'cinematic_intro' | 'finisher' | 'victory' | 'free';

interface Shot {
  /** Offset from the action midpoint, in the action's local space. */
  offset: THREE.Vector3;
  lookOffset: THREE.Vector3;
  fov: number;
  /** How tightly the camera tracks (higher = snappier). */
  lambda: number;
}

const SHOTS: Record<CameraMode, Shot> = {
  broadcast: {
    offset: new THREE.Vector3(0, 3.1, 6.4),
    lookOffset: new THREE.Vector3(0, 1.0, 0),
    fov: 52,
    lambda: 3.2,
  },
  closeup: {
    offset: new THREE.Vector3(1.6, 1.85, 3.5),
    lookOffset: new THREE.Vector3(0, 1.15, 0),
    fov: 42,
    lambda: 5.5,
  },
  ground: {
    offset: new THREE.Vector3(-1.2, 1.5, 3.9),
    lookOffset: new THREE.Vector3(0, 0.4, 0),
    fov: 46,
    lambda: 4.4,
  },
  cinematic_intro: {
    offset: new THREE.Vector3(0, 2.2, 7.5),
    lookOffset: new THREE.Vector3(0, 1.2, 0),
    fov: 38,
    lambda: 1.4,
  },
  finisher: {
    offset: new THREE.Vector3(2.4, 1.6, 2.9),
    lookOffset: new THREE.Vector3(0, 1.0, 0),
    fov: 36,
    lambda: 6.5,
  },
  victory: {
    offset: new THREE.Vector3(0, 2.0, 4.4),
    lookOffset: new THREE.Vector3(0, 1.3, 0),
    fov: 44,
    lambda: 2.2,
  },
  free: {
    offset: new THREE.Vector3(0, 3.0, 6.0),
    lookOffset: new THREE.Vector3(0, 1.0, 0),
    fov: 50,
    lambda: 3.0,
  },
};

/**
 * Cinematic camera director. Picks shots based on match state, orbits during
 * intros, punches in for finishers, and adds handheld shake for weight.
 */
export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'broadcast';
  private pos = new THREE.Vector3(0, 3.1, 6.4);
  private look = new THREE.Vector3(0, 1, 0);
  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private shake = 0;
  private shakeDecay = 3.4;
  private rng = new Rng(1337);
  private time = 0;
  private orbit = 0;
  private modeTimer = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  /** User-controlled orbit offset (free camera / replays). */
  userYaw = 0;
  userPitch = 0;
  shakeScale = 1;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 200);
    this.camera.position.copy(this.pos);
  }

  setMode(mode: CameraMode, holdSeconds = 0): void {
    if (this.mode === mode) {
      this.modeTimer = Math.max(this.modeTimer, holdSeconds);
      return;
    }
    this.mode = mode;
    this.modeTimer = holdSeconds;
    this.orbit = 0;
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  addShake(strength: number): void {
    this.shake = Math.min(2.2, this.shake + strength * this.shakeScale);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param a  first fighter world position
   * @param b  second fighter world position
   * @param heroSide which fighter is the "hero" for framing (+1 = b, -1 = a)
   */
  update(dt: number, a: THREE.Vector3, b: THREE.Vector3, heroFacing: number): void {
    this.time += dt;
    if (this.modeTimer > 0) {
      this.modeTimer -= dt;
      if (this.modeTimer <= 0 && (this.mode === 'finisher' || this.mode === 'closeup')) {
        this.mode = 'broadcast';
      }
    }

    const shot = SHOTS[this.mode];

    // Midpoint of the action, biased slightly toward the hero.
    const mid = this.tmpA.copy(a).add(b).multiplyScalar(0.5);
    const spread = this.tmpB.copy(a).sub(b).length();

    // Orient the shot around the axis between the fighters so we always see
    // the action side-on — never through a wrestler's back.
    const axis = Math.atan2(b.x - a.x, b.z - a.z);
    const viewAngle = axis + Math.PI / 2 + this.userYaw;

    if (this.mode === 'cinematic_intro') this.orbit += dt * 0.42;
    if (this.mode === 'victory') this.orbit += dt * 0.28;

    const angle = viewAngle + this.orbit;
    const dist = shot.offset.z + spread * 0.35;
    const height = shot.offset.y + this.userPitch;

    this.targetPos.set(
      mid.x + Math.sin(angle) * dist + Math.cos(angle) * shot.offset.x,
      mid.y + height,
      mid.z + Math.cos(angle) * dist - Math.sin(angle) * shot.offset.x,
    );
    this.targetLook.set(
      mid.x + shot.lookOffset.x,
      mid.y + shot.lookOffset.y,
      mid.z + shot.lookOffset.z,
    );

    // Slight lead in the direction the hero is facing — feels intentional.
    this.targetLook.x += Math.sin(heroFacing) * 0.18;
    this.targetLook.z += Math.cos(heroFacing) * 0.18;

    this.pos.x = damp(this.pos.x, this.targetPos.x, shot.lambda, dt);
    this.pos.y = damp(this.pos.y, this.targetPos.y, shot.lambda, dt);
    this.pos.z = damp(this.pos.z, this.targetPos.z, shot.lambda, dt);
    this.look.x = damp(this.look.x, this.targetLook.x, shot.lambda * 1.3, dt);
    this.look.y = damp(this.look.y, this.targetLook.y, shot.lambda * 1.3, dt);
    this.look.z = damp(this.look.z, this.targetLook.z, shot.lambda * 1.3, dt);

    // Handheld breathing so the frame is never dead-still.
    const breathe = Math.sin(this.time * 0.7) * 0.014 + Math.sin(this.time * 1.31) * 0.008;

    // Impact shake.
    let sx = 0;
    let sy = 0;
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.16;
      sx = this.rng.range(-s, s);
      sy = this.rng.range(-s, s);
      this.shake = Math.max(0, this.shake - dt * this.shakeDecay);
    }

    this.camera.position.set(this.pos.x + sx, this.pos.y + sy + breathe, this.pos.z);
    this.camera.lookAt(this.look);

    const targetFov = shot.fov + clamp01(spread / 4) * 5;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.exp(-3.5 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Instantly place the camera (no easing) — used on match start.
   * Iterates long enough for the exponential smoothing to fully converge,
   * otherwise the first frames of a match visibly drift into place.
   */
  snap(a: THREE.Vector3, b: THREE.Vector3): void {
    const heldMode = this.modeTimer;
    this.modeTimer = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 180; i++) this.update(1 / 60, a, b, 0);
    this.modeTimer = heldMode;
    this.shake = 0;
  }
}
