import type { FightingStyle } from './styles';

export type DivisionId = 'amateur' | 'semipro' | 'professional' | 'elite' | 'champion';

export interface DivisionDef {
  id: DivisionId;
  name: string;
  subtitle: string;
  /** Opponent overall rating band. */
  ratingRange: [number, number];
  /** AI difficulty scalar fed into the combat sim. */
  difficulty: number;
  /** Wins required in this division to earn a promotion match. */
  winsToPromote: number;
  entryFee: number;
  purse: number;
  xpMultiplier: number;
  arena: ArenaId;
  color: string;
  accent: string;
}

export type ArenaId = 'training_hall' | 'community_gym' | 'city_arena' | 'national_dome' | 'world_colosseum';

export interface ArenaDef {
  id: ArenaId;
  name: string;
  capacity: number;
  /** Crowd loudness baseline 0..1. */
  crowd: number;
  /** Lighting mood used by the renderer. */
  mood: {
    keyColor: number;
    rimColor: number;
    fillColor: number;
    fogColor: number;
    fogDensity: number;
    matColor: number;
    canvasColor: number;
    spotIntensity: number;
    ambient: number;
  };
}

export const ARENAS: Record<ArenaId, ArenaDef> = {
  training_hall: {
    id: 'training_hall',
    name: 'Koshti Training Hall',
    capacity: 0,
    crowd: 0.05,
    mood: {
      keyColor: 0xfff2dd,
      rimColor: 0x8fb4ff,
      fillColor: 0x40506b,
      fogColor: 0x0d1018,
      fogDensity: 0.022,
      matColor: 0x2a4a7a,
      canvasColor: 0x14406e,
      spotIntensity: 1.6,
      ambient: 0.55,
    },
  },
  community_gym: {
    id: 'community_gym',
    name: 'Riverside Community Gym',
    capacity: 800,
    crowd: 0.35,
    mood: {
      keyColor: 0xffe9c9,
      rimColor: 0x7fa8ff,
      fillColor: 0x33405a,
      fogColor: 0x0b0e15,
      fogDensity: 0.026,
      matColor: 0x8a2f2f,
      canvasColor: 0x9c3a2e,
      spotIntensity: 2.1,
      ambient: 0.4,
    },
  },
  city_arena: {
    id: 'city_arena',
    name: 'Metro City Arena',
    capacity: 9500,
    crowd: 0.62,
    mood: {
      keyColor: 0xffffff,
      rimColor: 0x5b8cff,
      fillColor: 0x1e2740,
      fogColor: 0x05070d,
      fogDensity: 0.032,
      matColor: 0x1f6f5c,
      canvasColor: 0x1b7a63,
      spotIntensity: 2.8,
      ambient: 0.28,
    },
  },
  national_dome: {
    id: 'national_dome',
    name: 'National Dome',
    capacity: 32000,
    crowd: 0.82,
    mood: {
      keyColor: 0xfff8f0,
      rimColor: 0x9b6bff,
      fillColor: 0x1a1f38,
      fogColor: 0x04050b,
      fogDensity: 0.036,
      matColor: 0x2b3a8f,
      canvasColor: 0x2d3f9e,
      spotIntensity: 3.4,
      ambient: 0.22,
    },
  },
  world_colosseum: {
    id: 'world_colosseum',
    name: 'World Colosseum',
    capacity: 68000,
    crowd: 1.0,
    mood: {
      keyColor: 0xffffff,
      rimColor: 0xffb347,
      fillColor: 0x241a2e,
      fogColor: 0x03040a,
      fogDensity: 0.04,
      matColor: 0x6d1f4a,
      canvasColor: 0x7d2352,
      spotIntensity: 4.0,
      ambient: 0.18,
    },
  },
};

