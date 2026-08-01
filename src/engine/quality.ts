import type { GraphicsPreset } from '../game/save/schema';

export interface QualityProfile {
  id: GraphicsPreset;
  label: string;
  /** Device pixel ratio cap. */
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Soft (PCF) vs basic shadow filtering. */
  softShadows: boolean;
  anisotropy: number;
  /** Crowd rendering: 0 = flat billboards, 1 = instanced boxes, 2 = detailed. */
  crowdDetail: 0 | 1 | 2;
  crowdCount: number;
  /** Wrestler mesh segment counts. */
  bodySegments: number;
  /** Post effects. */
  bloom: boolean;
  vignette: boolean;
  motionBlur: boolean;
  /** Environmental extras. */
  volumetricLights: boolean;
  reflections: boolean;
  particles: boolean;
  sweatParticles: boolean;
  matReflection: number;
  /** Render scale multiplier applied on top of pixel ratio. */
  renderScale: number;
  antialias: boolean;
  maxLights: number;
}

export const QUALITY: Record<GraphicsPreset, QualityProfile> = {
  low: {
    id: 'low',
    label: 'Low',
    maxPixelRatio: 1.0,
    shadows: false,
    shadowMapSize: 512,
    softShadows: false,
    anisotropy: 1,
    crowdDetail: 0,
    crowdCount: 0,
    bodySegments: 8,
    bloom: false,
    vignette: false,
    motionBlur: false,
    volumetricLights: false,
    reflections: false,
    particles: false,
    sweatParticles: false,
    matReflection: 0,
    renderScale: 0.72,
    antialias: false,
    maxLights: 2,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    softShadows: false,
    anisotropy: 2,
    crowdDetail: 1,
    crowdCount: 320,
    bodySegments: 12,
    bloom: false,
    vignette: true,
    motionBlur: false,
    volumetricLights: false,
    reflections: false,
    particles: true,
    sweatParticles: false,
    matReflection: 0.15,
    renderScale: 0.85,
    antialias: false,
    maxLights: 3,
  },
  high: {
    id: 'high',
    label: 'High',
    maxPixelRatio: 2.0,
    shadows: true,
    shadowMapSize: 2048,
    softShadows: true,
    anisotropy: 4,
    crowdDetail: 1,
    crowdCount: 900,
    bodySegments: 18,
    bloom: true,
    vignette: true,
    motionBlur: false,
    volumetricLights: true,
    reflections: true,
    particles: true,
    sweatParticles: true,
    matReflection: 0.3,
    renderScale: 1.0,
    antialias: true,
    maxLights: 4,
  },
  ultra: {
    id: 'ultra',
    label: 'Ultra',
    maxPixelRatio: 3.0,
    shadows: true,
    shadowMapSize: 2048,
    softShadows: true,
    anisotropy: 8,
    crowdDetail: 2,
    crowdCount: 1800,
    bodySegments: 24,
    bloom: true,
    vignette: true,
    motionBlur: true,
    volumetricLights: true,
    reflections: true,
    particles: true,
    sweatParticles: true,
    matReflection: 0.45,
    renderScale: 1.0,
    antialias: true,
    maxLights: 5,
  },
};

export interface DeviceCaps {
  gpuTier: 0 | 1 | 2 | 3;
  memoryGB: number;
  cores: number;
  maxTextureSize: number;
  renderer: string;
  isMobile: boolean;
}

export const probeDevice = (): DeviceCaps => {
  const nav = globalThis.navigator as Navigator & { deviceMemory?: number };
  const memoryGB = nav?.deviceMemory ?? 4;
  const cores = nav?.hardwareConcurrency ?? 4;
  const ua = nav?.userAgent ?? '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

  let renderer = 'unknown';
  let maxTextureSize = 4096;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    }
  } catch {
    /* headless */
  }

  // Tier heuristics tuned for the Android GPU landscape.
  let gpuTier: DeviceCaps['gpuTier'] = 1;
  const r = renderer.toLowerCase();
  if (/adreno \(tm\) (7[3-9]\d|8\d\d)/.test(r) || /mali-g7\d\d/.test(r) || /apple/.test(r)) gpuTier = 3;
  else if (/adreno \(tm\) (6[4-9]\d|7[0-2]\d)/.test(r) || /mali-g[67]\d/.test(r)) gpuTier = 2;
  else if (/adreno \(tm\) [5-6]\d\d/.test(r) || /mali-g5\d/.test(r)) gpuTier = 1;
  else if (/mali-t|adreno \(tm\) [34]\d\d|powervr/.test(r)) gpuTier = 0;
  else gpuTier = memoryGB >= 6 && cores >= 8 ? 2 : memoryGB >= 4 ? 1 : 0;

  if (!isMobile) gpuTier = 3;

  return { gpuTier, memoryGB, cores, maxTextureSize, renderer, isMobile };
};

export const recommendPreset = (caps: DeviceCaps): GraphicsPreset => {
  if (caps.gpuTier >= 3 && caps.memoryGB >= 6) return 'ultra';
  if (caps.gpuTier >= 2 && caps.memoryGB >= 4) return 'high';
  if (caps.gpuTier >= 1 && caps.memoryGB >= 3) return 'medium';
  return 'low';
};

/**
 * Dynamic resolution controller. Watches frame time and nudges the render
 * scale so we hold the target FPS instead of dropping frames.
 */
export class DynamicResolution {
  private samples: number[] = [];
  private cooldown = 0;
  scale: number;
  readonly min = 0.55;
  readonly max: number;

  constructor(
    private targetFps: number,
    baseScale: number,
  ) {
    this.scale = baseScale;
    this.max = baseScale;
  }

  setTarget(fps: number): void {
    this.targetFps = fps;
  }

  /** Returns a new scale when it changes, otherwise null. */
  update(dtMs: number): number | null {
    this.samples.push(dtMs);
    if (this.samples.length < 45) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    this.samples.length = 0;

    if (this.cooldown > 0) {
      this.cooldown--;
      return null;
    }

    const budget = 1000 / this.targetFps;
    const prev = this.scale;

    if (p90 > budget * 1.28) {
      this.scale = Math.max(this.min, this.scale - 0.1);
    } else if (p90 < budget * 0.72) {
      this.scale = Math.min(this.max, this.scale + 0.05);
    }

    if (Math.abs(this.scale - prev) > 0.001) {
      this.cooldown = 2;
      return this.scale;
    }
    return null;
  }
}
