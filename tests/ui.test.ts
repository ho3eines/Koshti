/**
 * UI / screen integration tests.
 *
 * These run the real screen renderers against a jsdom document with the
 * WebGL-dependent parts stubbed. That catches the class of bug unit tests
 * miss: a screen that throws on mount, a dead button, a broken route, or a
 * flow that fails to persist progress.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { App } from '../src/game/app';
import { SaveManager, type StorageAdapter } from '../src/game/save/storage';
import { renderOnboarding } from '../src/ui/screens/onboarding';
import { renderHub } from '../src/ui/screens/hub';
import { renderTraining } from '../src/ui/screens/training';
import { renderLeague } from '../src/ui/screens/league';
import { renderTournament } from '../src/ui/screens/tournament';
import { renderSkills } from '../src/ui/screens/skills';
import { renderProfile } from '../src/ui/screens/profile';
import { renderSettings } from '../src/ui/screens/settings';
import { TRAINING_STAGES } from '../src/game/career/training';
import { newSave } from '../src/game/save/schema';
import { setLang } from '../src/core/i18n';
import type { ScreenId } from '../src/game/save/schema';

// ---------------------------------------------------------------- test rig

class MemAdapter implements StorageAdapter {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.store.set(k, v);
  }
  async remove(k: string) {
    this.store.delete(k);
  }
}

/** A stand-in for GameRenderer — the screens only call a handful of methods. */
const stubRenderer = () => ({
  loadArena: vi.fn(),
  spawnFighter: vi.fn(),
  clearFighters: vi.fn(),
  setQuality: vi.fn(),
  setTargetFps: vi.fn(),
  setCameraShake: vi.fn(),
  setCameraMode: vi.fn(),
  resize: vi.fn(),
  render: vi.fn(),
  renderMenu: vi.fn(),
  impact: vi.fn(),
  showDamage: vi.fn(),
  celebrate: vi.fn(),
  slowmo: vi.fn(),
  playClip: vi.fn(),
  sweat: vi.fn(),
  dispose: vi.fn(),
  timeScaleValue: 1,
  stats: { fps: 60, frameMs: 16, drawCalls: 40, triangles: 20000, renderScale: 1 },
  director: { setMode: vi.fn(), addShake: vi.fn() },
});

const setupDom = (): { canvas: HTMLCanvasElement; uiRoot: HTMLElement } => {
  document.body.innerHTML = '<canvas id="stage"></canvas><div id="ui-root"></div>';
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;
  Object.defineProperty(canvas, 'clientWidth', { value: 412, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: 915, configurable: true });
  return { canvas, uiRoot };
};

const makeApp = async (withSave = true): Promise<App> => {
  const { canvas, uiRoot } = setupDom();
  const app = new App(canvas, uiRoot);
  // Swap in the stub renderer and a memory-backed save store.
  (app as unknown as { renderer: unknown }).renderer = stubRenderer();
  (app as unknown as { saves: SaveManager }).saves = new SaveManager(new MemAdapter());
  await app.saves.init();

  app.registerScreen('onboarding', renderOnboarding);
  app.registerScreen('hub', renderHub);
  app.registerScreen('training', renderTraining);
  app.registerScreen('league', renderLeague);
  app.registerScreen('tournament', renderTournament);
  app.registerScreen('skills', renderSkills);
  app.registerScreen('profile', renderProfile);
  app.registerScreen('settings', renderSettings);
  app.registerScreen('match', () => {
    /* match screen needs WebGL; routing is what we assert */
  });
  app.registerScreen('results', renderHub);

  // Wire the global listeners (back button, resize) exactly as boot() does.
  app.attachLifecycle();

  if (withSave) {
    const save = newSave('Test Wrestler');
    app.save = save;
    app.saves.attach(save);
  }
  return app;
};

const text = (app: App): string => app.uiRoot.textContent ?? '';
const buttons = (app: App): HTMLElement[] =>
  Array.from(app.uiRoot.querySelectorAll('button, .card.interactive'));
const findByText = (app: App, needle: string): HTMLElement | undefined =>
  buttons(app).find((b) => (b.textContent ?? '').toLowerCase().includes(needle.toLowerCase()));
const click = (node: HTMLElement | undefined): void => {
  expect(node, 'element to click not found').toBeDefined();
  node!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.restoreAllMocks();
  setLang('en');
});

// ------------------------------------------------------------- every screen