export const DIVISIONS: readonly DivisionDef[] = [
  {
    id: 'amateur',
    name: 'Amateur Circuit',
    subtitle: 'Prove you belong on the mat.',
    ratingRange: [34, 48],
    difficulty: 0.55,
    winsToPromote: 3,
    entryFee: 0,
    purse: 220,
    xpMultiplier: 1.0,
    arena: 'community_gym',
    color: '#8aa2c8',
    accent: '#cbd8ef',
  },
  {
    id: 'semipro',
    name: 'Semi-Pro League',
    subtitle: 'Real clubs. Real rivalries.',
    ratingRange: [46, 60],
    difficulty: 0.7,
    winsToPromote: 4,
    entryFee: 120,
    purse: 620,
    xpMultiplier: 1.35,
    arena: 'city_arena',
    color: '#4ade80',
    accent: '#bbf7d0',
  },
  {
    id: 'professional',
    name: 'Professional Division',
    subtitle: 'Sponsors, cameras, pressure.',
    ratingRange: [58, 74],
    difficulty: 0.85,
    winsToPromote: 5,
    entryFee: 400,
    purse: 1800,
    xpMultiplier: 1.75,
    arena: 'national_dome',
    color: '#38bdf8',
    accent: '#bae6fd',
  },
  {
    id: 'elite',
    name: 'Elite Series',
    subtitle: 'The top 1% of the sport.',
    ratingRange: [72, 88],
    difficulty: 0.95,
    winsToPromote: 5,
    entryFee: 900,
    purse: 4200,
    xpMultiplier: 2.2,
    arena: 'national_dome',
    color: '#c084fc',
    accent: '#e9d5ff',
  },
  {
    id: 'champion',
    name: "Champion's Circle",
    subtitle: 'Immortality is one match away.',
    ratingRange: [86, 99],
    difficulty: 1.0,
    winsToPromote: 6,
    entryFee: 2000,
    purse: 11000,
    xpMultiplier: 3.0,
    arena: 'world_colosseum',
    color: '#fbbf24',
    accent: '#fde68a',
  },
] as const;

export const DIVISION_BY_ID: ReadonlyMap<DivisionId, DivisionDef> = new Map(
  DIVISIONS.map((d) => [d.id, d]),
);

export const divisionIndex = (id: DivisionId): number => DIVISIONS.findIndex((d) => d.id === id);

export const nextDivision = (id: DivisionId): DivisionDef | null => {
  const i = divisionIndex(id);
  return i >= 0 && i < DIVISIONS.length - 1 ? DIVISIONS[i + 1] : null;
};

export interface ClubDef {
  id: string;
  name: string;
  city: string;
  colors: [string, string];
  motto: string;
  /** Preferred style of wrestlers coming out of this club. */
  style: FightingStyle;
  prestige: number;
}

export const CLUBS: readonly ClubDef[] = [
  {
    id: 'iron_bears',
    name: 'Iron Bears',
    city: 'Novgorod',
    colors: ['#ff5d47', '#3a0f0a'],
    motto: 'Break the base, break the man.',
    style: 'power',
    prestige: 0.86,
  },
  {
    id: 'silk_tigers',
    name: 'Silk Tigers',
    city: 'Isfahan',
    colors: ['#fbbf24', '#3a2a05'],
    motto: 'Patience is a weapon.',
    style: 'technical',
    prestige: 0.92,
  },
  {
    id: 'storm_falcons',
    name: 'Storm Falcons',
    city: 'Osaka',
    colors: ['#38bdf8', '#05243a'],
    motto: 'Faster than the whistle.',
    style: 'speed',
    prestige: 0.81,
  },
  {
    id: 'granite_wolves',
    name: 'Granite Wolves',
    city: 'Ankara',
    colors: ['#94a3b8', '#161b22'],
    motto: 'The pack always finishes.',
    style: 'allround',
    prestige: 0.78,
  },
  {
    id: 'crimson_lions',
    name: 'Crimson Lions',
    city: 'Lagos',
    colors: ['#f472b6', '#3b0a25'],
    motto: 'Roar first. Pin second.',
    style: 'power',
    prestige: 0.74,
  },
  {
    id: 'azure_cobras',
    name: 'Azure Cobras',
    city: 'Tbilisi',
    colors: ['#4ade80', '#052e1a'],
    motto: 'Strike where they are soft.',
    style: 'technical',
    prestige: 0.88,
  },
] as const;

export const CLUB_BY_ID: ReadonlyMap<string, ClubDef> = new Map(CLUBS.map((c) => [c.id, c]));

export type MatchFormat = 'exhibition' | 'league' | 'tournament' | 'club_championship' | 'title';

export const FORMAT_META: Record<MatchFormat, { name: string; rounds: number; roundSeconds: number }> = {
  exhibition: { name: 'Exhibition', rounds: 1, roundSeconds: 120 },
  league: { name: 'League Match', rounds: 2, roundSeconds: 105 },
  tournament: { name: 'Tournament Bout', rounds: 2, roundSeconds: 105 },
  club_championship: { name: 'Club Championship', rounds: 3, roundSeconds: 105 },
  title: { name: 'Title Match', rounds: 3, roundSeconds: 120 },
};
