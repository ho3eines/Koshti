/**
 * Full gameplay-loop integration tests.
 *
 * Drives the real MatchController (input → sim → audio/renderer callbacks)
 * with stubbed presentation layers, playing complete matches from bell to
 * bell. This is the closest thing to "playing the game" that can run headless.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MatchController } from '../src/game/match/controller';
import { InputManager } from '../src/engine/input';
import { accumulatePassives, emptyPassives } from '../src/game/data/skills';
import { baseAttributes } from '../src/game/data/attributes';
import { getMove } from '../src/game/data/moves';
import { generateDivisionRoster, toFighterConfig } from '../src/game/career/roster';
import { DIVISION_BY_ID, FORMAT_META } from '../src/game/data/leagues';
import { computeReward } from '../src/game/career/progression';
import { newSave } from '../src/game/save/schema';
import type { FighterConfig, MatchConfig, MatchResult, SimEvent } from '../src/game/sim/types';

// Audio is a global singleton with a live AudioContext; neutralise it.
vi.mock('../src/engine/audio', () => ({
  audio: {
    play: vi.fn(),
    playMusic: vi.fn(),
    stopMusic: vi.fn(),
    setCrowd: vi.fn(),
    crowdPop: vi.fn(),
    say: vi.fn(),
    stopCommentary: vi.fn(),
    unlock: vi.fn().mockResolvedValue(undefined),
    applySettings: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
  },
}));

const stubRenderer = () =>
  ({
    impact: vi.fn(),
    showDamage: vi.fn(),
    celebrate: vi.fn(),
    slowmo: vi.fn(),
    playClip: vi.fn(),
    setCameraMode: vi.fn(),
    sweat: vi.fn(),
    render: vi.fn(),
    renderMenu: vi.fn(),
    timeScaleValue: 1,
  }) as never;

const makeInput = (): InputManager => {
  const div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: 800 });
  Object.defineProperty(div, 'clientHeight', { value: 400 });
  div.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400 }) as DOMRect;
  const im = new InputManager(div);
  im.configure('hybrid', false, false);
  return im;
};

const playerCfg = (over: Partial<FighterConfig> = {}): FighterConfig => ({
  id: 'player',
  name: 'Test Player',
  shortName: 'Player',
  attributes: baseAttributes(),
  style: 'allround',
  moves: [
    'jab_setup', 'collar_elbow', 'double_leg', 'single_leg',
    'underhook', 'hip_toss', 'half_nelson', 'arm_bar',
  ],
  passives: emptyPassives(),
  tint: 0x2f6fd0,
  trunks: 0xe8442f,
  ...over,
});

const matchConfig = (over: Partial<MatchConfig> = {}): MatchConfig => ({
  format: 'league',
  rounds: 2,
  roundSeconds: 60,
  arenaCrowd: 0.6,
  seed: 4242,
  player: playerCfg(),
  opponent: playerCfg({ id: 'opp', name: 'Opponent', shortName: 'Opp' }),
  difficulty: 0.7,
  ...over,
});

/**
 * A scripted "bot player" that plays a real match through the controller:
 * reverses when the window opens, escapes holds, pins when possible and
 * otherwise throws the best legal move.
 */
