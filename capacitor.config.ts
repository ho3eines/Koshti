import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.koshti.wrestling',
  appName: 'Koshti',
  webDir: 'dist',
  // Keep the game fullscreen and edge-to-edge.
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#06080d',
    // Hardware acceleration is essential for WebGL performance.
    appendUserAgent: 'KoshtiApp',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: false,
      backgroundColor: '#06080d',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#06080d',
      overlaysWebView: true,
    },
    Preferences: {
      group: 'KoshtiSave',
    },
  },
};

export default config;
