# ==========================================================================
# Koshti — ProGuard / R8 rules
#
# The game logic lives in the WebView (JS), so the Java side is thin. What we
# must protect is Capacitor's reflection-based plugin bridge — R8 cannot see
# those call sites and will happily strip them.
# ==========================================================================

# --- Capacitor core + plugin bridge (all reflective) ---
-keep public class com.getcapacitor.** { *; }
-keep public class com.getcapacitor.plugin.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}

# --- Installed Capacitor plugins ---
-keep class com.capacitorjs.plugins.preferences.** { *; }
-keep class com.capacitorjs.plugins.splashscreen.** { *; }
-keep class com.capacitorjs.plugins.statusbar.** { *; }

# --- Cordova compatibility layer ---
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin

# --- Anything exposed to JavaScript ---
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes EnclosingMethod
-keepattributes InnerClasses

# --- Our activity (referenced from the manifest) ---
-keep class com.koshti.wrestling.MainActivity { *; }

# --- Keep crash reports readable ---
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- Silence known-safe warnings ---
-dontwarn org.apache.cordova.**
-dontwarn com.getcapacitor.**
-dontwarn javax.annotation.**
