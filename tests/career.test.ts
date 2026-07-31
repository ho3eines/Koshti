import { describe, expect, it, beforeEach } from 'vitest';
import { newSave, migrate, SAVE_VERSION, type SaveGame } from '../src/game/save/schema';
import { SaveManager, type StorageAdapter } from '../src/game/save/storage';
import {
  applyXp,
  computeReward,
  purchaseSkill,
  trainAttribute,
  trainAttributeCost,
  xpForLevel,
} from '../src/game/career/progression';
import { ACHIEVEMENTS, evaluateAchievements } from '../src/game/career/achievements';
import { SKILL_TREE, SKILL_BY_ID, accumulatePassives } from '../src/game/data/skills';
import { hasMove, resolveUnlockToMoveId } from '../src/game/data/moves';
import { generateDivisionRoster, generateWrestler } from '../src/game/career/roster';
import {
  advanceTournament,
  buildLeaderboard,
  createTournament,
  leagueSlate,
  recordLeagueResult,
  roundName,
  tournamentOpponent,
} from '../src/game/career/league';
import { DIVISIONS, DIVISION_BY_ID, nextDivision } from '../src/game/data/leagues';
import { TRAINING_STAGES, nextStage, stageUnlocked, starsForTime } from '../src/game/career/training';
import { Rng } from '../src/core/rng';
import { ATTRIBUTE_CAP, overallRating } from '../src/game/data/attributes';
import type { MatchResult } from '../src/game/sim/types';

class FakeAdapter implements StorageAdapter {
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

// ---------------------------------------------------------------- save data

describe('save schema', () => {
  it('creates a valid new save', () => {
    const s = newSave('Rustam');
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.profile.name).toBe('Rustam');
    expect(s.profile.level).toBe(1);
    expect(s.profile.unlockedMoves.length).toBeGreaterThan(0);
    expect(s.league.division).toBe('amateur');
    expect(s.checkpoint.screen).toBe('hub');
  });

  it('migrates a partial legacy save without losing the profile', () => {
    const legacy = {
      version: 1,
      profile: { name: 'Old Timer', level: 7, coins: 900 },
      record: { wins: 4 },
    };
    const migrated = migrate(legacy);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated!.profile.name).toBe('Old Timer');
    expect(migrated!.profile.level).toBe(7);
    expect(migrated!.profile.coins).toBe(900);
    expect(migrated!.record.wins).toBe(4);
    // Missing fields are backfilled.
    expect(migrated!.profile.attributes.strength).toBeGreaterThan(0);
    expect(migrated!.settings.graphics).toBeDefined();
    expect(Array.isArray(migrated!.history)).toBe(true);
  });

  it('rejects garbage', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({})).toBeNull();
    expect(migrate({ profile: {} })).toBeNull();
    expect(migrate('nope')).toBeNull();
  });
});

