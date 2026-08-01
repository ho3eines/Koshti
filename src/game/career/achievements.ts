import type { SaveGame } from '../save/schema';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  coins: number;
  xp: number;
  check: (s: SaveGame) => boolean;
  secret?: boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first_step',
    name: 'First Step',
    description: 'Complete your first training stage.',
    icon: '👣',
    coins: 60,
    xp: 40,
    check: (s) => s.training.completed.length >= 1,
  },
  {
    id: 'graduate',
    name: 'Graduate',
    description: 'Complete every training stage.',
    icon: '🎓',
    coins: 350,
    xp: 260,
    check: (s) => s.training.completed.length >= 6,
  },
  {
    id: 'perfect_student',
    name: 'Perfect Student',
    description: 'Earn 3 stars on every training stage.',
    icon: '⭐',
    coins: 500,
    xp: 400,
    check: (s) => {
      const vals = Object.values(s.training.stars);
      return vals.length >= 6 && vals.every((v) => v >= 3);
    },
  },
  {
    id: 'first_win',
    name: 'Blood on the Mat',
    description: 'Win your first official match.',
    icon: '🥇',
    coins: 120,
    xp: 90,
    check: (s) => s.record.wins >= 1,
  },
  {
    id: 'ten_wins',
    name: 'Contender',
    description: 'Win 10 matches.',
    icon: '🔥',
    coins: 400,
    xp: 320,
    check: (s) => s.record.wins >= 10,
  },
  {
    id: 'fifty_wins',
    name: 'Legend in the Making',
    description: 'Win 50 matches.',
    icon: '🏆',
    coins: 1800,
    xp: 1500,
    check: (s) => s.record.wins >= 50,
  },
  {
    id: 'streak_5',
    name: 'Unstoppable',
    description: 'Win 5 matches in a row.',
    icon: '⚡',
    coins: 350,
    xp: 280,
    check: (s) => s.record.bestStreak >= 5,
  },
  {
    id: 'first_pin',
    name: 'Shoulders Down',
    description: 'Win a match by pinfall.',
    icon: '📌',
    coins: 150,
    xp: 110,
    check: (s) => s.record.pins >= 1,
  },
  {
    id: 'first_sub',
    name: 'Tap Out',
    description: 'Win a match by submission.',
    icon: '🪢',
    coins: 180,
    xp: 130,
    check: (s) => s.record.submissions >= 1,
  },
  {
    id: 'finisher',
    name: 'Signature Moment',
    description: 'Land your first finisher in a real match.',
    icon: '💀',
    coins: 300,
    xp: 240,
    check: (s) => s.record.finishersLanded >= 1,
  },
  {
    id: 'counter_master',
    name: 'Counter Master',
    description: 'Land 25 reversals across your career.',
    icon: '🔄',
    coins: 380,
    xp: 300,
    check: (s) => s.record.totalReversals >= 25,
  },
  {
    id: 'semipro',
    name: 'Turning Pro',
    description: 'Reach the Semi-Pro League.',
    icon: '📈',
    coins: 300,
    xp: 250,
    check: (s) => ['semipro', 'professional', 'elite', 'champion'].includes(s.league.division),
  },
  {
    id: 'professional',
    name: 'Big Leagues',
    description: 'Reach the Professional Division.',
    icon: '🎪',
    coins: 700,
    xp: 600,
    check: (s) => ['professional', 'elite', 'champion'].includes(s.league.division),
  },
  {
    id: 'elite',
    name: 'Top of the Sport',
    description: 'Reach the Elite Series.',
    icon: '💎',
    coins: 1500,
    xp: 1200,
    check: (s) => ['elite', 'champion'].includes(s.league.division),
  },
  {
    id: 'champion',
    name: 'World Champion',
    description: "Reach the Champion's Circle.",
    icon: '👑',
    coins: 4000,
    xp: 3000,
    check: (s) => s.league.division === 'champion',
  },
  {
    id: 'tournament_win',
    name: 'Bracket Buster',
    description: 'Win a tournament.',
    icon: '🗓️',
    coins: 900,
    xp: 700,
    check: (s) => s.league.titlesHeld.some((t) => t.startsWith('tournament:')),
  },
  {
    id: 'club_member',
    name: 'Brotherhood',
    description: 'Join a wrestling club.',
    icon: '🛡️',
    coins: 100,
    xp: 80,
    check: (s) => s.profile.clubId !== null,
  },
  {
    id: 'club_champ',
    name: 'Club Champion',
    description: 'Win a club championship.',
    icon: '🏟️',
    coins: 2000,
    xp: 1600,
    check: (s) => s.league.titlesHeld.some((t) => t.startsWith('club:')),
  },
  {
    id: 'maxed_attr',
    name: 'Peak Human',
    description: 'Push any attribute to 99.',
    icon: '🧬',
    coins: 1200,
    xp: 1000,
    check: (s) => Object.values(s.profile.attributes).some((v) => v >= 99),
  },
  {
    id: 'skill_tree_half',
    name: 'Well Rounded',
    description: 'Unlock 12 skill nodes.',
    icon: '🌳',
    coins: 800,
    xp: 650,
    check: (s) => s.profile.unlockedSkills.length >= 12,
  },
  {
    id: 'level_20',
    name: 'Veteran',
    description: 'Reach level 20.',
    icon: '🎖️',
    coins: 1000,
    xp: 0,
    check: (s) => s.profile.level >= 20,
  },
] as const;

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Returns newly unlocked achievements and applies their rewards. */
export const evaluateAchievements = (save: SaveGame): AchievementDef[] => {
  const owned = new Set(save.achievements.map((a) => a.id));
  const fresh: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (owned.has(def.id)) continue;
    if (!def.check(save)) continue;
    save.achievements.push({ id: def.id, unlockedAt: Date.now() });
    save.profile.coins += def.coins;
    save.stats.totalCoinsEarned += def.coins;
    fresh.push(def);
  }
  return fresh;
};