describe('screen rendering', () => {
  const screens: ScreenId[] = ['hub', 'training', 'league', 'tournament', 'skills', 'profile', 'settings'];

  for (const id of screens) {
    it(`${id} mounts without throwing and renders content`, async () => {
      const app = await makeApp();
      expect(() => app.go(id)).not.toThrow();
      expect(app.uiRoot.children.length).toBeGreaterThan(0);
      expect(text(app).length).toBeGreaterThan(20);
    });
  }

  it('renders every screen for a mid-career save too', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.profile.level = 18;
    save.profile.coins = 25000;
    save.profile.skillPoints = 6;
    save.league.division = 'professional';
    save.league.winsInDivision = 3;
    save.league.promotionAvailable = true;
    save.league.titlesHeld = ['tournament:abc', 'club:xyz'];
    save.training.completed = TRAINING_STAGES.map((s) => s.id);
    save.record.wins = 24;
    save.record.losses = 5;
    save.history = [
      {
        at: Date.now(),
        opponent: 'Ivan Petrov',
        opponentClub: 'iron_bears',
        division: 'professional',
        won: true,
        method: 'By pinfall',
        scoreFor: 9,
        scoreAgainst: 3,
        xp: 300,
        coins: 1800,
      },
    ];
    for (const id of screens) {
      expect(() => app.go(id), id).not.toThrow();
      expect(text(app).length, id).toBeGreaterThan(20);
    }
  });

  it('replaces the previous screen on navigation (no leaks)', async () => {
    const app = await makeApp();
    app.go('hub');
    const first = app.uiRoot.children.length;
    app.go('profile');
    app.go('hub');
    expect(app.uiRoot.children.length).toBe(first);
  });
});

// ------------------------------------------------------------- onboarding

describe('onboarding flow', () => {
  it('shows the begin-career call to action on a fresh install', async () => {
    const app = await makeApp(false);
    app.go('onboarding');
    await tick();
    expect(text(app)).toContain('KOSHTI');
    expect(findByText(app, 'Begin Your Career')).toBeDefined();
  });

  it('walks name → style → club and creates a profile with that name', async () => {
    const app = await makeApp(false);
    app.go('onboarding');
    await tick();

    click(findByText(app, 'Begin Your Career'));
    const input = app.uiRoot.querySelector('.name-input') as HTMLInputElement;
    expect(input, 'name input should be shown').toBeDefined();

    // Continue stays disabled until the name is valid.
    const next = findByText(app, 'Continue') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    input.value = 'A';
    input.dispatchEvent(new window.Event('input'));
    expect((findByText(app, 'Continue') as HTMLButtonElement).disabled).toBe(true);

    input.value = 'Rustam Aliyev';
    input.dispatchEvent(new window.Event('input'));
    const enabled = findByText(app, 'Continue') as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    click(enabled);

    // Style step.
    expect(text(app)).toContain('WELCOME, RUSTAM ALIYEV');
    const styleCard = app.uiRoot.querySelector('.style-card') as HTMLElement;
    expect(styleCard).toBeDefined();
    click(styleCard);
    click(findByText(app, 'Continue'));

    // Club step.
    expect(text(app)).toContain('CHOOSE A CLUB');
    const clubCard = app.uiRoot.querySelector('.card.interactive') as HTMLElement;
    click(clubCard);

    const start = findByText(app, 'Start Career') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    click(start);
    await tick();
    await tick();

    expect(app.save).not.toBeNull();
    expect(app.save!.profile.name).toBe('Rustam Aliyev');
    expect(app.save!.profile.clubId).not.toBeNull();
    // First-time players are routed straight into training.
    expect(app.currentScreen).toBe('training');
  });

  it('truncates and trims the entered name', async () => {
    const app = await makeApp(false);
    const save = await app.createCareer('   Averyveryverylongwrestlername   ');
    expect(save.profile.name.length).toBeLessThanOrEqual(20);
    expect(save.profile.name.startsWith(' ')).toBe(false);
  });

  it('falls back to a default when the name is blank', async () => {
    const app = await makeApp(false);
    const save = await app.createCareer('   ');
    expect(save.profile.name).toBe('Rookie');
  });

  it('offers Continue when a save exists and resumes the checkpoint screen', async () => {
    const app = await makeApp(false);
    const created = await app.saves.create('Returning Champ');
    created.profile.level = 11;
    created.checkpoint.screen = 'skills';
    await app.saves.flush('Test checkpoint');

    app.go('onboarding');
    await tick();
    expect(text(app)).toContain('Returning Champ');
    expect(text(app)).toContain('Level 11');

    click(findByText(app, 'Continue'));
    await tick();
    await tick();
    expect(app.currentScreen).toBe('skills');
  });
});

