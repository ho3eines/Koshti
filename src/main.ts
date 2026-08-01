import { App } from './game/app';
import { audio } from './engine/audio';
import { setLang, t } from './core/i18n';
import { renderOnboarding } from './ui/screens/onboarding';
import { renderHub } from './ui/screens/hub';
import { renderTraining } from './ui/screens/training';
import { renderLeague } from './ui/screens/league';
import { renderTournament } from './ui/screens/tournament';
import { renderSkills } from './ui/screens/skills';
import { renderProfile } from './ui/screens/profile';
import { renderSettings } from './ui/screens/settings';
import { renderMatch } from './ui/screens/match';

const bootScreen = document.getElementById('boot-screen');
const bootFill = document.getElementById('boot-fill');
const bootStatus = document.getElementById('boot-status');
const bootMark = document.querySelector('.boot-mark') as HTMLElement | null;
const bootSub = document.querySelector('.boot-sub') as HTMLElement | null;

// Default to Persian — the user explicitly asked for a fully Persian game.
setLang('fa');
if (bootMark) bootMark.textContent = t('app.title');
if (bootSub) bootSub.textContent = t('app.subtitle');

const setProgress = (pct: number, key: string, vars?: Record<string, string | number>): void => {
  if (bootFill) bootFill.style.width = `${Math.round(pct * 100)}%`;
  if (bootStatus) bootStatus.textContent = t(key, vars);
};

const main = async (): Promise<void> => {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root');
  if (!canvas || !uiRoot) throw new Error('Missing mount points');

  const app = new App(canvas, uiRoot);

  app.registerScreen('onboarding', renderOnboarding);
  app.registerScreen('hub', renderHub);
  app.registerScreen('training', renderTraining);
  app.registerScreen('league', renderLeague);
  app.registerScreen('tournament', renderTournament);
  app.registerScreen('skills', renderSkills);
  app.registerScreen('profile', renderProfile);
  app.registerScreen('settings', renderSettings);
  app.registerScreen('match', renderMatch);
  app.registerScreen('results', renderHub);

  try {
    await app.boot(setProgress);
  } catch (err) {
    console.error('Boot failed', err);
    if (bootStatus) {
      bootStatus.textContent = t('boot.fail');
      bootStatus.style.color = '#ff6b5b';
    }
    return;
  }

  // Audio must be unlocked by a user gesture on mobile.
  const unlock = (): void => {
    void audio.unlock().then(() => {
      app.applyAudioSettings();
      if (app.currentScreen === 'onboarding' || app.currentScreen === 'hub') {
        audio.playMusic('menu');
      }
    });
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock, { once: false });
  document.addEventListener('keydown', unlock, { once: false });

  bootScreen?.classList.add('hidden');
  globalThis.setTimeout(() => bootScreen?.remove(), 700);

  app.go('onboarding');

  // Native platform niceties (no-ops in the browser).
  void (async () => {
    try {
      const cap = (globalThis as Record<string, unknown>)['Capacitor'] as
        | { isNativePlatform?: () => boolean }
        | undefined;
      if (!cap?.isNativePlatform?.()) return;
      const [{ SplashScreen }, { StatusBar, Style }] = await Promise.all([
        import('@capacitor/splash-screen'),
        import('@capacitor/status-bar'),
      ]);
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.hide();
      await SplashScreen.hide();
    } catch {
      /* plugin not installed */
    }
  })();

  // Expose for debugging / automated smoke tests.
  (globalThis as Record<string, unknown>)['koshti'] = app;
};

void main();
