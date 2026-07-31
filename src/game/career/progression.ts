import { ATTRIBUTE_CAP, type AttributeKey } from '../data/attributes';
import { DIVISION_BY_ID, type DivisionId } from '../data/leagues';
import { SKILL_BY_ID, canUnlock } from '../data/skills';
import { resolveUnlockToMoveId } from '../data/moves';
import type { MatchResult } from '../sim/types';
import type { SaveGame } from '../save/schema';

/** XP needed to go from level n to n+1. */
export const xpForLevel = (level: number): number =>
  Math.round(180 * Math.pow(level, 1.42) + 120);

export const totalXpForLevel = (level: number): number => {
  let t = 0;
  for (let i = 1; i < level; i++) t += xpForLevel(i);
  return t;
};

export interface LevelUpInfo {
  levelsGained: number;
  newLevel: number;
  skillPointsGained: number;
}

export const applyXp = (save: SaveGame, xp: number): LevelUpInfo => {
  const p = save.profile;
  p.xp += xp;
  save.stats.totalXpEarned += xp;
  let gained = 0;
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    gained++;
  }
  // 1 skill point per level, +1 bonus every 5th level.
  let sp = gained;
  for (let l = p.level - gained + 1; l <= p.level; l++) if (l % 5 === 0) sp++;
  p.skillPoints += sp;
  return { levelsGained: gained, newLevel: p.level, skillPointsGained: sp };
};

export interface Reward {
  xp: number;
  coins: number;
  leaguePoints: number;
  bonuses: { label: string; xp: number; coins: number }[];
}

/** Compute post-match rewards. Pure — easy to unit test. */
export const computeReward = (
  result: MatchResult,
  division: DivisionId,
  won: boolean,
  crowdFavour: number,
): Reward => {
  const div = DIVISION_BY_ID.get(division)!;
  const bonuses: Reward['bonuses'] = [];

  let xp = Math.round((won ? 160 : 55) * div.xpMultiplier);
  let coins = won ? div.purse : Math.round(div.purse * 0.25);

  const add = (label: string, bx: number, bc: number) => {
    if (bx === 0 && bc === 0) return;
    bonuses.push({ label, xp: bx, coins: bc });
    xp += bx;
    coins += bc;
  };

  const s = result.stats;
  if (result.outcome.type === 'pin' && won) add('Pinfall victory', 70, 140);
  if (result.outcome.type === 'submission' && won) add('Submission victory', 85, 170);
  if (result.outcome.type === 'knockout' && won) add('Dominant finish', 60, 120);
  if (s.finishersLanded > 0) add(`Finisher x${s.finishersLanded}`, 50 * s.finishersLanded, 90 * s.finishersLanded);
  if (s.perfectCounters >= 3) add(`Perfect counters x${s.perfectCounters}`, 40, 70);
  if (s.maxCombo >= 4) add(`${s.maxCombo}-hit combo`, 35, 60);
  if (won && s.damageTaken < 40) add('Flawless control', 90, 150);
  if (result.duration < 45 && won) add('Quick work', 45, 80);

  if (crowdFavour > 0) {
    const bx = Math.round(xp * crowdFavour);
    const bc = Math.round(coins * crowdFavour);
    add('Crowd favour', bx, bc);
  }

  const leaguePoints = won ? (result.outcome.type === 'points' ? 3 : 4) : result.outcome.type === 'points' && result.outcome.winner === 'draw' ? 1 : 0;

  return { xp, coins, leaguePoints, bonuses };
};

export const purchaseSkill = (save: SaveGame, nodeId: string): { ok: boolean; reason?: string } => {
  const node = SKILL_BY_ID.get(nodeId);
  if (!node) return { ok: false, reason: 'Unknown skill' };
  const owned = new Set(save.profile.unlockedSkills);
  if (owned.has(nodeId)) return { ok: false, reason: 'Already unlocked' };
  if (!node.requires.every((r) => owned.has(r))) return { ok: false, reason: 'Requires previous skill' };
  if (save.profile.skillPoints < node.cost) return { ok: false, reason: 'Not enough skill points' };

  save.profile.skillPoints -= node.cost;
  save.profile.unlockedSkills.push(nodeId);

  if (node.grants) {
    for (const [k, v] of Object.entries(node.grants)) {
      const key = k as AttributeKey;
      save.profile.attributes[key] = Math.min(ATTRIBUTE_CAP, save.profile.attributes[key] + (v as number));
    }
  }
  if (node.unlocksMove) {
    // node.unlocksMove is an unlock *token*; resolve it to the real move id.
    const moveId = resolveUnlockToMoveId(node.unlocksMove);
    if (moveId && !save.profile.unlockedMoves.includes(moveId)) {
      save.profile.unlockedMoves.push(moveId);
    }
  }
  return { ok: true };
};

export const skillAvailable = (save: SaveGame, nodeId: string): boolean => {
  const node = SKILL_BY_ID.get(nodeId);
  if (!node) return false;
  return canUnlock(node, new Set(save.profile.unlockedSkills), save.profile.skillPoints);
};

/** Coin-based attribute training (separate from skill points). */
export const trainAttributeCost = (current: number): number =>
  Math.round(60 * Math.pow(1.075, current - 30));

export const trainAttribute = (
  save: SaveGame,
  key: AttributeKey,
): { ok: boolean; reason?: string; cost?: number } => {
  const cur = save.profile.attributes[key];
  if (cur >= ATTRIBUTE_CAP) return { ok: false, reason: 'Maxed out' };
  const cost = trainAttributeCost(cur);
  if (save.profile.coins < cost) return { ok: false, reason: `Needs ${cost} coins` };
  save.profile.coins -= cost;
  save.profile.attributes[key] = cur + 1;
  return { ok: true, cost };
};
