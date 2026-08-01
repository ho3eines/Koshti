/**
 * APK integrity tests.
 *
 * Validates the actual built artifact at `public/apk/*.apk` by reading the ZIP
 * central directory directly — no Android tooling required, so this runs
 * anywhere. Skipped when no APK has been built yet.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const APK_DIR = 'public/apk';
const apkFile = existsSync(APK_DIR)
  ? readdirSync(APK_DIR).find((f) => f.endsWith('.apk'))
  : undefined;
const apkPath = apkFile ? `${APK_DIR}/${apkFile}` : '';

/** Minimal ZIP central-directory reader: returns every entry name. */
const zipEntries = (buf: Buffer): string[] => {
  // Locate the End Of Central Directory record (signature 0x06054b50).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: no EOCD record');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break; // central file header
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
};

describe.skipIf(!apkFile)('built APK', () => {
  const buf = () => readFileSync(apkPath);

  it('is a valid ZIP archive with a PK signature', () => {
    const b = buf();
    expect(b.length).toBeGreaterThan(100_000);
    expect(b[0]).toBe(0x50); // 'P'
    expect(b[1]).toBe(0x4b); // 'K'
    expect(() => zipEntries(b)).not.toThrow();
  });

  it('contains the required Android package structure', () => {
    const names = zipEntries(buf());
    expect(names).toContain('AndroidManifest.xml');
    expect(names).toContain('classes.dex');
    expect(names).toContain('resources.arsc');
  });

  it('is signed', () => {
    const names = zipEntries(buf());
    // v1 (JAR) signing artifacts.
    expect(names.some((n) => n.startsWith('META-INF/') && n.endsWith('.SF'))).toBe(true);
    expect(names.some((n) => n.startsWith('META-INF/') && n.endsWith('.RSA'))).toBe(true);
    expect(names).toContain('META-INF/MANIFEST.MF');
    // v2/v3 signing writes an APK Signing Block before the central directory.
    expect(buf().includes(Buffer.from('APK Sig Block 42'))).toBe(true);
  });

  it('bundles the full playable game under assets/www', () => {
    const names = zipEntries(buf());
    const www = names.filter((n) => n.startsWith('assets/www/'));
    expect(www).toContain('assets/www/index.html');
    // The three.js chunk and the app chunk must both be present.
    expect(www.some((n) => /assets\/www\/assets\/three-.*\.js$/.test(n))).toBe(true);
    expect(www.some((n) => /assets\/www\/assets\/index-.*\.js$/.test(n))).toBe(true);
    expect(www.some((n) => /assets\/www\/assets\/index-.*\.css$/.test(n))).toBe(true);
  });

  it('ships launcher icons for every density', () => {
    const names = zipEntries(buf());
    for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      expect(
        names.some((n) => n.includes(`mipmap-${d}`) && n.endsWith('ic_launcher.png')),
        `missing ${d} launcher icon`,
      ).toBe(true);
    }
  });

  /** Entries are deflated, so read them back through `unzip -p`. */
  const extract = (entry: string): string =>
    execFileSync('unzip', ['-p', apkPath, entry], { maxBuffer: 64 * 1024 * 1024 }).toString(
      'latin1',
    );

  it('has a DEX file with the correct magic and version', () => {
    const dex = execFileSync('unzip', ['-p', apkPath, 'classes.dex'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(dex.subarray(0, 8).toString('latin1')).toBe('dex\n037\0');
    expect(dex.length).toBeGreaterThan(2000);
  });

  it('does not reference a service worker or crossorigin from file://', () => {
    // Both break when the WebView loads the app over file://, so the APK build
    // strips them. Regression guard on the packaged entry point.
    const doc = extract('assets/www/index.html');
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).not.toContain('serviceWorker');
    expect(doc).not.toContain('crossorigin');
    expect(doc).toContain('type="module"');
  });
});