describe('SaveManager', () => {
  let adapter: FakeAdapter;
  let mgr: SaveManager;

  beforeEach(async () => {
    adapter = new FakeAdapter();
    mgr = new SaveManager(adapter);
    await mgr.init();
  });

  it('reports no save on a fresh install', async () => {
    expect((await mgr.peek()).exists).toBe(false);
    expect(await mgr.load()).toBeNull();
  });

  it('creates, persists and reloads a career', async () => {
    const created = await mgr.create('Davit');
    created.profile.coins = 4242;
    await mgr.flush('Test');

    const fresh = new SaveManager(adapter);
    await fresh.init();
    const loaded = await fresh.load();
    expect(loaded?.profile.name).toBe('Davit');
    expect(loaded?.profile.coins).toBe(4242);
  });

  it('peek returns resume metadata without a full load', async () => {
    const s = await mgr.create('Kenji');
    s.profile.level = 12;
    s.league.division = 'professional';
    await mgr.flush('Won title match');
    const meta = await mgr.peek();
    expect(meta.exists).toBe(true);
    expect(meta.name).toBe('Kenji');
    expect(meta.level).toBe(12);
    expect(meta.division).toBe('professional');
    expect(meta.label).toBe('Won title match');
  });

  it('falls back to the backup slot when the primary save is corrupt', async () => {
    await mgr.create('Tariq');
    await mgr.flush('good save');
    // Force a backup to exist, then corrupt the primary.
    adapter.store.set('koshti.save.backup', adapter.store.get('koshti.save.v1')!);
    adapter.store.set('koshti.save.v1', '{{{ not json');

    const fresh = new SaveManager(adapter);
    await fresh.init();
    const loaded = await fresh.load();
    expect(loaded?.profile.name).toBe('Tariq');
  });

  it('supports manual save slots independently of autosave', async () => {
    const s = await mgr.create('Miro');
    s.profile.coins = 100;
    await mgr.manualSave();
    s.profile.coins = 999;
    await mgr.flush('after manual');
    const manual = await mgr.loadManual();
    expect(manual?.profile.coins).toBe(100);
  });

  it('round-trips export/import', async () => {
    const s = await mgr.create('Levan');
    s.profile.level = 9;
    s.profile.coins = 7777;
    await mgr.flush();
    const code = mgr.exportString();

    const other = new SaveManager(new FakeAdapter());
    await other.init();
    const imported = await other.importString(code);
    expect(imported?.profile.name).toBe('Levan');
    expect(imported?.profile.level).toBe(9);
    expect(imported?.profile.coins).toBe(7777);
  });

  it('rejects an invalid import code', async () => {
    expect(await mgr.importString('total garbage')).toBeNull();
  });

  it('wipes everything', async () => {
    await mgr.create('Gone');
    await mgr.manualSave();
    await mgr.wipe();
    expect((await mgr.peek()).exists).toBe(false);
    expect(await mgr.hasManual()).toBe(false);
  });
});

// -------------------------------------------------------------- progression

describe('XP and levelling', () => {
  it('requires more XP at higher levels', () => {
    expect(xpForLevel(5)).toBeGreaterThan(xpForLevel(1));
    expect(xpForLevel(20)).toBeGreaterThan(xpForLevel(10));
  });

  it('levels up and awards skill points', () => {
    const s = newSave('Test');
    const info = applyXp(s, xpForLevel(1) + 10);
    expect(info.levelsGained).toBe(1);
    expect(s.profile.level).toBe(2);
    expect(info.skillPointsGained).toBeGreaterThanOrEqual(1);
  });

  it('handles multiple level-ups from one large award', () => {
    const s = newSave('Test');
    const info = applyXp(s, 100000);
    expect(info.levelsGained).toBeGreaterThan(3);
    expect(s.profile.level).toBe(info.newLevel);
    expect(s.profile.xp).toBeLessThan(xpForLevel(s.profile.level));
  });

  it('gives a bonus skill point every 5th level', () => {
    const s = newSave('Test');
    let total = 0;
    for (let i = 0; i < 10; i++) total += applyXp(s, xpForLevel(s.profile.level)).skillPointsGained;
    // 10 levels = 10 base + 2 bonuses (levels 5 and 10).
    expect(total).toBe(12);
  });
});

