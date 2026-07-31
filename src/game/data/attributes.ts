export type AttributeKey = 'strength' | 'stamina' | 'speed' | 'technique' | 'defense' | 'charisma';

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'strength',
  'stamina',
  'speed',
  'technique',
  'defense',
  'charisma',
] as const;

export type Attributes = Record<AttributeKey, number>;

export const ATTRIBUTE_META: Record<
  AttributeKey,
  { label: string; short: string; blurb: string; color: string }
> = {
  strength: {
    label: 'Strength',
    short: 'STR',
    blurb: 'Raw damage on slams, throws and power grapples.',
    color: '#ff5d47',
  },
  stamina: {
    label: 'Stamina',
    short: 'STA',
    blurb: 'Total gas tank and how fast you recover between exchanges.',
    color: '#4ade80',
  },
  speed: {
    label: 'Speed',
    short: 'SPD',
    blurb: 'Movement, shot entry speed and counter windows.',
    color: '#38bdf8',
  },
  technique: {
    label: 'Technique',
    short: 'TEC',
    blurb: 'Submission tightness, reversal quality and combo chaining.',
    color: '#c084fc',
  },
  defense: {
    label: 'Defense',
    short: 'DEF',
    blurb: 'Damage resistance, sprawl success and escape ability.',
    color: '#fbbf24',
  },
  charisma: {
    label: 'Charisma',
    short: 'CHA',
    blurb: 'Crowd momentum gain, sponsor payouts and signature charge rate.',
    color: '#f472b6',
  },
};

export const baseAttributes = (): Attributes => ({
  strength: 42,
  stamina: 45,
  speed: 44,
  technique: 38,
  defense: 40,
  charisma: 35,
});

export const cloneAttributes = (a: Attributes): Attributes => ({ ...a });

export const attributeAverage = (a: Attributes): number =>
  ATTRIBUTE_KEYS.reduce((s, k) => s + a[k], 0) / ATTRIBUTE_KEYS.length;

/** Overall rating shown on cards — weighted toward combat-relevant stats. */
export const overallRating = (a: Attributes): number => {
  const w = { strength: 1.1, stamina: 1.05, speed: 1.05, technique: 1.15, defense: 1.0, charisma: 0.65 };
  const total = ATTRIBUTE_KEYS.reduce((s, k) => s + a[k] * w[k], 0);
  const wsum = ATTRIBUTE_KEYS.reduce((s, k) => s + w[k], 0);
  return Math.round(total / wsum);
};

export const ATTRIBUTE_CAP = 99;
