# CI — Android APK build

`build-apk.yml` is a ready-to-run GitHub Actions workflow that builds and signs
the Android APK.

It lives here rather than in `.github/workflows/` because the automation
account that authored it does not hold GitHub's `workflows` permission, so it
cannot push files into that directory. Moving it is a one-time, one-line step.

## Enable it

```bash
mkdir -p .github/workflows
git mv ci/build-apk.yml .github/workflows/build-apk.yml
git commit -m "ci: enable Android APK build"
git push
```

Then open the repo's **Actions** tab. The workflow runs on every push and can
also be started manually via **Run workflow**.

## What it does

1. Installs Node 22, JDK 21 and the Android SDK.
2. Runs `npm ci`, the typecheck and the full 222-test suite.
3. Builds the web bundle and runs `npx cap sync android`.
4. Generates a debug keystore.
5. Assembles the **debug** and **release** APKs via Gradle.
6. Signs the release APK with `zipalign` + `apksigner`.
7. Uploads everything as a **`koshti-apk`** artifact (kept 90 days).
8. On `main`, also copies the APKs into `public/apk/` and uploads `public/` as
   a GitHub Pages artifact.
9. On a `v*` tag, attaches the APKs to the GitHub Release.

## Getting the APK afterwards

**Actions** → newest green *Build Android APK* run → **Artifacts** →
`koshti-apk`.

For a public download link instead, tag a release:

```bash
git tag v1.0.0
git push --tags
```

## Building locally instead

No CI required if you have the Android toolchain:

```bash
npm install
npm run android:apk
# → android/app/build/outputs/apk/release/
```

Requires JDK 21 and Android SDK 36.