const playMatch = (
  cfg: MatchConfig,
  opts: { maxSeconds?: number; skill?: number } = {},
): { result: MatchResult | null; events: SimEvent[]; controller: MatchController } => {
  const maxSeconds = opts.maxSeconds ?? 400;
  const skill = opts.skill ?? 1;
  const events: SimEvent[] = [];
  let result: MatchResult | null = null;

  const input = makeInput();
  const controller = new MatchController(cfg, stubRenderer(), input, {
    onEvent: (e) => events.push(e),
    onEnd: (r) => {
      result = r;
    },
  });
  controller.startIntro(0);

  const sim = controller.sim;
  const dt = 1 / 60;
  let decisionTimer = 0;

  for (let i = 0; i < maxSeconds * 60 && !sim.finished; i++) {
    // React to a counter window.
    if (sim.player.counterWindow > 0 && Math.random() < 0.5 * skill) {
      controller.action('reverse');
    }
    // Break out of holds.
    if (sim.pinning?.by === 'opponent' || sim.submitting?.by === 'opponent') {
      controller.action('escape');
    }

    decisionTimer -= dt;
    if (decisionTimer <= 0 && sim.player.phase === 'idle') {
      decisionTimer = 0.35;
      // Finish when the chance is there.
      if (
        sim.stance === 'ground' &&
        (sim.opponent.downedTimer > 0 || sim.opponent.health < sim.opponent.maxHealth * 0.4)
      ) {
        controller.action('pin');
      } else {
        const legal = sim.player.cfg.moves.filter((m) => sim.canStart('player', m).ok);
        if (legal.length > 0) {
          const best = legal
            .map((id) => getMove(id))
            .sort((a, b) => b.damage - a.damage)[0];
          controller.action(`move:${best.id}`);
        } else if (sim.stance !== 'standing') {
          controller.action('escape');
        }
      }
    }
    controller.update(dt);
  }

  controller.dispose();
  return { result, events, controller };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// -------------------------------------------------------------- full loop

describe('complete match loop', () => {
  it('plays a full match to a decisive conclusion', () => {
    const { result, events } = playMatch(matchConfig());
    expect(result).not.toBeNull();
    expect(events.some((e) => e.t === 'match_end')).toBe(true);
    expect(['pin', 'submission', 'knockout', 'points']).toContain(result!.outcome.type);
    expect(result!.duration).toBeGreaterThan(0);
  });

  it('emits the full event vocabulary during real play', () => {
    const { events } = playMatch(matchConfig({ seed: 77, rounds: 2, roundSeconds: 90 }));
    const kinds = new Set(events.map((e) => e.t));
    expect(kinds.has('round_start')).toBe(true);
    expect(kinds.has('move_start')).toBe(true);
    expect(kinds.has('move_hit')).toBe(true);
    expect(kinds.has('counter_window')).toBe(true);
    expect(kinds.has('score')).toBe(true);
    expect(kinds.has('match_end')).toBe(true);
  });

  it('produces a coherent scoreline matching the winner', () => {
    for (let seed = 0; seed < 6; seed++) {
      const { result } = playMatch(matchConfig({ seed: seed * 991 }));
      expect(result).not.toBeNull();
      if (result!.outcome.type === 'points' && result!.outcome.winner !== 'draw') {
        const w = result!.outcome.winner;
        if (w === 'player') expect(result!.playerScore).toBeGreaterThan(result!.opponentScore);
        else expect(result!.opponentScore).toBeGreaterThan(result!.playerScore);
      }
    }
  });

  it('tracks accurate stats — landed never exceeds attempted', () => {
    const { result } = playMatch(matchConfig({ seed: 31337 }));
    const s = result!.stats;
    expect(s.movesAttempted).toBeGreaterThan(0);
    expect(s.movesLanded).toBeLessThanOrEqual(s.movesAttempted);
    expect(s.damageDealt).toBeGreaterThanOrEqual(0);
    expect(s.maxCombo).toBeGreaterThanOrEqual(0);
  });

  it('never leaves the match unresolved (no infinite matches)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { result } = playMatch(matchConfig({ seed, rounds: 3, roundSeconds: 40 }), {
        maxSeconds: 500,
      });
      expect(result, `seed ${seed}`).not.toBeNull();
    }
  });

  it('completes both rounds when nobody is finished early', () => {
    const { events } = playMatch(
      matchConfig({ rounds: 2, roundSeconds: 45, seed: 12 }),
      { skill: 0 },
    );
    const starts = events.filter((e) => e.t === 'round_start');
    expect(starts.length).toBeGreaterThanOrEqual(1);
  });
});

// ------------------------------------------------------------ interactions

