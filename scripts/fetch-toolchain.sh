#!/usr/bin/env bash
#
# Fetches the Android toolchain needed by scripts/build-apk.sh.
#
# Everything is pulled with `git clone` from GitHub rather than from
# dl.google.com / services.gradle.org / maven.google.com, so this works in
# restricted environments where only GitHub is reachable.
#
# Installs into $TOOLCHAIN_DIR (default /tmp):
#   jdk8/linux-x86                   JDK 8 with javac, jar, keytool
#   gendroid/build-tools/33.0.2-2    aapt2, d8, apksigner, zipalign
#   gt/android-33/android.jar        Android 33 platform jar
set -euo pipefail

DIR="${TOOLCHAIN_DIR:-/tmp}"
mkdir -p "$DIR"

clone_sparse() {
  local url="$1" dest="$2" path="$3"
  if [ -d "$DIR/$dest" ]; then
    echo "==> $dest already present, skipping"
    return
  fi
  echo "==> Cloning $dest ($path)"
  git clone --depth 1 --filter=blob:none --sparse "$url" "$DIR/$dest"
  (cd "$DIR/$dest" && git sparse-checkout set "$path")
}

# --- JDK 8 (javac / jar / keytool). AOSP prebuilt, committed as real files.
clone_sparse https://github.com/khadas/android_prebuilts_jdk_jdk8.git jdk8 linux-x86
chmod -R +x "$DIR/jdk8/linux-x86/bin" 2>/dev/null || true

# --- Android build-tools 33.0.2 (aapt2, d8, apksigner, zipalign).
clone_sparse https://github.com/lipeedev/gendroid.git gendroid build-tools
chmod -R +x "$DIR/gendroid/build-tools" 2>/dev/null || true

# --- android.jar for every API level.
if [ ! -d "$DIR/gt" ]; then
  echo "==> Cloning android platform jars"
  git clone --depth 1 https://github.com/Sable/android-platforms.git "$DIR/gt"
fi

echo
echo "==> Verifying"
"$DIR/jdk8/linux-x86/bin/javac" -version 2>&1 | sed 's/^/    javac  /'
"$DIR/gendroid/build-tools/33.0.2-2/aapt2" version 2>&1 | sed 's/^/    /'
ls -la "$DIR/gt/android-33/android.jar" | awk '{print "    android.jar  " $5 " bytes"}'

cat <<EOF

==> Toolchain ready. Build the APK with:

    JAVA_HOME=$DIR/jdk8/linux-x86 \\
    BUILD_TOOLS=$DIR/gendroid/build-tools/33.0.2-2 \\
    ANDROID_JAR=$DIR/gt/android-33/android.jar \\
    scripts/build-apk.sh

(Those are also the defaults, so plain \`scripts/build-apk.sh\` works too.)
EOF