// --------------------------------------------------------------- hub + nav

describe('hub navigation', () => {
  it('shows the player name, level and currency', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.profile.coins = 1234;
    save.profile.skillPoints = 3;
    app.go('hub');
    const t = text(app);
    expect(t.toUpperCase()).toContain('TEST WRESTLER');
    expect(t).toContain('Level 1');
    expect(t).toContain('1,234');
    expect(t).toContain('3 SP');
  });

  it('routes to each destination', async () => {
    const cases: Array<[string, ScreenId]> = [
      ['League & Matches', 'league'],
      ['Skills & Training', 'skills'],
      ['Training Hall', 'training'],
      ['Profile & Records', 'profile'],
      ['Tournament', 'tournament'],
    ];
    for (const [label, target] of cases) {
      const app = await makeApp();
      app.go('hub');
      click(findByText(app, label));
      expect(app.currentScreen, label).toBe(target);
    }
  });

  it('surfaces the promotion bout when it is available', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.training.completed = TRAINING_STAGES.map((s) => s.id);
    save.league.promotionAvailable = true;
    app.go('hub');
    expect(text(app)).toContain('Promotion Bout Available');
  });

  it('points a new player at training first', async () => {
    const app = await makeApp();
    app.go('hub');
    expect(text(app)).toContain('Training');
  });
});

// -------------------------------------------------------------- progression

describe('skill tree screen', () => {
  it('spends a skill point when an available node is tapped', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.profile.skillPoints = 5;
    app.go('skills');

    // Switch to the Power branch.
    click(findByText(app, 'Power'));
    const node = app.uiRoot.querySelector('.skill-node.available') as HTMLElement;
    expect(node, 'an available node should exist').toBeDefined();
    click(node);

    expect(save.profile.skillPoints).toBe(4);
    expect(save.profile.unlockedSkills.length).toBe(1);
  });

  it('does not let a locked node be purchased', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.profile.skillPoints = 99;
    app.go('skills');
    click(findByText(app, 'Power'));
    const locked = app.uiRoot.querySelector('.skill-node.locked') as HTMLElement;
    if (locked) {
      const before = save.profile.skillPoints;
      click(locked);
      expect(save.profile.skillPoints).toBe(before);
    }
  });

  it('trains an attribute with coins', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.profile.coins = 50000;
    const before = save.profile.attributes.strength;
    app.go('skills');
    const trainBtn = app.uiRoot.querySelector('.attr-train') as HTMLButtonElement;
    expect(trainBtn).toBeDefined();
    expect(trainBtn.disabled).toBe(false);
    click(trainBtn);
    expect(save.profile.attributes.strength).toBe(before + 1);
    expect(save.profile.coins).toBeLessThan(50000);
  });

  it('disables training when the player is broke', async () => {
    const app = await makeApp();
    app.requireSave().profile.coins = 0;
    app.go('skills');
    const trainBtn = app.uiRoot.querySelector('.attr-train') as HTMLButtonElement;
    expect(trainBtn.disabled).toBe(true);
  });

  it('lists the full moveset', async () => {
    const app = await makeApp();
    app.go('skills');
    click(findByText(app, 'Moves'));
    expect(text(app)).toContain('Double Leg');
  });
});

// ---------------------------------------------------------------- training

describe('training screen', () => {
  it('locks later stages until the previous one is done', async () => {
    const app = await makeApp();
    app.go('training');
    const locked = app.uiRoot.querySelectorAll('.card.locked');
    expect(locked.length).toBe(TRAINING_STAGES.length - 1);
  });

  it('unlocks the next stage after a completion', async () => {
    const app = await makeApp();
    app.requireSave().training.completed = ['stance'];
    app.go('training');
    expect(app.uiRoot.querySelectorAll('.card.locked').length).toBe(TRAINING_STAGES.length - 2);
  });

  it('opens a briefing with objectives when a stage is tapped', async () => {
    const app = await makeApp();
    app.go('training');
    const stage = app.uiRoot.querySelector('.card.interactive') as HTMLElement;
    click(stage);
    expect(text(app)).toContain('Objectives');
    expect(text(app)).toContain('Rewards');
  });

  it('shows earned stars for completed stages', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.training.completed = ['stance'];
    save.training.stars = { stance: 3 };
    app.go('training');
    expect(app.uiRoot.querySelector('.stars')).not.toBeNull();
    expect(text(app)).toContain('DONE');
  });
});

// ------------------------------------------------------------------ league

