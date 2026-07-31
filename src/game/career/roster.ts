import { ATTRIBUTE_KEYS, overallRating, type Attributes } from '../data/attributes';
import { CLUBS, DIVISION_BY_ID, type DivisionId } from '../data/leagues';
import { MOVES } from '../data/moves';
import { STYLES, type FightingStyle } from '../data/styles';
import { emptyPassives } from '../data/skills';
import { Rng } from '../../core/rng';
import type { FighterConfig } from '../sim/types';

const FIRST = [
  'Arman', 'Davit', 'Kenji', 'Rustam', 'Bekzat', 'Tariq', 'Miro', 'Yusuf', 'Levan', 'Oleg',
  'Kaito', 'Sanjar', 'Emre', 'Nikoloz', 'Farhad', 'Adem', 'Vahan', 'Boris', 'Idris', 'Temur',
  'Kofi', 'Marek', 'Zaid', 'Dinis', 'Hakan', 'Ilya', 'Jamal', 'Sota', 'Andrei', 'Reza',
];
const LAST = [
  'Karimov', 'Tsuka', 'Beridze', 'Nazarov', 'Aliyev', 'Okafor', 'Petrov', 'Yilmaz', 'Rahimi',
  'Bekov', 'Mori', 'Zhang', 'Kuznetsov', 'Adeyemi', 'Tadesse', 'Voskan', 'Demir', 'Iskandar',
  'Novak', 'Salim', 'Gvasalia', 'Watanabe', 'Turgut', 'Ilyas', 'Sadykov', 'Mbeki',
];
const NICKNAMES = [
  'The Anvil', 'Ironhand', 'The Cyclone', 'Steelneck', 'The Surgeon', 'Rolling Thunder',
  'The Mountain', 'Quicksilver', 'The Vice', 'Blackout', 'The Machine', 'Nightfall',
  'The Bear', 'Coldsteel', 'The Riddle', 'Sandstorm',
];

const TINTS = [0xd94f3d, 0x2f6fd0, 0x38a169, 0x8b5cf6, 0xf59e0b, 0x0ea5e9, 0xec4899, 0x14b8a6];

export interface RosterWrestler {
  id: string;
  name: string;
  nickname: string;
  style: FightingStyle;
  clubId: string;
  attributes: Attributes;
  rating: number;
  division: DivisionId;
  moves: string[];
  tint: number;
  trunks: number;
  /** Season record — drives the leaderboard. */
  wins: number;
  losses: number;
  points: number;
}

const attributesFor = (rng: Rng, style: FightingStyle, targetRating: number): Attributes => {
  const bias = STYLES[style].bias;
  const attrs = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) {
    const b = bias[k] ?? 1;
    attrs[k] = Math.round(Math.min(99, Math.max(20, targetRating * b + rng.range(-5, 5))));
  }
  // Nudge until the computed overall lands near the target.
  for (let i = 0; i < 24; i++) {
    const cur = overallRating(attrs);
    if (Math.abs(cur - targetRating) <= 1) break;
    const delta = cur < targetRating ? 1 : -1;
    const k = rng.pick(ATTRIBUTE_KEYS);
    attrs[k] = Math.min(99, Math.max(15, attrs[k] + delta));
  }
  return attrs;
};

const movesFor = (rng: Rng, style: FightingStyle, rating: number): string[] => {
  const pool = MOVES.filter((m) => m.category !== 'finisher');
  const prefer = STYLES[style].ai.prefer;
  const picked = new Set<string>(['jab_setup', 'collar_elbow']);

  // Always give them at least one option in each range.
  const need: Array<'standing' | 'clinch' | 'ground'> = ['standing', 'clinch', 'ground'];
  for (const range of need) {
    const opts = pool.filter((m) => m.range === range);
    const weighted = rng.shuffle([...opts]).sort(
      (a, b) => (prefer[b.category] ?? 1) - (prefer[a.category] ?? 1),
    );
    picked.add(weighted[0].id);
    if (weighted[1]) picked.add(weighted[1].id);
  }

  // Higher rated wrestlers get more tools, including signatures.
  const extra = Math.floor((rating - 35) / 12);
  for (let i = 0; i < extra; i++) {
    const m = rng.pick(pool);
    picked.add(m.id);
  }
  if (rating >= 68) picked.add(rng.chance(0.5) ? 'sig_thunder_slam' : 'sig_lightning_roll');
  if (rating >= 86) picked.add(rng.chance(0.5) ? 'fin_koshti_crusher' : 'fin_iron_clutch');

  return [...picked];
};

export const generateWrestler = (
  rng: Rng,
  division: DivisionId,
  index: number,
  forceClub?: string,
): RosterWrestler => {
  const div = DIVISION_BY_ID.get(division)!;
  const [lo, hi] = div.ratingRange;
  const t = index / 11;
  const target = Math.round(lo + (hi - lo) * (0.25 + t * 0.75) + rng.range(-2, 2));
  const clubId = forceClub ?? rng.pick(CLUBS).id;
  const club = CLUBS.find((c) => c.id === clubId)!;
  const style: FightingStyle = rng.chance(0.55)
    ? club.style
    : rng.pick(['power', 'technical', 'speed', 'allround'] as FightingStyle[]);

  const attrs = attributesFor(rng, style, target);
  const first = rng.pick(FIRST);
  const last = rng.pick(LAST);

  return {
    id: `${division}_${index}_${first}${last}`.toLowerCase().replace(/\s+/g, ''),
    name: `${first} ${last}`,
    nickname: rng.pick(NICKNAMES),
    style,
    clubId,
    attributes: attrs,
    rating: overallRating(attrs),
    division,
    moves: movesFor(rng, style, target),
    tint: rng.pick(TINTS),
    trunks: rng.pick(TINTS),
    wins: rng.int(0, 8),
    losses: rng.int(0, 6),
    points: 0,
  };
};

/** Deterministic 12-wrestler roster per division per season. */
export const generateDivisionRoster = (
  division: DivisionId,
  season: number,
  count = 12,
): RosterWrestler[] => {
  const rng = Rng.fromString(`koshti|${division}|s${season}`);
  const out: RosterWrestler[] = [];
  for (let i = 0; i < count; i++) out.push(generateWrestler(rng, division, i));
  out.sort((a, b) => b.rating - a.rating);
  for (const w of out) w.points = w.wins * 3;
  return out;
};

export const toFighterConfig = (w: RosterWrestler, difficulty: number): FighterConfig => ({
  id: w.id,
  name: w.name,
  shortName: w.name.split(' ')[1] ?? w.name,
  attributes: w.attributes,
  style: w.style,
  moves: w.moves,
  passives: emptyPassives(),
  clubId: w.clubId,
  difficulty,
  tint: w.tint,
  trunks: w.trunks,
});
