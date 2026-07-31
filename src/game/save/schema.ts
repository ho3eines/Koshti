import { baseAttributes, type Attributes } from '../data/attributes';
import { STARTER_MOVES } from '../data/moves';
import type { DivisionId } from '../data/leagues';
import type { FightingStyle } from '../data/styles';

export const SAVE_VERSION = 3;

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export type ControlScheme = 'buttons' | 'gestures' | 'hybrid';

export interface Settings {
  graphics: GraphicsPreset;
  /** Auto-detected preset before any manual override. */
  autoDetected: GraphicsPreset;
  manualGraphics: boolean;
  targetFps: 30 | 60;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  commentary: boolean;
  crowdVolume: number;
  haptics: boolean;
  controls: ControlScheme;
  leftHanded: boolean;
  showDamageNumbers: boolean;
  cameraShake: number;
  dynamicResolution: boolean;
}

export const defaultSettings = (): Settings => ({
  graphics: 'high',
  autoDetected: 'high',
  manualGraphics: false,
  targetFps: 60,
  masterVolume: 0.9,
  musicVolume: 0.55,
  sfxVolume: 0.95,
  commentary: true,
  crowdVolume: 0.8,
  haptics: true,
  controls: 'hybrid',
  leftHanded: false,
  showDamageNumbers: true,
  cameraShake: 1,
  dynamicResolution: true,
});

export interface TrainingProgress {
  /** Stage id -> best score 0..3 stars. */
  stars: Record<string, number>;
  completed: string[];
  currentStage: string | null;
}

export interface CareerRecord {
  wins: number;
  losses: number;
  draws: number;
  pins: number;
  submissions: number;
  knockouts: number;
  finishersLanded: number;
  totalReversals: number;
  streak: number;
  bestStreak: number;
  matchesPlayed: number;
}

export const emptyRecord = (): CareerRecord => ({
  wins: 0,
  losses: 0,
  draws: 0,
  pins: 0,
  submissions: 0,
  knockouts: 0,
  finishersLanded: 0,
  totalReversals: 0,
  streak: 0,
  bestStreak: 0,
  matchesPlayed: 0,
});

export interface LeagueState {
  division: DivisionId;
  winsInDivision: number;
  lossesInDivision: number;
  /** Leaderboard points within the current division. */
  points: number;
  /** Set true once the player has earned a promotion bout. */
  promotionAvailable: boolean;
  seasonNumber: number;
  /** Wrestler ids already beaten this season. */
  defeated: string[];
  titlesHeld: string[];
}

export interface TournamentState {
  id: string;
  name: string;
  division: DivisionId;
  seed: number;
  /** Flat bracket: rounds of participant ids. */
  bracket: string[][];
  roundIndex: number;
  matchIndex: number;
  eliminated: boolean;
  completed: boolean;
  prize: number;
}

export interface Achievement {
  id: string;
  unlockedAt: number;
}

export interface PlayerProfile {
  name: string;
  createdAt: number;
  clubId: string | null;
  style: FightingStyle;
  level: number;
  xp: number;
  coins: number;
  skillPoints: number;
  attributes: Attributes;
  unlockedSkills: string[];
  unlockedMoves: string[];
  equippedSignature: string | null;
  equippedFinisher: string | null;
  tint: number;
  trunks: number;
}

export const newProfile = (name: string): PlayerProfile => ({
  name,
  createdAt: Date.now(),
  clubId: null,
  style: 'allround',
  level: 1,
  xp: 0,
  coins: 250,
  skillPoints: 2,
  attributes: baseAttributes(),
  unlockedSkills: [],
  unlockedMoves: [...STARTER_MOVES],
  equippedSignature: null,
  equippedFinisher: null,
  tint: 0x2f6fd0,
  trunks: 0xe8442f,
});

export type ScreenId =
  | 'onboarding'
  | 'hub'
  | 'training'
  | 'league'
  | 'tournament'
  | 'skills'
  | 'profile'
  | 'settings'
  | 'match'
  | 'results';

export interface SaveGame {
  version: number;
  profile: PlayerProfile;
  settings: Settings;
  training: TrainingProgress;
  record: CareerRecord;
  league: LeagueState;
  tournament: TournamentState | null;
  achievements: Achievement[];
  /** Resume point so the player lands back where they left off. */
  checkpoint: {
    screen: ScreenId;
    savedAt: number;
    label: string;
  };
  /** Rolling log of recent matches for the profile screen. */
  history: MatchHistoryEntry[];
  stats: {
    totalPlaySeconds: number;
    totalDamageDealt: number;
    totalXpEarned: number;
    totalCoinsEarned: number;
  };
  /** Local leaderboard snapshot (regenerated per season). */
  leaderboard: LeaderboardEntry[];
}

export interface MatchHistoryEntry {
  at: number;
  opponent: string;
  opponentClub: string | null;
  division: DivisionId;
  won: boolean;
  method: string;
  scoreFor: number;
  scoreAgainst: number;
  xp: number;
  coins: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  clubId: string | null;
  points: number;
  wins: number;
  losses: number;
  rating: number;
  isPlayer?: boolean;
}

export const newSave = (name: string): SaveGame => ({
  version: SAVE_VERSION,
  profile: newProfile(name),
  settings: defaultSettings(),
  training: { stars: {}, completed: [], currentStage: null },
  record: emptyRecord(),
  league: {
    division: 'amateur',
    winsInDivision: 0,
    lossesInDivision: 0,
    points: 0,
    promotionAvailable: false,
    seasonNumber: 1,
    defeated: [],
    titlesHeld: [],
  },
  tournament: null,
  achievements: [],
  checkpoint: { screen: 'hub', savedAt: Date.now(), label: 'Career start' },
  history: [],
  stats: { totalPlaySeconds: 0, totalDamageDealt: 0, totalXpEarned: 0, totalCoinsEarned: 0 },
  leaderboard: [],
});

/** Forward-compatible migration. Old saves are upgraded, never dropped. */
export const migrate = (raw: unknown): SaveGame | null => {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<SaveGame> & { version?: number };
  if (!data.profile?.name) return null;

  const base = newSave(data.profile.name);
  const merged: SaveGame = {
    ...base,
    ...data,
    version: SAVE_VERSION,
    profile: { ...base.profile, ...data.profile },
    settings: { ...base.settings, ...data.settings },
    training: { ...base.training, ...data.training },
    record: { ...base.record, ...data.record },
    league: { ...base.league, ...data.league },
    stats: { ...base.stats, ...data.stats },
    checkpoint: { ...base.checkpoint, ...data.checkpoint },
    achievements: data.achievements ?? [],
    history: data.history ?? [],
    leaderboard: data.leaderboard ?? [],
    tournament: data.tournament ?? null,
  };
  // Guarantee attribute completeness across versions.
  merged.profile.attributes = { ...base.profile.attributes, ...(data.profile.attributes as Attributes) };
  return merged;
};
