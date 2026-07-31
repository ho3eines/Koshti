import type { AttributeKey } from './attributes';

export type SkillBranch = 'power' | 'technique' | 'conditioning' | 'showmanship';

export interface SkillNode {
  id: string;
  name: string;
  branch: SkillBranch;
  /** Grid tier, 0 = root. Used for layout and gating. */
  tier: number;
  cost: number;
  requires: readonly string[];
  /** Permanent attribute bonuses granted on purchase. */
  grants?: Partial<Record<AttributeKey, number>>;
  /** Move unlocked by this node (matches MoveDef.unlock). */
  unlocksMove?: string;
  /** Passive combat modifier keys consumed by the match sim. */
  passive?: Partial<Record<PassiveKey, number>>;
  description: string;
  icon: string;
}

export type PassiveKey =
  | 'reversalWindow' // + seconds of counter window
  | 'reversalPower' // + chance to reverse
  | 'staminaRegen' // multiplier
  | 'momentumGain' // multiplier
  | 'damageReduction' // 0..1
  | 'submissionPower' // multiplier on submission damage
  | 'throwPower'
  | 'shotSpeed' // reduces windup
  | 'crowdFavour' // extra coins/xp
  | 'escapeSpeed';

export const SKILL_TREE: readonly SkillNode[] = [
  // ---------------------------------------------------------------- POWER
  {
    id: 'power_root',
    name: 'Iron Base',
    branch: 'power',
    tier: 0,
    cost: 1,
    requires: [],
    grants: { strength: 3 },
    description: '+3 Strength. Your base is heavier and harder to move.',
    icon: '💪',
  },
  {
    id: 'power_grip',
    name: 'Vice Grip',
    branch: 'power',
    tier: 1,
    cost: 2,
    requires: ['power_root'],
    grants: { strength: 3 },
    passive: { throwPower: 0.12 },
    description: '+3 Strength, +12% throw damage. They cannot break your hands off.',
    icon: '🤝',
  },
  {
    id: 'power_suplex',
    name: 'Suplex Mastery',
    branch: 'power',
    tier: 2,
    cost: 3,
    requires: ['power_grip'],
    unlocksMove: 'power_suplex',
    grants: { strength: 4 },
    description: 'Unlocks Belly-to-Back Suplex. +4 Strength.',
    icon: '🌪️',
  },
  {
    id: 'power_wall',
    name: 'Granite Frame',
    branch: 'power',
    tier: 2,
    cost: 3,
    requires: ['power_grip'],
    grants: { defense: 5 },
    passive: { damageReduction: 0.08 },
    description: '+5 Defense and 8% flat damage reduction.',
    icon: '🛡️',
  },
  {
    id: 'sig_thunder_slam',
    name: 'Signature: Thunder Slam',
    branch: 'power',
    tier: 3,
    cost: 5,
    requires: ['power_suplex'],
    unlocksMove: 'sig_thunder_slam',
    passive: { throwPower: 0.1 },
    description: 'Unlocks the Thunder Slam signature move.',
    icon: '⚡',
  },
  {
    id: 'fin_koshti_crusher',
    name: 'Finisher: Koshti Crusher',
    branch: 'power',
    tier: 4,
    cost: 8,
    requires: ['sig_thunder_slam', 'power_wall'],
    unlocksMove: 'fin_koshti_crusher',
    grants: { strength: 6 },
    description: 'Unlocks the Koshti Crusher finisher. Needs full momentum to fire.',
    icon: '💀',
  },

  // ------------------------------------------------------------ TECHNIQUE
  {
    id: 'tech_root',
    name: 'Chain Wrestling',
    branch: 'technique',
    tier: 0,
    cost: 1,
    requires: [],
    grants: { technique: 3 },
    description: '+3 Technique. Every position flows into the next.',
    icon: '🔗',
  },
  {
    id: 'tech_ankle_pick',
    name: 'Ankle Pick',
    branch: 'technique',
    tier: 1,
    cost: 2,
    requires: ['tech_root'],
    unlocksMove: 'tech_ankle_pick',
    grants: { technique: 2 },
    description: 'Unlocks the Ankle Pick takedown from the clinch.',
    icon: '🦶',
  },
  {
    id: 'tech_counter',
    name: 'Counter Sense',
    branch: 'technique',
    tier: 1,
    cost: 2,
    requires: ['tech_root'],
    passive: { reversalWindow: 0.09, reversalPower: 0.08 },
    description: 'Widens your reversal window by 90ms and +8% reversal success.',
    icon: '🔄',
  },
  {
    id: 'tech_headlock',
    name: 'Headlock Throw',
    branch: 'technique',
    tier: 2,
    cost: 3,
    requires: ['tech_ankle_pick'],
    unlocksMove: 'tech_headlock',
    grants: { technique: 3 },
    description: 'Unlocks the Headlock Throw.',
    icon: '🌀',
  },
  {
    id: 'tech_guillotine',
    name: 'Guillotine Choke',
    branch: 'technique',
    tier: 2,
    cost: 3,
    requires: ['tech_counter'],
    unlocksMove: 'tech_guillotine',
    passive: { submissionPower: 0.15 },
    description: 'Unlocks the Guillotine and +15% submission damage.',
    icon: '🪢',
  },
  {
    id: 'sig_lightning_roll',
    name: 'Signature: Lightning Roll',
    branch: 'technique',
    tier: 3,
    cost: 5,
    requires: ['tech_headlock'],
    unlocksMove: 'sig_lightning_roll',
    passive: { momentumGain: 0.1 },
    description: 'Unlocks the Lightning Roll signature chain.',
    icon: '🌩️',
  },
  {
    id: 'fin_iron_clutch',
    name: 'Finisher: Iron Clutch',
    branch: 'technique',
    tier: 4,
    cost: 8,
    requires: ['sig_lightning_roll', 'tech_guillotine'],
    unlocksMove: 'fin_iron_clutch',
    grants: { technique: 6 },
    description: 'Unlocks the Iron Clutch finisher.',
    icon: '☠️',
  },

  // --------------------------------------------------------- CONDITIONING
  {
    id: 'cond_root',
    name: 'Deep Lungs',
    branch: 'conditioning',
    tier: 0,
    cost: 1,
    requires: [],
    grants: { stamina: 4 },
    description: '+4 Stamina. Round three is where you win.',
    icon: '🫁',
  },
  {
    id: 'cond_recovery',
    name: 'Fast Recovery',
    branch: 'conditioning',
    tier: 1,
    cost: 2,
    requires: ['cond_root'],
    passive: { staminaRegen: 0.2 },
    description: '+20% stamina regeneration between exchanges.',
    icon: '♻️',
  },
  {
    id: 'cond_footwork',
    name: 'Live Footwork',
    branch: 'conditioning',
    tier: 1,
    cost: 2,
    requires: ['cond_root'],
    grants: { speed: 4 },
    passive: { shotSpeed: 0.08 },
    description: '+4 Speed and 8% faster move wind-up.',
    icon: '👟',
  },
  {
    id: 'cond_engine',
    name: 'Endless Engine',
    branch: 'conditioning',
    tier: 2,
    cost: 4,
    requires: ['cond_recovery'],
    grants: { stamina: 6 },
    passive: { staminaRegen: 0.15 },
    description: '+6 Stamina, +15% more regen. You simply do not tire.',
    icon: '🔋',
  },
  {
    id: 'cond_scramble',
    name: 'Scramble King',
    branch: 'conditioning',
    tier: 3,
    cost: 5,
    requires: ['cond_footwork', 'cond_engine'],
    grants: { speed: 5, stamina: 3 },
    passive: { escapeSpeed: 0.25, reversalWindow: 0.05 },
    description: '+25% faster escapes from bad positions and a wider counter window.',
    icon: '🤸',
  },

  // ---------------------------------------------------------- SHOWMANSHIP
  {
    id: 'show_root',
    name: 'Crowd Worker',
    branch: 'showmanship',
    tier: 0,
    cost: 1,
    requires: [],
    grants: { charisma: 4 },
    description: '+4 Charisma. The arena starts chanting your name.',
    icon: '🎭',
  },
  {
    id: 'show_momentum',
    name: 'Feed The Roar',
    branch: 'showmanship',
    tier: 1,
    cost: 2,
    requires: ['show_root'],
    passive: { momentumGain: 0.18 },
    description: '+18% momentum from every clean scoring move.',
    icon: '📣',
  },
  {
    id: 'show_sponsor',
    name: 'Sponsor Magnet',
    branch: 'showmanship',
    tier: 2,
    cost: 3,
    requires: ['show_root'],
    passive: { crowdFavour: 0.25 },
    description: '+25% coins and XP from every match.',
    icon: '💰',
  },
  {
    id: 'show_clutch',
    name: 'Main Event Nerve',
    branch: 'showmanship',
    tier: 3,
    cost: 5,
    requires: ['show_momentum', 'show_sponsor'],
    grants: { charisma: 6 },
    passive: { momentumGain: 0.15, reversalPower: 0.06 },
    description: 'You get better as the lights get brighter.',
    icon: '🌟',
  },
] as const;