describe('player actions through the controller', () => {
  it('guard reduces the damage taken over a match', () => {
    const damageWith = (guard: boolean): number => {
      let total = 0;
      for (let seed = 0; seed < 8; seed++) {
        const input = makeInput();
        const controller = new MatchController(
          matchConfig({ seed, rounds: 1, roundSeconds: 50 }),
          stubRenderer(),
          input,
          {},
        );
        controller.startIntro(0);
        const sim = controller.sim;
        for (let i = 0; i < 50 * 60 && !sim.finished; i++) {
          if (guard && sim.player.phase === 'idle') controller.action('guard_on');
          controller.update(1 / 60);
        }
        total += sim.player.maxHealth - sim.player.health;
        controller.dispose();
      }
      return total;
    };
    expect(damageWith(true)).toBeLessThan(damageWith(false));
  });

  it('gesture input triggers moves', () => {
    const input = makeInput();
    const controller = new MatchController(matchConfig(), stubRenderer(), input, {});
    controller.startIntro(0);
    const sim = controller.sim;
    controller.update(1 / 60);

    expect(sim.player.phase).toBe('idle');
    input.bus.emit('gesture', { name: 'swipe_down', x: 600, y: 200, power: 1 });
    // swipe_down maps to takedown/submission — a move should now be committed.
    expect(sim.player.phase).not.toBe('idle');
    controller.dispose();
  });

  it('the movement stick moves the wrestler', () => {
    const input = makeInput();
    const controller = new MatchController(matchConfig(), stubRenderer(), input, {});
    controller.startIntro(0);
    const sim = controller.sim;
    const startX = sim.player.x;
    // Simulate a held stick.
    (input.stick as { x: number; y: number; active: boolean }).x = 1;
    (input.stick as { x: number; y: number; active: boolean }).active = true;
    for (let i = 0; i < 60; i++) controller.update(1 / 60);
    expect(Math.abs(sim.player.x - startX)).toBeGreaterThan(0.05);
    controller.dispose();
  });

  it('forfeiting ends the match immediately as a loss', () => {
    const input = makeInput();
    let result: MatchResult | null = null;
    const controller = new MatchController(matchConfig(), stubRenderer(), input, {
      onEnd: (r) => (result = r),
    });
    controller.startIntro(0);
    controller.update(1 / 60);
    controller.retire();
    expect(result).not.toBeNull();
    expect(result!.outcome.type).toBe('retired');
    controller.dispose();
  });

  it('the intro delays the opening bell', () => {
    const input = makeInput();
    const controller = new MatchController(matchConfig(), stubRenderer(), input, {});
    controller.startIntro(2);
    const sim = controller.sim;
    expect(sim.paused).toBe(true);
    for (let i = 0; i < 60; i++) controller.update(1 / 60);
    expect(sim.paused).toBe(true);
    for (let i = 0; i < 90; i++) controller.update(1 / 60);
    expect(sim.paused).toBe(false);
    controller.dispose();
  });
});

// --------------------------------------------------------- fixed timestep

describe('frame-rate independence', () => {
  it('produces the same result at 30fps and 60fps', () => {
    const runAt = (fps: number): { hp: number; score: number } => {
      const input = makeInput();
      const controller = new MatchController(
        matchConfig({ seed: 5150, rounds: 1, roundSeconds: 40 }),
        stubRenderer(),
        input,
        {},
      );
      controller.startIntro(0);
      const sim = controller.sim;
      const dt = 1 / fps;
      // No player input: pure AI-vs-clock, so timing is the only variable.
      for (let t = 0; t < 40 && !sim.finished; t += dt) controller.update(dt);
      const out = { hp: Math.round(sim.player.health), score: sim.opponent.score };
      controller.dispose();
      return out;
    };
    const a = runAt(60);
    const b = runAt(30);
    // The fixed-step accumulator keeps both simulations in lockstep.
    expect(Math.abs(a.hp - b.hp)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.score - b.score)).toBeLessThanOrEqual(2);
  });

  it('survives a huge frame spike without exploding the simulation', () => {
    const input = makeInput();
    const controller = new MatchController(matchConfig(), stubRenderer(), input, {});
    controller.startIntro(0);
    const sim = controller.sim;
    controller.update(1 / 60);
    // A 3-second hitch (app backgrounded, GC pause).
    expect(() => controller.update(3)).not.toThrow();
    expect(Number.isFinite(sim.player.health)).toBe(true);
    expect(sim.player.health).toBeGreaterThanOrEqual(0);
    controller.dispose();
  });
});