describe('rewards', () => {
  const result = (over: Partial<MatchResult> = {}): MatchResult => ({
    outcome: { type: 'points', winner: 'player' },
    playerScore: 8,
    opponentScore: 4,
    rounds: 2,
    duration: 120,
    stats: {
      movesLanded: 12,
      movesAttempted: 18,
      reversals: 2,
      reversalsAgainst: 1,
      biggestHit: 22,
      finishersLanded: 0,
      perfectCounters: 0,
      damageDealt: 140,
      damageTaken: 90,
      maxCombo: 2,
    },
    ...over,
  });

  it('pays more for a win than a loss', () => {
    const win = computeReward(result(), 'amateur', true, 0);
    const loss = computeReward(result(), 'amateur', false, 0);
    expect(win.xp).toBeGreaterThan(loss.xp);
    expect(win.coins).toBeGreaterThan(loss.coins);
  });

  it('pays more in higher divisions', () => {
    const low = computeReward(result(), 'amateur', true, 0);
    const high = computeReward(result(), 'champion', true, 0);
    expect(high.coins).toBeGreaterThan(low.coins * 4);
    expect(high.xp).toBeGreaterThan(low.xp);
  });

  it('awards bonuses for finishers, combos and flawless wins', () => {
    const base = computeReward(result(), 'semipro', true, 0);
    const flashy = computeReward(
      result({
        outcome: { type: 'submission', winner: 'player' },
        stats: { ...result().stats, finishersLanded: 1, maxCombo: 5, perfectCounters: 3, damageTaken: 10 },
      }),
      'semipro',
      true,
      0,
    );
    expect(flashy.xp).toBeGreaterThan(base.xp);
    expect(flashy.bonuses.length).toBeGreaterThan(base.bonuses.length);
  });

  it('applies the crowd favour multiplier', () => {
    const plain = computeReward(result(), 'semipro', true, 0);
    const boosted = computeReward(result(), 'semipro', true, 0.25);
    expect(boosted.coins).toBeGreaterThan(plain.coins);
  });

  it('awards league points only for non-losses', () => {
    expect(computeReward(result(), 'amateur', true, 0).leaguePoints).toBeGreaterThan(0);
    expect(computeReward(result(), 'amateur', false, 0).leaguePoints).toBe(0);
    const draw = computeReward(
      result({ outcome: { type: 'points', winner: 'draw' } }),
      'amateur',
      false,
      0,
    );
    expect(draw.leaguePoints).toBe(1);
  });
});

// ------------------------------------------------------------- skill tree