export const SKILL_BY_ID: ReadonlyMap<string, SkillNode> = new Map(
  SKILL_TREE.map((n) => [n.id, n]),
);

export const BRANCH_META: Record<SkillBranch, { name: string; color: string }> = {
  power: { name: 'Power', color: '#ff5d47' },
  technique: { name: 'Technique', color: '#c084fc' },
  conditioning: { name: 'Conditioning', color: '#4ade80' },
  showmanship: { name: 'Showmanship', color: '#f472b6' },
};

export const canUnlock = (node: SkillNode, owned: ReadonlySet<string>, points: number): boolean => {
  if (owned.has(node.id)) return false;
  if (points < node.cost) return false;
  return node.requires.every((r) => owned.has(r));
};

export const emptyPassives = (): Record<PassiveKey, number> => ({
  reversalWindow: 0,
  reversalPower: 0,
  staminaRegen: 0,
  momentumGain: 0,
  damageReduction: 0,
  submissionPower: 0,
  throwPower: 0,
  shotSpeed: 0,
  crowdFavour: 0,
  escapeSpeed: 0,
});

export const accumulatePassives = (owned: Iterable<string>): Record<PassiveKey, number> => {
  const out = emptyPassives();
  for (const id of owned) {
    const node = SKILL_BY_ID.get(id);
    if (!node?.passive) continue;
    for (const [k, v] of Object.entries(node.passive)) {
      out[k as PassiveKey] += v as number;
    }
  }
  return out;
};
