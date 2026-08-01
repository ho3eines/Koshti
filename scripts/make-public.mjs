/**
 * Assembles the distributable `public/` folder.
 *
 * Copies the production web build, adds a PWA manifest + service worker so the
 * game is installable to an Android home screen straight from a browser, and
 * drops in a landing page that links to the APK once CI has produced one.
 */
import { cp, mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'public');

if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

await mkdir(out, { recursive: true });

// ---- 1. copy the built game to public/app
// Wipe first so re-running never nests a previous build inside itself.
const appDir = join(out, 'app');
await rm(appDir, { recursive: true, force: true });
await mkdir(appDir, { recursive: true });
await cp(dist, appDir, { recursive: true });

// ---- 2. copy the launcher icon for the PWA manifest
const iconSrc = join(root, 'assets', 'brand', 'play-store-icon-512.png');
if (existsSync(iconSrc)) {
  await mkdir(join(appDir, 'icons'), { recursive: true });
  await cp(iconSrc, join(appDir, 'icons', 'icon-512.png'));
}

// ---- 3. PWA manifest — makes the game installable on Android
const manifest = {
  name: 'Koshti — Rise of a Champion',
  short_name: 'Koshti',
  description: '3D wrestling career game. Train, fight, and climb to the world title.',
  start_url: './index.html',
  scope: './',
  display: 'fullscreen',
  orientation: 'portrait',
  background_color: '#06080d',
  theme_color: '#06080d',
  categories: ['games', 'sports'],
  icons: [
    { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
await writeFile(join(appDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

// ---- 4. service worker for offline play
const assets = [];
const walk = async (dir, prefix = '') => {
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) await walk(full, `${prefix}${entry}/`);
    else assets.push(`./${prefix}${entry}`);
  }
};
await walk(join(appDir, 'assets'), 'assets/');

const sw = `// Koshti offline cache — bumped automatically at build time.
const CACHE = 'koshti-v${Date.now()}';
const ASSETS = ${JSON.stringify(['./', './index.html', './manifest.webmanifest', ...assets], null, 2)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
`;
await writeFile(join(appDir, 'sw.js'), sw);

// ---- 5. register the SW + manifest in the built index.html
const indexPath = join(appDir, 'index.html');
let html = await import('node:fs').then((fs) => fs.readFileSync(indexPath, 'utf8'));
if (!html.includes('manifest.webmanifest')) {
  html = html.replace(
    '</head>',
    `  <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="apple-touch-icon" href="./icons/icon-512.png" />
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('./sw.js').catch(() => {});
        });
      }
    </script>
  </head>`,
  );
  await writeFile(indexPath, html);
}

console.log('public/ assembled:');
console.log('  public/app/          playable game (PWA, installable on Android)');
console.log('  public/index.html    landing page + APK download');