describe('skill tree', () => {
  it('has no broken prerequisite references', () => {
    for (const node of SKILL_TREE) {
      for (const req of node.requires) {
        expect(SKILL_BY_ID.has(req), `${node.id} requires missing ${req}`).toBe(true);
      }
    }
  });

  it('has no cyclic prerequisites', () => {
    const seen = new Map<string, number>();
    const visit = (id: string, stack: Set<string>): void => {
      if (stack.has(id)) throw new Error(`Cycle at ${id}`);
      if (seen.has(id)) return;
      stack.add(id);
      for (const r of SKILL_BY_ID.get(id)?.requires ?? []) visit(r, stack);
      stack.delete(id);
      seen.set(id, 1);
    };
    expect(() => {
      for (const n of SKILL_TREE) visit(n.id, new Set());
    }).not.toThrow();
  });

  it('requires prerequisites before purchase', () => {
    const s = newSave('Test');
    s.profile.skillPoints = 50;
    const res = purchaseSkill(s, 'power_suplex');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('previous');
  });

  it('spends points and grants attributes plus move unlocks', () => {
    const s = newSave('Test');
    s.profile.skillPoints = 20;
    const strBefore = s.profile.attributes.strength;

    expect(purchaseSkill(s, 'power_root').ok).toBe(true);
    expect(s.profile.attributes.strength).toBe(strBefore + 3);
    expect(s.profile.skillPoints).toBe(19);

    expect(purchaseSkill(s, 'power_grip').ok).toBe(true);
    expect(purchaseSkill(s, 'power_suplex').ok).toBe(true);
    // The stored value must be the real move id, not the unlock token.
    expect(s.profile.unlockedMoves).toContain('suplex');
  });

  it('refuses to double-buy a node', () => {
    const s = newSave('Test');
    s.profile.skillPoints = 10;
    purchaseSkill(s, 'tech_root');
    expect(purchaseSkill(s, 'tech_root').ok).toBe(false);
  });

  it('refuses purchases without enough points', () => {
    const s = newSave('Test');
    s.profile.skillPoints = 0;
    expect(purchaseSkill(s, 'cond_root').ok).toBe(false);
  });

  it('unlocks a REAL move id, not the skill unlock token (regression)', () => {
    // Skill nodes reference moves by an unlock token ('power_suplex') which is
    // not the move's id ('suplex'). Storing the token used to poison the save
    // and crash the next match with "Unknown move".
    const s = newSave('Test');
    s.profile.skillPoints = 50;
    purchaseSkill(s, 'power_root');
    purchaseSkill(s, 'power_grip');
    purchaseSkill(s, 'power_suplex');
    expect(s.profile.unlockedMoves).toContain('suplex');
    expect(s.profile.unlockedMoves).not.toContain('power_suplex');
    for (const id of s.profile.unlockedMoves) {
      expect(hasMove(id), `unlocked move "${id}" does not exist`).toBe(true);
    }
  });

  it('every move-unlocking node resolves to a real move', () => {
    const s = newSave('Test');
    s.profile.skillPoints = 999;
    for (let pass = 0; pass < 8; pass++) for (const n of SKILL_TREE) purchaseSkill(s, n.id);
    const unlockers = SKILL_TREE.filter((n) => n.unlocksMove);
    expect(unlockers.length).toBeGreaterThan(4);
    for (const n of unlockers) {
      const id = resolveUnlockToMoveId(n.unlocksMove!);
      expect(id, `${n.id} -> ${n.unlocksMove}`).not.toBeNull();
      expect(s.profile.unlockedMoves).toContain(id!);
    }
    for (const id of s.profile.unlockedMoves) expect(hasMove(id)).toBe(true);
  });

  it('every training reward unlocks a real move', () => {
    for (const stage of TRAINING_STAGES) {
      if (!stage.rewards.unlocksMove) continue;
      const id = resolveUnlockToMoveId(stage.rewards.unlocksMove);
      expect(id, `${stage.id} -> ${stage.rewards.unlocksMove}`).not.toBeNull();
      expect(hasMove(id!)).toBe(true);
    }
  });

  it('accumulates passive bonuses from owned nodes', () => {
    const p = accumulatePassives(['tech_counter', 'show_momentum', 'cond_recovery']);
    expect(p.reversalWindow).toBeGreaterThan(0);
    expect(p.momentumGain).toBeGreaterThan(0);
    expect(p.staminaRegen).toBeGreaterThan(0);
    expect(p.damageReduction).toBe(0);
  });

  it('the full tree is reachable with enough points', () => {
    const s = newSave('Test');
    s.profile.skillPoints = 999;
    let bought = 0;
    for (let pass = 0; pass < 8; pass++) {
      for (const n of SKILL_TREE) {
        if (purchaseSkill(s, n.id).ok) bought++;
      }
    }
    expect(bought).toBe(SKILL_TREE.length);
  });
});

describe('attribute training', () => {
  it('costs more as the attribute rises', () => {
    expect(trainAttributeCost(80)).toBeGreaterThan(trainAttributeCost(40));
  });

  it('spends coins and raises the attribute by one', () => {
    const s = newSave('Test');
    s.profile.coins = 100000;
    const before = s.profile.attributes.speed;
    const res = trainAttribute(s, 'speed');
    expect(res.ok).toBe(true);
    expect(s.profile.attributes.speed).toBe(before + 1);
    expect(s.profile.coins).toBeLessThan(100000);
  });

  it('refuses when broke', () => {
    const s = newSave('Test');
    s.profile.coins = 0;
    expect(trainAttribute(s, 'speed').ok).toBe(false);
  });

  it('respects the attribute cap', () => {
    const s = newSave('Test');
    s.profile.coins = 10 ** 9;
    s.profile.attributes.defense = ATTRIBUTE_CAP;
    expect(trainAttribute(s, 'defense').ok).toBe(false);
  });
});

// ------------------------------------------------------------ achievements

