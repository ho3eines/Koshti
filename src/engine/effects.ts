import * as THREE from 'three';
import { clamp01 } from '../core/math';
import type { QualityProfile } from './quality';

/**
 * GPU particle pool for impacts, sweat and confetti. One InstancedMesh,
 * zero per-frame allocation, additive blending for punch.
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private capacity: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private active = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private geo: THREE.BufferGeometry;
  private mat: THREE.Material;
  private enabled: boolean;

  constructor(quality: QualityProfile) {
    this.enabled = quality.particles;
    this.capacity = quality.particles ? (quality.id === 'ultra' ? 420 : quality.id === 'high' ? 260 : 120) : 1;
    this.geo = new THREE.PlaneGeometry(0.09, 0.09);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3),
      3,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;

    this.pos = new Float32Array(this.capacity * 3);
    this.vel = new Float32Array(this.capacity * 3);
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);
    this.size = new Float32Array(this.capacity);
  }

  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    opts: { speed?: number; color?: number; life?: number; size?: number; up?: number } = {},
  ): void {
    if (!this.enabled) return;
    const speed = opts.speed ?? 3.2;
    const life = opts.life ?? 0.55;
    const size = opts.size ?? 1;
    const up = opts.up ?? 0.6;
    this.color.setHex(opts.color ?? 0xfff0c0);

    for (let i = 0; i < count && this.active < this.capacity; i++) {
      const idx = this.active++;
      this.pos[idx * 3] = x;
      this.pos[idx * 3 + 1] = y;
      this.pos[idx * 3 + 2] = z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.6;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[idx * 3] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[idx * 3 + 1] = Math.cos(phi) * s * up + 0.6;
      this.vel[idx * 3 + 2] = Math.sin(phi) * Math.sin(theta) * s;
      this.life[idx] = life * (0.7 + Math.random() * 0.6);
      this.maxLife[idx] = this.life[idx];
      this.size[idx] = size * (0.6 + Math.random() * 0.8);
      this.mesh.setColorAt(idx, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Rising confetti for victory scenes. */
  confetti(count: number): void {
    if (!this.enabled) return;
    const colors = [0xff5d47, 0x38bdf8, 0xfbbf24, 0x4ade80, 0xc084fc];
    for (let i = 0; i < count && this.active < this.capacity; i++) {
      const idx = this.active++;
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 6;
      this.pos[idx * 3] = Math.cos(a) * r;
      this.pos[idx * 3 + 1] = 7 + Math.random() * 3;
      this.pos[idx * 3 + 2] = Math.sin(a) * r;
      this.vel[idx * 3] = (Math.random() - 0.5) * 0.8;
      this.vel[idx * 3 + 1] = -0.7 - Math.random() * 0.7;
      this.vel[idx * 3 + 2] = (Math.random() - 0.5) * 0.8;
      this.life[idx] = 4 + Math.random() * 3;
      this.maxLife[idx] = this.life[idx];
      this.size[idx] = 1.6 + Math.random();
      this.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
      this.mesh.setColorAt(idx, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, cameraQuat: THREE.Quaternion): void {
    if (!this.enabled || this.active === 0) {
      this.mesh.count = 0;
      return;
    }
    let write = 0;
    for (let i = 0; i < this.active; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;

      const i3 = i * 3;
      this.vel[i3 + 1] -= 9.4 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      // Bounce off the mat.
      if (this.pos[i3 + 1] < 0.03) {
        this.pos[i3 + 1] = 0.03;
        this.vel[i3 + 1] *= -0.28;
        this.vel[i3] *= 0.7;
        this.vel[i3 + 2] *= 0.7;
      }

      if (write !== i) {
        for (let k = 0; k < 3; k++) {
          this.pos[write * 3 + k] = this.pos[i3 + k];
          this.vel[write * 3 + k] = this.vel[i3 + k];
        }
        this.life[write] = this.life[i];
        this.maxLife[write] = this.maxLife[i];
        this.size[write] = this.size[i];
        if (this.mesh.instanceColor) {
          const c = this.mesh.instanceColor.array as Float32Array;
          c[write * 3] = c[i3];
          c[write * 3 + 1] = c[i3 + 1];
          c[write * 3 + 2] = c[i3 + 2];
        }
      }

      const t = clamp01(this.life[write] / this.maxLife[write]);
      const s = this.size[write] * (0.35 + t * 0.85);
      this.dummy.position.set(this.pos[write * 3], this.pos[write * 3 + 1], this.pos[write * 3 + 2]);
      this.dummy.quaternion.copy(cameraQuat);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(write, this.dummy.matrix);
      write++;
    }
    this.active = write;
    this.mesh.count = write;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.active = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Full-screen impact flash + vignette + speed lines, done as a cheap
 * fullscreen quad rather than a full post-processing stack (mobile budget).
 */
export class ScreenEffects {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private geo: THREE.PlaneGeometry;
  flash = 0;
  private time = 0;
  slowmo = 0;
  private enabled: boolean;

  constructor(quality: QualityProfile) {
    this.enabled = quality.vignette || quality.bloom;
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uFlash: { value: 0 },
        uVignette: { value: quality.vignette ? 1 : 0 },
        uTime: { value: 0 },
        uSlowmo: { value: 0 },
        uFlashColor: { value: new THREE.Color(0xffffff) },
        uHurt: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        varying vec2 vUv;
        uniform float uFlash;
        uniform float uVignette;
        uniform float uTime;
        uniform float uSlowmo;
        uniform float uHurt;
        uniform vec3 uFlashColor;

        void main() {
          vec2 c = vUv - 0.5;
          float d = length(c);
          float alpha = 0.0;
          vec3 col = vec3(0.0);

          // Vignette
          float vig = smoothstep(0.32, 0.78, d) * uVignette * 0.55;
          alpha += vig;

          // Hurt tint at the edges
          float hurt = smoothstep(0.2, 0.7, d) * uHurt;
          col = mix(col, vec3(0.62, 0.05, 0.05), hurt > 0.0 ? 1.0 : 0.0);
          alpha += hurt * 0.65;

          // Impact flash
          if (uFlash > 0.001) {
            col = mix(col, uFlashColor, 1.0);
            alpha = max(alpha, uFlash);
          }

          // Slow-motion radial streaks for finishers
          if (uSlowmo > 0.001) {
            float ang = atan(c.y, c.x);
            float streak = sin(ang * 34.0 + uTime * 5.0) * 0.5 + 0.5;
            streak *= smoothstep(0.22, 0.62, d) * uSlowmo;
            col = mix(col, vec3(1.0, 0.94, 0.8), streak > 0.0 ? 1.0 : 0.0);
            alpha = max(alpha, streak * 0.32);
          }

          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }
      `,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  impactFlash(strength: number, color = 0xffffff): void {
    this.flash = Math.min(0.85, this.flash + strength);
    (this.mat.uniforms.uFlashColor.value as THREE.Color).setHex(color);
  }

  setHurt(v: number): void {
    this.mat.uniforms.uHurt.value = clamp01(v);
  }

  update(dt: number): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.slowmo = Math.max(0, this.slowmo - dt * 1.6);
    this.mat.uniforms.uFlash.value = this.flash;
    this.mat.uniforms.uTime.value = this.time;
    this.mat.uniforms.uSlowmo.value = this.slowmo;
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled && this.flash <= 0.001 && this.slowmo <= 0.001) return;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Floating damage numbers rendered as sprites. */
export class DamageNumbers {
  readonly group = new THREE.Group();
  private pool: Array<{ sprite: THREE.Sprite; life: number; vy: number }> = [];
  private canvas: HTMLCanvasElement | null = null;
  private enabled = true;

  constructor(enabled = true) {
    this.enabled = enabled;
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 256;
      this.canvas.height = 128;
    }
  }

  spawn(x: number, y: number, z: number, text: string, color: string, scale = 1): void {
    if (!this.enabled || !this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = 'bold 74px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 64);

    const tex = new THREE.CanvasTexture(this.canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(0.8 * scale, 0.4 * scale, 1);
    sprite.renderOrder = 999;
    this.group.add(sprite);
    this.pool.push({ sprite, life: 1.1, vy: 1.5 });
  }

  update(dt: number): void {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life -= dt;
      p.sprite.position.y += p.vy * dt;
      p.vy *= 0.94;
      const mat = p.sprite.material as THREE.SpriteMaterial;
      mat.opacity = clamp01(p.life * 1.6);
      if (p.life <= 0) {
        this.group.remove(p.sprite);
        mat.map?.dispose();
        mat.dispose();
        this.pool.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const p of this.pool) {
      this.group.remove(p.sprite);
      const mat = p.sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.pool.length = 0;
  }

  dispose(): void {
    this.clear();
  }
}
