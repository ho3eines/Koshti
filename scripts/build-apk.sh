#!/usr/bin/env bash
#
# Koshti — direct APK build (no Gradle).
#
# Assembles a signed, installable APK using only aapt2 + javac + d8 +
# apksigner. Gradle and Maven are never contacted, so this works in locked-down
# environments where only the raw build tools are available.
#
# Required environment (auto-detected if the standard layout is present):
#   JAVA_HOME      a JDK with javac (8+)
#   BUILD_TOOLS    Android build-tools dir (aapt2, d8, zipalign, apksigner)
#   ANDROID_JAR    path to android.jar for the target API
#
# Usage:  scripts/build-apk.sh [output.apk]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$ROOT/android-native"
OUT_APK="${1:-$ROOT/public/apk/koshti-1.0.0.apk}"
WORK="$ROOT/.apk-build"

# ---------------------------------------------------------------- toolchain
JAVA_HOME="${JAVA_HOME:-/tmp/jdk8/linux-x86}"
BUILD_TOOLS="${BUILD_TOOLS:-/tmp/gendroid/build-tools/33.0.2-2}"
ANDROID_JAR="${ANDROID_JAR:-/tmp/gt/android-33/android.jar}"

JAVAC="$JAVA_HOME/bin/javac"
JAVA="$JAVA_HOME/bin/java"
KEYTOOL="$JAVA_HOME/bin/keytool"
AAPT2="$BUILD_TOOLS/aapt2"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER_JAR="$BUILD_TOOLS/lib/apksigner.jar"
D8_JAR="$BUILD_TOOLS/lib/d8.jar"

die() { echo "ERROR: $*" >&2; exit 1; }
for f in "$JAVAC" "$JAVA" "$KEYTOOL" "$AAPT2" "$ZIPALIGN" "$APKSIGNER_JAR" "$D8_JAR" "$ANDROID_JAR"; do
  [ -e "$f" ] || die "missing required tool: $f"
done

echo "==> Toolchain"
echo "    javac       $("$JAVAC" -version 2>&1)"
echo "    aapt2       $("$AAPT2" version 2>&1 | head -1)"
echo "    android.jar $ANDROID_JAR"

# ------------------------------------------------------------- web assets
echo "==> Building web bundle"
cd "$ROOT"
[ -d node_modules ] || npm ci
npm run build:public >/dev/null

rm -rf "$WORK"
mkdir -p "$WORK"/{compiled,classes,dex,assets}

# The game is served from assets/www inside the APK.
cp -r "$ROOT/public/app" "$WORK/assets/www"

# Two adjustments for running off file:// inside a WebView:
#  1. `crossorigin` on module scripts triggers CORS checks that file:// fails.
#  2. A service worker cannot register on file://; the APK bundles everything
#     already, so registration is pointless and only logs errors.
python3 - "$WORK/assets/www/index.html" <<'PYEOF'
import re, sys
p = sys.argv[1]
h = open(p, encoding="utf-8").read()
h = h.replace(" crossorigin", "")
h = re.sub(r"<script>\s*if \('serviceWorker'.*?</script>", "", h, flags=re.S)
open(p, "w", encoding="utf-8").write(h)
PYEOF
rm -f "$WORK/assets/www/sw.js"
echo "    web assets  $(du -sh "$WORK/assets/www" | cut -f1)"

# ------------------------------------------------------------- resources
echo "==> Compiling resources (aapt2)"
"$AAPT2" compile --dir "$NATIVE/res" -o "$WORK/compiled/res.zip"

echo "==> Linking resources"
"$AAPT2" link \
  -I "$ANDROID_JAR" \
  --manifest "$NATIVE/AndroidManifest.xml" \
  --java "$WORK/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 33 \
  -A "$WORK/assets" \
  -o "$WORK/base.apk" \
  "$WORK/compiled/res.zip"
mkdir -p "$WORK/gen"

# ------------------------------------------------------------- java build
echo "==> Compiling Java"
SRCS=$(find "$NATIVE/src" "$WORK/gen" -name "*.java" 2>/dev/null)
"$JAVAC" \
  -encoding UTF-8 \
  -source 8 -target 8 \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$WORK/classes" \
  -nowarn \
  $SRCS

echo "==> Dexing (d8)"
CLASSES=$(find "$WORK/classes" -name "*.class")
"$JAVA" -cp "$D8_JAR" com.android.tools.r8.D8 \
  --min-api 24 \
  --lib "$ANDROID_JAR" \
  --output "$WORK/dex" \
  $CLASSES

# ------------------------------------------------------------- packaging
echo "==> Packaging APK"
cd "$WORK"
cp base.apk unaligned.apk
(cd dex && zip -q "$WORK/unaligned.apk" classes.dex)

echo "==> Aligning"
"$ZIPALIGN" -p -f 4 unaligned.apk aligned.apk

echo "==> Signing"
KEYSTORE="$WORK/koshti.keystore"
"$KEYTOOL" -genkeypair -v \
  -keystore "$KEYSTORE" \
  -storepass koshti -keypass koshti \
  -alias koshti \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Koshti, O=Koshti, C=US" >/dev/null 2>&1

"$JAVA" -jar "$APKSIGNER_JAR" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:koshti \
  --key-pass pass:koshti \
  --ks-key-alias koshti \
  --min-sdk-version 24 \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$WORK/signed.apk" \
  aligned.apk

echo "==> Verifying"
"$JAVA" -jar "$APKSIGNER_JAR" verify --print-certs "$WORK/signed.apk" | head -4

mkdir -p "$(dirname "$OUT_APK")"
cp "$WORK/signed.apk" "$OUT_APK"

echo
echo "==> Done"
ls -lh "$OUT_APK" | awk '{print "    " $9 "  " $5}'