describe('achievements', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('unlocks on the first win and pays out once', () => {
    const s = newSave('Test');
    s.record.wins = 1;
    const first = evaluateAchievements(s);
    expect(first.some((a) => a.id === 'first_win')).toBe(true);
    const coinsAfter = s.profile.coins;
    const second = evaluateAchievements(s);
    expect(second.length).toBe(0);
    expect(s.profile.coins).toBe(coinsAfter);
  });

  it('unlocks division milestones as the career advances', () => {
    const s = newSave('Test');
    s.league.division = 'champion';
    const fresh = evaluateAchievements(s);
    const ids = fresh.map((a) => a.id);
    expect(ids).toContain('semipro');
    expect(ids).toContain('professional');
    expect(ids).toContain('elite');
    expect(ids).toContain('champion');
  });
});

// ------------------------------------------------------------------ roster

describe('roster generation', () => {
  it('is deterministic per division and season', () => {
    const a = generateDivisionRoster('semipro', 3);
    const b = generateDivisionRoster('semipro', 3);
    expect(a.map((w) => w.id)).toEqual(b.map((w) => w.id));
    expect(a.map((w) => w.rating)).toEqual(b.map((w) => w.rating));
  });

  it('changes between seasons', () => {
    const s1 = generateDivisionRoster('semipro', 1);
    const s2 = generateDivisionRoster('semipro', 2);
    expect(s1.map((w) => w.id)).not.toEqual(s2.map((w) => w.id));
  });

  it('keeps ratings roughly inside the division band', () => {
    for (const div of DIVISIONS) {
      const roster = generateDivisionRoster(div.id, 1);
      for (const w of roster) {
        expect(w.rating, `${div.id}/${w.name}`).toBeGreaterThanOrEqual(div.ratingRange[0] - 8);
        expect(w.rating, `${div.id}/${w.name}`).toBeLessThanOrEqual(div.ratingRange[1] + 8);
      }
    }
  });

  it('gives every wrestler at least one move per range', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 40; i++) {
      const w = generateWrestler(rng, 'professional', i % 12);
      expect(w.moves.length).toBeGreaterThanOrEqual(3);
      expect(w.rating).toBe(overallRating(w.attributes));
    }
  });

  it('gives elite wrestlers finishers', () => {
    const roster = generateDivisionRoster('champion', 1);
    const withFinishers = roster.filter((w) =>
      w.moves.some((m) => m.startsWith('fin_')),
    );
    expect(withFinishers.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ league

describe('league progression', () => {
  it('offers three opponents normally', () => {
    const s = newSave('Test');
    const slate = leagueSlate(s);
    expect(slate.length).toBe(3);
    expect(slate.every((o) => o.wrestler.division === 'amateur')).toBe(true);
  });

  it('offers a single top-rated opponent for a promotion bout', () => {
    const s = newSave('Test');
    s.league.promotionAvailable = true;
    const slate = leagueSlate(s);
    expect(slate.length).toBe(1);
    expect(slate[0].isPromotionBout).toBe(true);
    const roster = generateDivisionRoster('amateur', 1);
    const best = Math.max(...roster.map((w) => w.rating));
    expect(slate[0].wrestler.rating).toBe(best);
  });

  it('unlocks the promotion bout after enough wins', () => {
    const s = newSave('Test');
    const need = DIVISION_BY_ID.get('amateur')!.winsToPromote;
    let unlocked = false;
    for (let i = 0; i < need; i++) {
      const u = recordLeagueResult(s, `opp_${i}`, true, 3, false);
      if (u.promotionUnlocked) unlocked = true;
    }
    expect(unlocked).toBe(true);
    expect(s.league.promotionAvailable).toBe(true);
  });

  it('promotes on a won promotion bout and resets division stats', () => {
    const s = newSave('Test');
    s.league.promotionAvailable = true;
    s.league.winsInDivision = 5;
    s.league.points = 30;
    const u = recordLeagueResult(s, 'boss', true, 4, true);
    expect(u.promoted).toBe(true);
    expect(u.newDivision).toBe('semipro');
    expect(s.league.division).toBe('semipro');
    expect(s.league.winsInDivision).toBe(0);
    expect(s.league.points).toBe(0);
  });

  it('does not promote on a lost promotion bout', () => {
    const s = newSave('Test');
    s.league.promotionAvailable = true;
    const u = recordLeagueResult(s, 'boss', false, 0, true);
    expect(u.promoted).toBe(false);
    expect(s.league.division).toBe('amateur');
    expect(s.league.promotionAvailable).toBe(false);
  });

  it('awards the world title at the top of the ladder', () => {
    const s = newSave('Test');
    s.league.division = 'champion';
    s.league.promotionAvailable = true;
    recordLeagueResult(s, 'goat', true, 4, true);
    expect(s.league.titlesHeld).toContain('world:champion');
    expect(nextDivision('champion')).toBeNull();
  });

  it('walks the full ladder amateur → champion', () => {
    const s = newSave('Test');
    for (const div of DIVISIONS) {
      if (s.league.division !== div.id) break;
      const need = div.winsToPromote;
      for (let i = 0; i < need; i++) recordLeagueResult(s, `w${div.id}${i}`, true, 3, false);
      if (nextDivision(div.id)) recordLeagueResult(s, 'boss', true, 4, true);
    }
    expect(s.league.division).toBe('champion');
  });

  it('builds a leaderboard that includes the player exactly once', () => {
    const s = newSave('Test');
    s.league.points = 15;
    const board = buildLeaderboard(s);
    const me = board.filter((e) => e.isPlayer);
    expect(me.length).toBe(1);
    expect(me[0].name).toBe('Test');
    // Sorted descending by points.
    for (let i = 1; i < board.length; i++) {
      expect(board[i - 1].points).toBeGreaterThanOrEqual(board[i].points);
    }
  });
});

// -------------------------------------------------------------- tournaments

describe('tournaments', () => {
  it('creates a bracket containing the player', () => {
    const s = newSave('Test');
    const t = createTournament(s, 'Test Open', 8);
    expect(t.bracket[0].length).toBe(8);
    expect(t.bracket[0]).toContain('player');
    expect(t.prize).toBeGreaterThan(0);
  });

  it('finds the player an opponent each round', () => {
    const s = newSave('Test');
    const t = createTournament(s, 'Test Open', 8);
    const opp = tournamentOpponent(t);
    expect(opp).not.toBeNull();
    expect(opp).not.toBe('player');
  });

  it('advances the player through the bracket on wins', () => {
    const s = newSave('Test');
    const t = createTournament(s, 'Test Open', 8);
    let r = advanceTournament(t, true);
    expect(r.finished).toBe(false);
    expect(t.bracket[1].length).toBe(4);
    expect(t.bracket[1]).toContain('player');

    r = advanceTournament(t, true);
    expect(t.bracket[2].length).toBe(2);
    expect(t.bracket[2]).toContain('player');

    r = advanceTournament(t, true);
    expect(r.finished).toBe(true);
    expect(r.championId).toBe('player');
    expect(t.completed).toBe(true);
  });

  it('eliminates the player on a loss and still crowns a champion', () => {
    const s = newSave('Test');
    const t = createTournament(s, 'Test Open', 8);
    const r = advanceTournament(t, false);
    expect(t.eliminated).toBe(true);
    expect(r.finished).toBe(true);
    expect(r.championId).not.toBe('player');
    expect(r.championId).toBeTruthy();
  });

  it('handles a 4-wrestler bracket', () => {
    const s = newSave('Test');
    const t = createTournament(s, 'Fast Four', 4);
    expect(t.bracket[0].length).toBe(4);
    advanceTournament(t, true);
    const r = advanceTournament(t, true);
    expect(r.finished).toBe(true);
    expect(r.championId).toBe('player');
  });

  it('names rounds correctly', () => {
    expect(roundName(2)).toBe('Final');
    expect(roundName(4)).toBe('Semi-Final');
    expect(roundName(8)).toBe('Quarter-Final');
    expect(roundName(16)).toBe('Round of 16');
  });
});

// ---------------------------------------------------------------- training

describe('training stages', () => {
  it('forms an unbroken chain of prerequisites', () => {
    const ids = new Set(TRAINING_STAGES.map((s) => s.id));
    for (const s of TRAINING_STAGES) {
      if (s.requires) expect(ids.has(s.requires), `${s.id} needs ${s.requires}`).toBe(true);
    }
    expect(TRAINING_STAGES[0].requires).toBeNull();
  });

  it('only unlocks the first stage on a fresh save', () => {
    const completed: string[] = [];
    const unlocked = TRAINING_STAGES.filter((s) => stageUnlocked(s, completed));
    expect(unlocked.length).toBe(1);
    expect(unlocked[0].id).toBe('stance');
  });

  it('advances through every stage in order', () => {
    const completed: string[] = [];
    for (let i = 0; i < TRAINING_STAGES.length; i++) {
      const next = nextStage(completed);
      expect(next, `stage ${i}`).not.toBeNull();
      expect(stageUnlocked(next!, completed)).toBe(true);
      completed.push(next!.id);
    }
    expect(nextStage(completed)).toBeNull();
  });

  it('awards more stars for faster clears', () => {
    const stage = TRAINING_STAGES[1];
    expect(starsForTime(stage, stage.starTimes[2] - 1)).toBe(3);
    expect(starsForTime(stage, stage.starTimes[1] - 1)).toBe(2);
    expect(starsForTime(stage, stage.starTimes[0] - 1)).toBe(1);
    expect(starsForTime(stage, 99999)).toBe(1);
  });

  it('every stage has objectives and rewards', () => {
    for (const s of TRAINING_STAGES) {
      expect(s.objectives.length, s.id).toBeGreaterThan(0);
      expect(s.rewards.xp, s.id).toBeGreaterThan(0);
      for (const o of s.objectives) {
        expect(o.target, `${s.id}/${o.id}`).toBeGreaterThan(0);
        expect(o.hint.length, `${s.id}/${o.id}`).toBeGreaterThan(10);
      }
    }
  });
});

// -------------------------------------------------------- full career smoke

describe('end-to-end career simulation', () => {
  it('a player can go from rookie to champion without breaking invariants', () => {
    const s: SaveGame = newSave('Journey');

    // Complete training.
    for (const stage of TRAINING_STAGES) {
      s.training.completed.push(stage.id);
      s.training.stars[stage.id] = 3;
      applyXp(s, stage.rewards.xp);
      s.profile.coins += stage.rewards.coins;
      s.profile.skillPoints += stage.rewards.skillPoints;
    }
    evaluateAchievements(s);
    expect(s.achievements.some((a) => a.id === 'graduate')).toBe(true);

    // Climb the ladder.
    let guard = 0;
    while (s.league.division !== 'champion' && guard++ < 60) {
      const div = DIVISION_BY_ID.get(s.league.division)!;
      if (s.league.promotionAvailable) {
        recordLeagueResult(s, 'boss', true, 4, true);
      } else {
        recordLeagueResult(s, `o${guard}`, true, 3, false);
      }
      applyXp(s, 400 * div.xpMultiplier);
      s.profile.coins += div.purse;
      s.record.wins++;
      s.record.matchesPlayed++;
      s.record.streak++;
      s.record.bestStreak = Math.max(s.record.bestStreak, s.record.streak);
    }

    expect(s.league.division).toBe('champion');
    expect(s.profile.level).toBeGreaterThan(8);

    // Spend everything.
    for (let pass = 0; pass < 8; pass++) for (const n of SKILL_TREE) purchaseSkill(s, n.id);
    evaluateAchievements(s);

    // Invariants hold.
    expect(s.profile.skillPoints).toBeGreaterThanOrEqual(0);
    expect(s.profile.coins).toBeGreaterThanOrEqual(0);
    for (const v of Object.values(s.profile.attributes)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(ATTRIBUTE_CAP);
    }
    // Save survives a serialise round-trip at the end of it all.
    const round = migrate(JSON.parse(JSON.stringify(s)));
    expect(round?.profile.name).toBe('Journey');
    expect(round?.league.division).toBe('champion');
  });
});