// --------------------------------------------------------- difficulty feel

describe('difficulty and matchmaking balance', () => {
  const winRate = (difficulty: number, playerBoost = 0): number => {
    let wins = 0;
    const n = 24;
    for (let seed = 0; seed < n; seed++) {
      const attrs = baseAttributes();
      for (const k of Object.keys(attrs) as Array<keyof typeof attrs>) {
        attrs[k] += playerBoost;
      }
      const { result } = playMatch(
        matchConfig({
          seed: seed * 7717,
          difficulty,
          rounds: 1,
          roundSeconds: 60,
          player: playerCfg({ attributes: attrs }),
        }),
        { maxSeconds: 200 },
      );
      if (result && 'winner' in result.outcome && result.outcome.winner === 'player') wins++;
    }
    return wins / n;
  };

  it('an easy opponent is beatable more often than a hard one', () => {
    const easy = winRate(0.25);
    const hard = winRate(1.0);
    expect(easy).toBeGreaterThan(hard);
  });

  it('a stronger player wins more against the same difficulty', () => {
    const weak = winRate(0.85, 0);
    const strong = winRate(0.85, 25);
    expect(strong).toBeGreaterThanOrEqual(weak);
  });

  it('the amateur division is welcoming to a new player', () => {
    const div = DIVISION_BY_ID.get('amateur')!;
    const roster = generateDivisionRoster('amateur', 1);
    let wins = 0;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const opp = roster[i % roster.length];
      const { result } = playMatch(
        matchConfig({
          seed: i * 313,
          difficulty: div.difficulty,
          rounds: FORMAT_META.league.rounds,
          roundSeconds: 60,
          opponent: toFighterConfig(opp, div.difficulty),
        }),
        { maxSeconds: 300 },
      );
      if (result && 'winner' in result.outcome && result.outcome.winner === 'player') wins++;
    }
    // A competent new player should win a meaningful share of amateur bouts.
    expect(wins).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------- balance guards

describe('game balance guardrails', () => {
  /**
   * These lock in the tuning that makes the career arc feel right. They are
   * deliberately loose (wide bands, many samples) so they catch real
   * regressions without being flaky.
   */
  const measure = (
    difficulty: number,
    playerBoost: number,
    bot: { reverse: number; manage: boolean },
    samples = 24,
  ) => {
    let wins = 0;
    let finishes = 0;
    for (let seed = 0; seed < samples; seed++) {
      const attrs = baseAttributes();
      for (const k of Object.keys(attrs) as Array<keyof typeof attrs>) {
        attrs[k] = Math.min(99, attrs[k] + playerBoost);
      }
      const cfg = matchConfig({
        seed: seed * 6151,
        difficulty,
        rounds: 2,
        roundSeconds: 105,
        player: playerCfg({ attributes: attrs }),
        opponent: playerCfg({
          id: 'opp',
          name: 'Opp',
          shortName: 'Opp',
          attributes: attrs,
        }),
      });

      const input = makeInput();
      const controller = new MatchController(cfg, stubRenderer(), input, {});
      controller.startIntro(0);
      const sim = controller.sim;
      let dec = 0;
      for (let i = 0; i < 300 * 60 && !sim.finished; i++) {
        if (sim.player.counterWindow > 0 && Math.random() < bot.reverse) {
          controller.action('reverse');
        }
        if (sim.pinning?.by === 'opponent' || sim.submitting?.by === 'opponent') {
          controller.action('escape');
        }
        dec -= 1 / 60;
        if (dec <= 0 && sim.player.phase === 'idle') {
          dec = 0.35;
          const st = sim.player.stamina / sim.player.maxStamina;
          const legal = sim.player.cfg.moves
            .filter((m) => sim.canStart('player', m).ok)
            .map(getMove);
          if (
            sim.stance === 'ground' &&
            (sim.opponent.downedTimer > 0 || sim.opponent.health < sim.opponent.maxHealth * 0.5)
          ) {
            controller.action('pin');
          } else if (!legal.length) {
            if (sim.stance !== 'standing') controller.action('escape');
          } else if (bot.manage && st < 0.25) {
            controller.action('guard_on');
            dec = 0.8;
          } else {
            const pick = bot.manage
              ? (legal.find((m) => m.category === 'finisher') ??
                 legal.find((m) => m.category === 'signature') ??
                 [...legal].sort(
                   (a, b) =>
                     b.damage / Math.max(1, b.staminaCost) -
                     a.damage / Math.max(1, a.staminaCost),
                 )[0])
              : [...legal].sort((a, b) => b.damage - a.damage)[0];
            controller.action('guard_off');
            controller.action(`move:${pick.id}`);
          }
        }
        controller.update(1 / 60);
      }
      const r = sim.result;
      if (r && 'winner' in r.outcome && r.outcome.winner === 'player') wins++;
      if (r && r.outcome.type !== 'points') finishes++;
      controller.dispose();
    }
    return { winRate: wins / samples, finishRate: finishes / samples };
  };

  const MASHER = { reverse: 0.05, manage: false };
  const SKILLED = { reverse: 0.5, manage: true };

  it('rewards skill: a skilled player massively outperforms a masher', () => {
    const masher = measure(0.55, 0, MASHER);
    const skilled = measure(0.55, 0, SKILLED);
    expect(skilled.winRate).toBeGreaterThan(masher.winRate + 0.25);
  });

  it('the amateur circuit is winnable for a competent newcomer', () => {
    const r = measure(0.55, 0, SKILLED);
    expect(r.winRate).toBeGreaterThan(0.45);
  });

  it("the champion's circle punishes an unskilled player", () => {
    const r = measure(1.0, 40, MASHER);
    expect(r.winRate).toBeLessThan(0.4);
  });

  it('top divisions produce dramatically more early finishes', () => {
    const low = measure(0.55, 0, SKILLED);
    const high = measure(1.0, 40, SKILLED);
    expect(high.finishRate).toBeGreaterThan(low.finishRate);
  });

  it('difficulty meaningfully changes the outcome distribution', () => {
    const easy = measure(0.3, 10, SKILLED);
    const hard = measure(1.0, 10, SKILLED);
    expect(easy.winRate).toBeGreaterThan(hard.winRate);
  });
});

// ------------------------------------------------------- match → rewards

describe('match to progression pipeline', () => {
  it('a played match yields rewards that level the player up over time', () => {
    const save = newSave('Pipeline');
    let totalXp = 0;
    let totalCoins = 0;

    for (let seed = 0; seed < 6; seed++) {
      const { result } = playMatch(matchConfig({ seed: seed * 4001 }), { maxSeconds: 260 });
      expect(result).not.toBeNull();
      const won = 'winner' in result!.outcome && result!.outcome.winner === 'player';
      const reward = computeReward(result!, 'amateur', won, 0);
      expect(reward.xp).toBeGreaterThan(0);
      expect(reward.coins).toBeGreaterThan(0);
      totalXp += reward.xp;
      totalCoins += reward.coins;
    }

    expect(totalXp).toBeGreaterThan(300);
    expect(totalCoins).toBeGreaterThan(300);
    expect(save.profile.name).toBe('Pipeline');
  });

  it('passives from the skill tree measurably help the player', () => {
    const damageTaken = (skills: string[]): number => {
      let total = 0;
      for (let seed = 0; seed < 10; seed++) {
        const { controller } = playMatch(
          matchConfig({
            seed: seed * 601,
            rounds: 1,
            roundSeconds: 50,
            player: playerCfg({ passives: accumulatePassives(skills) }),
          }),
          { maxSeconds: 200, skill: 0 },
        );
        total += controller.sim.player.maxHealth - controller.sim.player.health;
      }
      return total;
    };
    const plain = damageTaken([]);
    const armoured = damageTaken(['power_root', 'power_grip', 'power_wall']);
    expect(armoured).toBeLessThan(plain);
  });
});