describe('league screen', () => {
  it('blocks competition until training is complete', async () => {
    const app = await makeApp();
    app.go('league');
    expect(text(app)).toContain('Finish your training first');
    click(findByText(app, 'Go to Training'));
    expect(app.currentScreen).toBe('training');
  });

  it('lists three opponents and the standings once training is done', async () => {
    const app = await makeApp();
    app.requireSave().training.completed = TRAINING_STAGES.map((s) => s.id);
    app.go('league');
    expect(app.uiRoot.querySelectorAll('.vs-card').length).toBe(3);
    expect(text(app)).toContain('Division standings');
    expect(app.uiRoot.querySelectorAll('.lb-row').length).toBeGreaterThan(5);
  });

  it('highlights the player in the standings exactly once', async () => {
    const app = await makeApp();
    app.requireSave().training.completed = TRAINING_STAGES.map((s) => s.id);
    app.go('league');
    expect(app.uiRoot.querySelectorAll('.lb-row.me').length).toBe(1);
  });

  it('charges the entry fee and routes to the match', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.training.completed = TRAINING_STAGES.map((s) => s.id);
    save.league.division = 'semipro';
    save.profile.coins = 5000;
    app.go('league');
    const card = app.uiRoot.querySelector('.card.interactive') as HTMLElement;
    click(card);
    expect(save.profile.coins).toBeLessThan(5000);
    expect(app.currentScreen).toBe('match');
  });

  it('locks opponents the player cannot afford', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.training.completed = TRAINING_STAGES.map((s) => s.id);
    save.league.division = 'champion';
    save.profile.coins = 0;
    app.go('league');
    expect(app.uiRoot.querySelectorAll('.card.locked').length).toBeGreaterThan(0);
    expect(text(app).toLowerCase()).toContain('not enough coins');
  });

  it('shows a single promotion bout when one is earned', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.training.completed = TRAINING_STAGES.map((s) => s.id);
    save.league.promotionAvailable = true;
    app.go('league');
    expect(text(app).toUpperCase()).toContain('PROMOTION BOUT');
    expect(app.uiRoot.querySelectorAll('.vs-card').length).toBe(1);
  });
});

// -------------------------------------------------------------- tournament

describe('tournament screen', () => {
  it('is gated behind training', async () => {
    const app = await makeApp();
    app.go('tournament');
    expect(text(app)).toContain('Finish your training programme');
  });

  it('lists open events and enters one', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.training.completed = TRAINING_STAGES.map((s) => s.id);
    save.profile.coins = 10000;
    app.go('tournament');
    expect(text(app)).toContain('Open');

    click(app.uiRoot.querySelector('.card.interactive') as HTMLElement);
    expect(save.tournament).not.toBeNull();
    expect(save.tournament!.bracket[0]).toContain('player');
  });

  it('renders the live bracket with the player highlighted', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.training.completed = TRAINING_STAGES.map((s) => s.id);
    save.profile.coins = 10000;
    app.go('tournament');
    click(app.uiRoot.querySelector('.card.interactive') as HTMLElement);

    expect(app.uiRoot.querySelectorAll('.bracket-round').length).toBeGreaterThan(0);
    expect(app.uiRoot.querySelectorAll('.bracket-slot.player').length).toBe(1);
    expect(text(app)).toContain('Your next bout');
  });
});

// ---------------------------------------------------------------- settings

describe('settings screen', () => {
  it('changes the graphics preset and marks it manual', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    app.go('settings');
    const ultra = Array.from(app.uiRoot.querySelectorAll('.seg button')).find(
      (b) => b.textContent === 'Ultra',
    ) as HTMLElement;
    click(ultra);
    expect(save.settings.graphics).toBe('ultra');
    expect(save.settings.manualGraphics).toBe(true);
  });

  it('toggles switches', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    const before = save.settings.dynamicResolution;
    app.go('settings');
    const sw = app.uiRoot.querySelector('.switch') as HTMLElement;
    click(sw);
    expect(save.settings.dynamicResolution).toBe(!before);
  });

  it('changes the control scheme', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    app.go('settings');
    const gestures = Array.from(app.uiRoot.querySelectorAll('.seg button')).find(
      (b) => b.textContent === 'Gestures',
    ) as HTMLElement;
    click(gestures);
    expect(save.settings.controls).toBe('gestures');
  });

  it('documents every gesture', async () => {
    const app = await makeApp();
    app.go('settings');
    const t = text(app);
    for (const g of ['Tap', 'Swipe up', 'Swipe down', 'Draw a circle', 'Double tap', 'Press and hold']) {
      expect(t).toContain(g);
    }
  });

  it('creates a manual save', async () => {
    const app = await makeApp();
    app.go('settings');
    click(findByText(app, 'Manual Save'));
    await tick();
    await tick();
    expect(await app.saves.hasManual()).toBe(true);
  });

  it('asks for confirmation before deleting a career', async () => {
    const app = await makeApp();
    app.go('settings');
    click(findByText(app, 'Delete Career'));
    expect(app.uiRoot.querySelector('.modal')).not.toBeNull();
    expect(text(app)).toContain('permanently erases');
    // Cancelling keeps the save.
    click(findByText(app, 'Cancel'));
    expect(app.save).not.toBeNull();
  });

  it('returns to the requested screen', async () => {
    const app = await makeApp();
    app.go('settings', { returnTo: 'profile' });
    click(app.uiRoot.querySelector('.icon-btn') as HTMLElement);
    expect(app.currentScreen).toBe('profile');
  });
});

