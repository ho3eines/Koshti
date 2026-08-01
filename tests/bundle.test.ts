/**
 * Production bundle smoke test.
 *
 * Loads the *shipped* files from `public/app` (not the source) into jsdom with
 * a stubbed WebGL2 context and boots the real entry point. This is the last
 * line of defence against a bundle that type-checks and builds but dies on
 * startup — a broken dynamic import, a bad chunk split, or a module-scope
 * crash that unit tests never touch.
 *
 * Skipped automatically when `public/` has not been built yet.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const APP_DIR = 'public/app';
const ASSET_DIR = `${APP_DIR}/assets`;
const built = existsSync(ASSET_DIR);

/** Errors that only occur because the GL context is fake, not real defects. */
const isGlStubArtifact = (msg: string): boolean =>
  /three-|getUniforms|renderBufferDirect|WebGLProgram|WebGLUniforms|reading 'name'|initGLContext/.test(
    msg,
  );

const bootBundle = async (): Promise<{
  errors: string[];
  glArtifacts: string[];
  uiText: string;
  bootStatus: string | undefined;
}> => {
  const errors: string[] = [];

  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <canvas id="stage"></canvas>
      <div id="ui-root"></div>
      <div id="boot-screen"><i id="boot-fill"></i><div id="boot-status"></div></div>
    </body></html>`,
    { pretendToBeVisual: true, url: 'http://localhost/app/' },
  );
  const { window } = dom;

  // --- Minimal WebGL2 stub: enough for Three.js to construct a renderer.
  const glStub = new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'getExtension') return () => null;
        if (p === 'getParameter') {
          return (n: number) => {
            if (n === 0x1f02) return 'WebGL 2.0 (stub)';
            if (n === 0x8b8c) return 'WebGL GLSL ES 3.00 (stub)';
            if (n === 0x1f00) return 'stub-vendor';
            if (n === 0x1f01) return 'stub-renderer';
            if (n === 0x8b4d || n === 0x8872 || n === 0x8b4c) return 16;
            return 4096;
          };
        }
        if (p === 'getShaderPrecisionFormat')
          return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
        if (p === 'getContextAttributes') return () => ({});
        if (p === 'getProgramParameter' || p === 'getShaderParameter') return () => true;
        if (typeof p === 'string' && /^create/.test(p)) return () => ({});
        if (p === 'getUniformLocation' || p === 'getAttribLocation') return () => 0;
        if (p === 'getShaderInfoLog' || p === 'getProgramInfoLog') return () => '';
        if (p === 'canvas') return window.document.createElement('canvas');
        if (p === 'VERSION') return 0x1f02;
        if (p === 'SHADING_LANGUAGE_VERSION') return 0x8b8c;
        if (p === 'VENDOR') return 0x1f00;
        if (p === 'RENDERER') return 0x1f01;
        if (typeof p === 'string' && p.toUpperCase() === p) return 0;
        return () => {};
      },
    },
  );
  window.HTMLCanvasElement.prototype.getContext = function (t: string) {
    return String(t).startsWith('webgl') ? (glStub as never) : null;
  };

  // Bound frame budget so the render loop cannot spin forever under jsdom.
  const realSetTimeout = window.setTimeout.bind(window);
  let frames = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    if (frames++ > 90) return 0;
    return realSetTimeout(() => cb(Date.now()), 4) as unknown as number;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = () => {};

  window.addEventListener('error', (e: Event) => {
    const ev = e as ErrorEvent;
    errors.push(String(ev.error?.stack ?? ev.message));
  });
  window.addEventListener('unhandledrejection', (e: Event) =>
    errors.push(String((e as PromiseRejectionEvent).reason)),
  );
  window.console.error = (...a: unknown[]) => errors.push(a.map(String).join(' '));
  window.console.warn = () => {};
  window.console.log = () => {};

  const ctx = vm.createContext(window);
  // Inside a vm context globalThis is the sandbox, not `window`.
  vm.runInContext(
    `globalThis.addEventListener = window.addEventListener.bind(window);
     globalThis.removeEventListener = window.removeEventListener.bind(window);
     globalThis.requestAnimationFrame = window.requestAnimationFrame;
     globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
     globalThis.performance = window.performance;
     globalThis.devicePixelRatio = 2;
     globalThis.innerWidth = 412; globalThis.innerHeight = 915;
     globalThis.navigator = window.navigator;
     globalThis.localStorage = window.localStorage;`,
    ctx,
  );

  const files = readdirSync(ASSET_DIR).filter((f) => f.endsWith('.js'));
  const cache = new Map<string, vm.SourceTextModule>();
  const load = async (spec: string): Promise<vm.SourceTextModule> => {
    const name = spec.replace(/^.*\//, '');
    const hit = cache.get(name);
    if (hit) return hit;
    const mod = new vm.SourceTextModule(readFileSync(`${ASSET_DIR}/${name}`, 'utf8'), {
      identifier: name,
      context: ctx,
    });
    cache.set(name, mod);
    await mod.link(load as never);
    return mod;
  };

  const entry = files.find((f) => f.startsWith('index-'));
  if (!entry) throw new Error('no entry chunk found in the built bundle');
  const mod = await load(`./${entry}`);
  await mod.evaluate();
  await new Promise((r) => realSetTimeout(r, 900));

  return {
    errors: errors.filter((e) => !isGlStubArtifact(e)),
    glArtifacts: errors.filter((e) => isGlStubArtifact(e)),
    uiText: window.document.getElementById('ui-root')?.textContent ?? '',
    bootStatus: window.document.getElementById('boot-status')?.textContent ?? undefined,
  };
};

describe.skipIf(!built)('production bundle', () => {
  it('boots and renders the title screen with no app-level errors', async () => {
    const r = await bootBundle();

    // The boot handler writes this string only when initialisation throws.
    expect(r.bootStatus).not.toBe('Failed to start. Your device may not support WebGL2.');
    expect(r.errors, `app errors:\n${r.errors.join('\n')}`).toEqual([]);

    // The real onboarding screen must be on screen.
    expect(r.uiText).toContain('KOSHTI');
    expect(r.uiText).toContain('Rise of a Champion');
    expect(r.uiText.length).toBeGreaterThan(60);
  }, 60_000);

  it('ships every chunk the entry point imports', () => {
    const files = readdirSync(ASSET_DIR);
    const entry = files.find((f) => f.startsWith('index-') && f.endsWith('.js'))!;
    const src = readFileSync(`${ASSET_DIR}/${entry}`, 'utf8');
    for (const m of src.matchAll(/from"\.\/([\w.-]+\.js)"/g)) {
      expect(files, `entry imports missing chunk ${m[1]}`).toContain(m[1]);
    }
  });

  it('is installable as a PWA', () => {
    const manifest = JSON.parse(readFileSync(`${APP_DIR}/manifest.webmanifest`, 'utf8'));
    expect(manifest.name).toContain('Koshti');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(existsSync(`${APP_DIR}/icons/icon-512.png`)).toBe(true);
    // The service worker must precache the real hashed asset filenames.
    const sw = readFileSync(`${APP_DIR}/sw.js`, 'utf8');
    for (const f of readdirSync(ASSET_DIR)) expect(sw).toContain(f);
  });

  it('is idempotent — rebuilding never nests public/app inside itself', () => {
    // Regression: Vite's default publicDir copied public/ into dist/, so each
    // rebuild produced public/app/app/app/... Guard the shape explicitly.
    expect(existsSync(`${APP_DIR}/app`)).toBe(false);
    expect(existsSync(`${APP_DIR}/assets`)).toBe(true);
    const stray = readdirSync(APP_DIR).filter((f) => f === 'app' || f === 'public');
    expect(stray).toEqual([]);
  });

  it('registers the service worker and manifest in index.html', () => {
    const html = readFileSync(`${APP_DIR}/index.html`, 'utf8');
    expect(html).toContain('manifest.webmanifest');
    expect(html).toContain('serviceWorker');
  });
});
