import { describe, expect, it } from 'vitest';
import { MatchSim } from '../src/game/sim/combat';
import { emptyPassives } from '../src/game/data/skills';
import { MOVES, getMove, moveDuration } from '../src/game/data/moves';
import { baseAttributes, overallRating } from '../src/game/data/attributes';
import type { FighterConfig, MatchConfig, SimEvent } from '../src/game/sim/types';

const fighter = (id: string, over: Partial<FighterConfig> = {}): FighterConfig => ({
  id,
  name: id,
  shortName: id,
  attributes: baseAttributes(),
  style: 'allround',
  moves: ['jab_setup', 'collar_elbow', 'double_leg', 'half_nelson', 'underhook', 'hip_toss'],
  passives: emptyPassives(),
  tint: 0x2f6fd0,
  trunks: 0xe8442f,
  ...over,
});

const makeSim = (over: Partial<MatchConfig> = {}, onEvent?: (e: SimEvent) => void): MatchSim => {
  const cfg: MatchConfig = {
    format: 'exhibition',
    rounds: 1,
    roundSeconds: 120,
    arenaCrowd: 0.5,
    seed: 12345,
    player: fighter('player'),
    opponent: fighter('opponent'),
    difficulty: 0.7,
    ...over,
  };
  return new MatchSim(cfg, onEvent ? { onEvent } : {});
};

const run = (sim: MatchSim, seconds: number): void => {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && !sim.finished; i++) sim.step(1 / 60);
};

describe('move data integrity', () => {
  it('every move has a positive duration and sane numbers', () => {
    for (const m of MOVES) {
      expect(moveDuration(m), m.id).toBeGreaterThan(0);
      expect(m.damage, m.id).toBeGreaterThan(0);
      expect(m.staminaCost, m.id).toBeGreaterThanOrEqual(0);
      expect(m.baseAccuracy, m.id).toBeGreaterThan(0);
      expect(m.baseAccuracy, m.id).toBeLessThanOrEqual(1);
      expect(m.reversalResist, m.id).toBeGreaterThanOrEqual(0);
      expect(m.reversalResist, m.id).toBeLessThanOrEqual(1);
    }
  });

  it('has no duplicate move ids', () => {
    const ids = MOVES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every range has at least one starter-accessible move', () => {
    for (const range of ['standing', 'clinch', 'ground'] as const) {
      expect(MOVES.filter((m) => m.range === range && !m.unlock).length).toBeGreaterThan(0);
    }
  });
});