// ----------------------------------------------------------------- profile

describe('profile screen', () => {
  it('shows career stats and switches tabs', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.record.wins = 12;
    save.record.losses = 3;
    save.record.matchesPlayed = 15;
    app.go('profile');
    expect(text(app)).toContain('12');
    expect(text(app)).toContain('Win Rate');

    click(findByText(app, 'Awards'));
    expect(text(app)).toContain('Achievements unlocked');

    click(findByText(app, 'History'));
    expect(text(app)).toContain('No matches yet');
  });

  it('lists match history when it exists', async () => {
    const app = await makeApp();
    app.requireSave().history = [
      {
        at: Date.now() - 60000,
        opponent: 'Kaito Mori',
        opponentClub: 'storm_falcons',
        division: 'amateur',
        won: true,
        method: 'By submission',
        scoreFor: 6,
        scoreAgainst: 2,
        xp: 210,
        coins: 400,
      },
    ];
    app.go('profile');
    click(findByText(app, 'History'));
    expect(text(app)).toContain('Kaito Mori');
    expect(text(app)).toContain('By submission');
  });
});

// ------------------------------------------------------------- persistence

describe('persistence through the UI', () => {
  it('saves the resume checkpoint as the player navigates', async () => {
    const app = await makeApp();
    app.go('skills');
    expect(app.requireSave().checkpoint.screen).toBe('skills');
    app.go('league');
    expect(app.requireSave().checkpoint.screen).toBe('league');
    // Transient screens are not used as a resume point.
    app.go('match');
    expect(app.requireSave().checkpoint.screen).toBe('league');
  });

  it('persists a skill purchase across a reload', async () => {
    const adapter = new MemAdapter();
    const { canvas, uiRoot } = setupDom();
    const app = new App(canvas, uiRoot);
    (app as unknown as { renderer: unknown }).renderer = stubRenderer();
    (app as unknown as { saves: SaveManager }).saves = new SaveManager(adapter);
    await app.saves.init();
    app.registerScreen('skills', renderSkills);
    app.registerScreen('hub', renderHub);

    const save = await app.saves.create('Persist Test');
    app.save = save;
    save.profile.skillPoints = 4;

    app.go('skills');
    click(findByText(app, 'Conditioning') ?? findByText(app, 'Cond'));
    click(app.uiRoot.querySelector('.skill-node.available') as HTMLElement);
    await app.commit('test');

    const reloaded = await new SaveManager(adapter).load();
    expect(reloaded?.profile.unlockedSkills.length).toBe(1);
    expect(reloaded?.profile.skillPoints).toBe(3);
  });

  it('awards achievements through commit()', async () => {
    const app = await makeApp();
    const save = app.requireSave();
    save.record.wins = 1;
    await app.commit('test');
    expect(save.achievements.some((a) => a.id === 'first_win')).toBe(true);
  });
});

// --------------------------------------------------------------- back nav

describe('back navigation', () => {
  it('returns to the hub from a sub-screen', async () => {
    const app = await makeApp();
    app.go('profile');
    click(app.uiRoot.querySelector('.icon-btn') as HTMLElement);
    expect(app.currentScreen).toBe('hub');
  });

  it('a screen back handler can swallow the event', async () => {
    const app = await makeApp();
    app.go('hub');
    let handled = 0;
    app.setBackHandler(() => {
      handled++;
      return true;
    });
    globalThis.dispatchEvent(new window.Event('popstate'));
    expect(handled).toBe(1);
    expect(app.currentScreen).toBe('hub');
  });
});