describe('MatchSim core', () => {
  it('is deterministic for the same seed and inputs', () => {
    const a = makeSim({ seed: 999 });
    const b = makeSim({ seed: 999 });
    run(a, 40);
    run(b, 40);
    expect(a.player.health).toBeCloseTo(b.player.health, 6);
    expect(a.opponent.health).toBeCloseTo(b.opponent.health, 6);
    expect(a.player.score).toBe(b.player.score);
    expect(a.opponent.score).toBe(b.opponent.score);
  });

  it('produces different outcomes for different seeds', () => {
    const a = makeSim({ seed: 1 });
    const b = makeSim({ seed: 777777 });
    run(a, 40);
    run(b, 40);
    const same =
      a.player.health === b.player.health && a.opponent.health === b.opponent.health;
    expect(same).toBe(false);
  });

  it('always terminates within the scheduled time', () => {
    const sim = makeSim({ rounds: 2, roundSeconds: 30 });
    run(sim, 200);
    expect(sim.finished).toBe(true);
    expect(sim.result).not.toBeNull();
  });

  it('never lets health, stamina or momentum go out of range', () => {
    const sim = makeSim({ rounds: 3, roundSeconds: 40, difficulty: 1 });
    for (let i = 0; i < 60 * 200 && !sim.finished; i++) {
      sim.step(1 / 60);
      for (const f of [sim.player, sim.opponent]) {
        expect(f.health).toBeGreaterThanOrEqual(0);
        expect(f.health).toBeLessThanOrEqual(f.maxHealth + 0.001);
        expect(f.stamina).toBeGreaterThanOrEqual(0);
        expect(f.stamina).toBeLessThanOrEqual(f.maxStamina + 0.001);
        expect(f.momentum).toBeGreaterThanOrEqual(0);
        expect(f.momentum).toBeLessThanOrEqual(f.maxMomentum + 0.001);
        expect(f.fatigue).toBeGreaterThanOrEqual(0);
        expect(f.fatigue).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps both wrestlers on the mat', () => {
    const sim = makeSim();
    for (let i = 0; i < 60 * 60 && !sim.finished; i++) {
      sim.step(1 / 60);
      sim.command({ c: 'walk', dx: 1, dz: 1 });
      for (const f of [sim.player, sim.opponent]) {
        expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(5.0);
      }
    }
  });
});

describe('move legality', () => {
  it('rejects moves outside the current stance', () => {
    const sim = makeSim();
    expect(sim.stance).toBe('standing');
    // half_nelson is a ground move.
    expect(sim.canStart('player', 'half_nelson').ok).toBe(false);
    expect(sim.canStart('player', 'half_nelson').reason).toBe('range');
    expect(sim.canStart('player', 'double_leg').ok).toBe(true);
  });

  it('rejects moves the fighter has not unlocked', () => {
    const sim = makeSim({ player: fighter('player', { moves: ['jab_setup'] }) });
    expect(sim.canStart('player', 'double_leg').reason).toBe('locked');
  });

  it('rejects moves when stamina is too low', () => {
    const sim = makeSim();
    sim.player.stamina = 1;
    expect(sim.canStart('player', 'double_leg').reason).toBe('stamina');
  });

  it('gates finishers behind full momentum', () => {
    const sim = makeSim({
      player: fighter('player', { moves: ['collar_elbow', 'fin_koshti_crusher', 'underhook'] }),
    });
    sim.command({ c: 'move', moveId: 'collar_elbow' });
    run(sim, 2);
    // Even in the clinch, no momentum means no finisher.
    sim.player.momentum = 0;
    if (sim.stance === 'clinch') {
      expect(sim.canStart('player', 'fin_koshti_crusher').reason).toBe('momentum');
      sim.player.momentum = sim.player.maxMomentum;
      sim.player.phase = 'idle';
      sim.player.move = null;
      expect(sim.canStart('player', 'fin_koshti_crusher').ok).toBe(true);
    }
  });

  it('gates signatures at half momentum', () => {
    const sim = makeSim({
      player: fighter('player', { moves: ['sig_lightning_roll', 'double_leg'] }),
    });
    sim.player.momentum = 10;
    expect(sim.canStart('player', 'sig_lightning_roll').ok).toBe(false);
  });

  it('cannot start a move while already committed to one', () => {
    const sim = makeSim();
    expect(sim.startMove('player', 'double_leg')).toBe(true);
    expect(sim.startMove('player', 'jab_setup')).toBe(false);
    expect(sim.canStart('player', 'jab_setup').reason).toBe('busy');
  });
});

describe('phases and damage', () => {
  it('runs windup → active → recovery → idle', () => {
    const sim = makeSim();
    sim.startMove('player', 'jab_setup');
    expect(sim.player.phase).toBe('windup');
    const m = getMove('jab_setup');
    run(sim, m.windup + 0.02);
    expect(['active', 'recovery']).toContain(sim.player.phase);
    run(sim, moveDuration(m) + 0.3);
    expect(sim.player.phase).toBe('idle');
  });

  it('deals damage to the opponent on a landed move', () => {
    // Give the attacker overwhelming stats AND options in every range, so the
    // AI cannot simply drag them into a position where they have no offense.
    const strong = fighter('player', {
      attributes: { ...baseAttributes(), speed: 99, technique: 99, strength: 99 },
    });
    const sim = makeSim({ player: strong });
    const before = sim.opponent.health;
    for (let i = 0; i < 60 * 30 && !sim.finished; i++) {
      if (sim.player.phase === 'idle') {
        const opt = sim.player.cfg.moves.find((m) => sim.canStart('player', m).ok);
        if (opt) sim.startMove('player', opt);
      }
      sim.step(1 / 60);
      if (sim.opponent.health < before) break;
    }
    expect(sim.opponent.health).toBeLessThan(before);
  });

  it('a fighter with no move available in the current range cannot attack', () => {
    // Standing-only moveset dragged into the clinch = genuinely stuck.
    const sim = makeSim({ player: fighter('player', { moves: ['jab_setup'] }) });
    sim.startMove('opponent', 'collar_elbow');
    run(sim, 3);
    if (sim.stance === 'clinch') {
      expect(sim.canStart('player', 'jab_setup').reason).toBe('range');
    }
  });

  it('drains stamina when moves are used', () => {
    const sim = makeSim();
    const before = sim.player.stamina;
    sim.startMove('player', 'double_leg');
    expect(sim.player.stamina).toBeLessThan(before);
  });

  it('regenerates stamina while idle', () => {
    const sim = makeSim();
    sim.player.stamina = 20;
    const before = sim.player.stamina;
    sim.player.phase = 'idle';
    run(sim, 3);
    expect(sim.player.stamina).toBeGreaterThan(before);
  });
});

describe('counters and reversals', () => {
  it('opens a counter window on the defender when a move starts', () => {
    const sim = makeSim();
    expect(sim.opponent.counterWindow).toBe(0);
    sim.startMove('player', 'double_leg');
    expect(sim.opponent.counterWindow).toBeGreaterThan(0);
  });

  it('cannot reverse with no window open', () => {
    const sim = makeSim();
    sim.player.counterWindow = 0;
    expect(sim.tryReversal('player')).toBe(false);
  });

  it('a high-technique defender reverses more often than a low one', () => {
    const attempt = (tech: number): number => {
      let successes = 0;
      for (let seed = 0; seed < 220; seed++) {
        const sim = makeSim({
          seed,
          player: fighter('player', { attributes: { ...baseAttributes(), technique: tech } }),
        });
        sim.startMove('opponent', 'double_leg');
        if (sim.tryReversal('player')) successes++;
      }
      return successes;
    };
    const low = attempt(20);
    const high = attempt(99);
    expect(high).toBeGreaterThan(low);
  });

  it('a successful reversal stuns the attacker and scores points', () => {
    const sim = makeSim({
      player: fighter('player', { attributes: { ...baseAttributes(), technique: 99, speed: 99 } }),
    });
    let reversed = false;
    for (let seed = 0; seed < 60 && !reversed; seed++) {
      const s = makeSim({
        seed,
        player: fighter('player', { attributes: { ...baseAttributes(), technique: 99, speed: 99 } }),
      });
      s.startMove('opponent', 'collar_elbow');
      if (s.tryReversal('player')) {
        expect(s.opponent.phase).toBe('stunned');
        expect(s.player.score).toBeGreaterThan(0);
        reversed = true;
      }
    }
    expect(reversed).toBe(true);
    expect(sim).toBeDefined();
  });
});

describe('rounds and outcomes', () => {
  it('advances rounds and pauses for an intermission', () => {
    const events: SimEvent[] = [];
    const sim = makeSim({ rounds: 2, roundSeconds: 5 }, (e) => events.push(e));
    run(sim, 6);
    expect(events.some((e) => e.t === 'round_end')).toBe(true);
    expect(sim.round).toBe(2);
    expect(sim.intermission).toBeGreaterThan(0);
  });

  it('decides on points when the clock expires', () => {
    const sim = makeSim({ rounds: 1, roundSeconds: 20 });
    run(sim, 60);
    expect(sim.finished).toBe(true);
    expect(sim.result?.outcome.type).toBe('points');
  });

  it('ends by knockout when health reaches zero', () => {
    const sim = makeSim({ rounds: 1, roundSeconds: 120 });
    sim.opponent.health = 0.5;
    sim.player.momentum = 0;
    run(sim, 20);
    expect(sim.finished).toBe(true);
    expect(['knockout', 'pin', 'submission']).toContain(sim.result?.outcome.type);
  });

  it('forfeits when the player retires', () => {
    const sim = makeSim();
    sim.retire();
    expect(sim.finished).toBe(true);
    expect(sim.result?.outcome.type).toBe('retired');
    if (sim.result && 'winner' in sim.result.outcome) {
      expect(sim.result.outcome.winner).toBe('opponent');
    }
  });

  it('records stats for the player only', () => {
    const sim = makeSim({ rounds: 1, roundSeconds: 45 });
    for (let i = 0; i < 45 * 60 && !sim.finished; i++) {
      if (sim.player.phase === 'idle' && i % 40 === 0) {
        const opts = sim.player.cfg.moves.filter((m) => sim.canStart('player', m).ok);
        if (opts.length) sim.command({ c: 'move', moveId: opts[0] });
      }
      sim.step(1 / 60);
    }
    expect(sim.stats.movesAttempted).toBeGreaterThan(0);
    expect(sim.stats.movesLanded).toBeLessThanOrEqual(sim.stats.movesAttempted);
  });
});

describe('difficulty scaling', () => {
  it('higher difficulty produces more damage to the player over a match', () => {
    const damageAt = (difficulty: number): number => {
      let total = 0;
      for (let seed = 0; seed < 14; seed++) {
        const sim = makeSim({ seed, difficulty, rounds: 1, roundSeconds: 70 });
        run(sim, 80);
        total += sim.player.maxHealth - sim.player.health;
      }
      return total;
    };
    expect(damageAt(1.0)).toBeGreaterThan(damageAt(0.25));
  });
});

describe('attributes', () => {
  it('overall rating responds to attribute changes', () => {
    const base = baseAttributes();
    const strong = { ...base, strength: 99, technique: 99 };
    expect(overallRating(strong)).toBeGreaterThan(overallRating(base));
  });

  it('rating stays within 0..99', () => {
    const maxed = {
      strength: 99, stamina: 99, speed: 99, technique: 99, defense: 99, charisma: 99,
    };
    expect(overallRating(maxed)).toBeLessThanOrEqual(99);
    expect(overallRating(baseAttributes())).toBeGreaterThan(0);
  });
});
