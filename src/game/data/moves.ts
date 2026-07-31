import type { AttributeKey } from './attributes';

export type MoveCategory =
  | 'strike'
  | 'grapple'
  | 'takedown'
  | 'throw'
  | 'submission'
  | 'signature'
  | 'finisher'
  | 'defense';

/** Which stance the move can be initiated from. */
export type Range = 'standing' | 'clinch' | 'ground';

export interface MoveDef {
  id: string;
  name: string;
  category: MoveCategory;
  range: Range;
  /** Stance the opponent is left in after a successful hit. */
  leaves: Range;
  /** Seconds of committed animation — you are vulnerable during this. */
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  staminaCost: number;
  /** 0..1 base chance before attribute modifiers. */
  baseAccuracy: number;
  /** How much momentum a clean hit generates. */
  momentum: number;
  /** Primary attribute this move scales with. */
  scaling: AttributeKey;
  /** Difficulty for the opponent to reverse (0 easy .. 1 near-impossible). */
  reversalResist: number;
  /** Unlock gate: null = available from the start. */
  unlock?: string;
  description: string;
  /** Animation clip key consumed by the renderer. */
  clip: string;
  /** Camera shake impulse on impact. */
  impact: number;
  /** Optional: pins opponent for a pin attempt afterwards. */
  knockdown?: boolean;
}

export const MOVES: readonly MoveDef[] = [
  // ---------------------------------------------------------------- strikes
  {
    id: 'jab_setup',
    name: 'Collar Tie Snap',
    category: 'strike',
    range: 'standing',
    leaves: 'standing',
    windup: 0.13,
    active: 0.09,
    recovery: 0.2,
    damage: 4,
    staminaCost: 3,
    baseAccuracy: 0.9,
    momentum: 3,
    scaling: 'speed',
    reversalResist: 0.55,
    description: 'Fast snap-down to break posture and open the clinch.',
    clip: 'snap',
    impact: 0.25,
  },
  {
    id: 'body_lock_knee',
    name: 'Body Lock Knee',
    category: 'strike',
    range: 'clinch',
    leaves: 'clinch',
    windup: 0.2,
    active: 0.12,
    recovery: 0.28,
    damage: 8,
    staminaCost: 6,
    baseAccuracy: 0.82,
    momentum: 5,
    scaling: 'strength',
    reversalResist: 0.5,
    description: 'Drive a knee into the ribs to soften the body lock.',
    clip: 'knee',
    impact: 0.45,
  },

  // --------------------------------------------------------------- grapples
  {
    id: 'collar_elbow',
    name: 'Collar & Elbow',
    category: 'grapple',
    range: 'standing',
    leaves: 'clinch',
    windup: 0.22,
    active: 0.18,
    recovery: 0.26,
    damage: 3,
    staminaCost: 5,
    baseAccuracy: 0.86,
    momentum: 4,
    scaling: 'technique',
    reversalResist: 0.45,
    description: 'Classic tie-up. Wins the inside position and forces the clinch.',
    clip: 'tieup',
    impact: 0.2,
  },
  {
    id: 'underhook',
    name: 'Double Underhook',
    category: 'grapple',
    range: 'clinch',
    leaves: 'clinch',
    windup: 0.26,
    active: 0.2,
    recovery: 0.3,
    damage: 6,
    staminaCost: 7,
    baseAccuracy: 0.8,
    momentum: 6,
    scaling: 'strength',
    reversalResist: 0.55,
    description: 'Lock both underhooks — the gateway to every big throw.',
    clip: 'underhook',
    impact: 0.3,
  },

  // -------------------------------------------------------------- takedowns
  {
    id: 'double_leg',
    name: 'Double Leg',
    category: 'takedown',
    range: 'standing',
    leaves: 'ground',
    windup: 0.3,
    active: 0.24,
    recovery: 0.42,
    damage: 12,
    staminaCost: 12,
    baseAccuracy: 0.74,
    momentum: 10,
    scaling: 'speed',
    reversalResist: 0.5,
    description: 'Explosive level change, drive through both legs, finish on top.',
    clip: 'double_leg',
    impact: 0.75,
    knockdown: true,
  },
  {
    id: 'single_leg',
    name: 'High Crotch Single',
    category: 'takedown',
    range: 'standing',
    leaves: 'ground',
    windup: 0.28,
    active: 0.26,
    recovery: 0.4,
    damage: 10,
    staminaCost: 10,
    baseAccuracy: 0.78,
    momentum: 9,
    scaling: 'technique',
    reversalResist: 0.48,
    description: 'Elevate the lead leg, run the pipe and land in control.',
    clip: 'single_leg',
    impact: 0.65,
    knockdown: true,
  },
  {
    id: 'ankle_pick',
    name: 'Ankle Pick',
    category: 'takedown',
    range: 'clinch',
    leaves: 'ground',
    windup: 0.22,
    active: 0.2,
    recovery: 0.34,
    damage: 9,
    staminaCost: 8,
    baseAccuracy: 0.8,
    momentum: 8,
    scaling: 'technique',
    reversalResist: 0.58,
    unlock: 'tech_ankle_pick',
    description: 'Snap the head, pick the ankle. Pure timing.',
    clip: 'ankle_pick',
    impact: 0.55,
    knockdown: true,
  },

  // ----------------------------------------------------------------- throws
  {
    id: 'hip_toss',
    name: 'Hip Toss',
    category: 'throw',
    range: 'clinch',
    leaves: 'ground',
    windup: 0.34,
    active: 0.3,
    recovery: 0.5,
    damage: 16,
    staminaCost: 15,
    baseAccuracy: 0.7,
    momentum: 13,
    scaling: 'strength',
    reversalResist: 0.52,
    description: 'Load them on the hip and dump them flat on their back.',
    clip: 'hip_toss',
    impact: 1.0,
    knockdown: true,
  },
  {
    id: 'suplex',
    name: 'Belly-to-Back Suplex',
    category: 'throw',
    range: 'clinch',
    leaves: 'ground',
    windup: 0.42,
    active: 0.36,
    recovery: 0.62,
    damage: 24,
    staminaCost: 22,
    baseAccuracy: 0.62,
    momentum: 20,
    scaling: 'strength',
    reversalResist: 0.62,
    unlock: 'power_suplex',
    description: 'Arch back and launch. The crowd loses its mind every time.',
    clip: 'suplex',
    impact: 1.4,
    knockdown: true,
  },
  {
    id: 'headlock_throw',
    name: 'Headlock Throw',
    category: 'throw',
    range: 'clinch',
    leaves: 'ground',
    windup: 0.36,
    active: 0.3,
    recovery: 0.52,
    damage: 18,
    staminaCost: 16,
    baseAccuracy: 0.68,
    momentum: 15,
    scaling: 'technique',
    reversalResist: 0.56,
    unlock: 'tech_headlock',
    description: 'Trap the head, rotate the hips, plant them shoulder-first.',
    clip: 'headlock_throw',
    impact: 1.15,
    knockdown: true,
  },

  // ------------------------------------------------------------ submissions
  {
    id: 'arm_bar',
    name: 'Arm Bar',
    category: 'submission',
    range: 'ground',
    leaves: 'ground',
    windup: 0.4,
    active: 0.5,
    recovery: 0.55,
    damage: 14,
    staminaCost: 14,
    baseAccuracy: 0.66,
    momentum: 14,
    scaling: 'technique',
    reversalResist: 0.6,
    description: 'Isolate the arm, hips high, bridge until the tap comes.',
    clip: 'armbar',
    impact: 0.5,
  },
  {
    id: 'half_nelson',
    name: 'Half Nelson Turn',
    category: 'submission',
    range: 'ground',
    leaves: 'ground',
    windup: 0.32,
    active: 0.4,
    recovery: 0.44,
    damage: 11,
    staminaCost: 11,
    baseAccuracy: 0.75,
    momentum: 10,
    scaling: 'strength',
    reversalResist: 0.5,
    description: 'Thread the arm, crank the neck, expose the shoulders.',
    clip: 'half_nelson',
    impact: 0.4,
  },
  {
    id: 'guillotine',
    name: 'Guillotine Choke',
    category: 'submission',
    range: 'ground',
    leaves: 'ground',
    windup: 0.46,
    active: 0.62,
    recovery: 0.6,
    damage: 20,
    staminaCost: 18,
    baseAccuracy: 0.6,
    momentum: 18,
    scaling: 'technique',
    reversalResist: 0.68,
    unlock: 'tech_guillotine',
    description: 'Chin strapped, elbow tight. Count to five and it is over.',
    clip: 'guillotine',
    impact: 0.45,
  },

  // -------------------------------------------------------------- signature
  {
    id: 'sig_thunder_slam',
    name: 'Thunder Slam',
    category: 'signature',
    range: 'clinch',
    leaves: 'ground',
    windup: 0.5,
    active: 0.4,
    recovery: 0.7,
    damage: 30,
    staminaCost: 24,
    baseAccuracy: 0.72,
    momentum: 26,
    scaling: 'strength',
    reversalResist: 0.72,
    unlock: 'sig_thunder_slam',
    description: 'Signature: lift, hold, and drive them through the canvas.',
    clip: 'thunder_slam',
    impact: 1.7,
    knockdown: true,
  },
  {
    id: 'sig_lightning_roll',
    name: 'Lightning Roll',
    category: 'signature',
    range: 'ground',
    leaves: 'ground',
    windup: 0.34,
    active: 0.46,
    recovery: 0.5,
    damage: 24,
    staminaCost: 20,
    baseAccuracy: 0.78,
    momentum: 24,
    scaling: 'speed',
    reversalResist: 0.7,
    unlock: 'sig_lightning_roll',
    description: 'Signature: a gut-wrench chain that racks up points in seconds.',
    clip: 'lightning_roll',
    impact: 0.9,
  },

  // --------------------------------------------------------------- finisher
  {
    id: 'fin_koshti_crusher',
    name: 'Koshti Crusher',
    category: 'finisher',
    range: 'clinch',
    leaves: 'ground',
    windup: 0.62,
    active: 0.5,
    recovery: 0.9,
    damage: 52,
    staminaCost: 34,
    baseAccuracy: 0.8,
    momentum: 40,
    scaling: 'strength',
    reversalResist: 0.85,
    unlock: 'fin_koshti_crusher',
    description: 'FINISHER: the match-ending lift-and-plant. Requires full momentum.',
    clip: 'crusher',
    impact: 2.2,
    knockdown: true,
  },
  {
    id: 'fin_iron_clutch',
    name: 'Iron Clutch',
    category: 'finisher',
    range: 'ground',
    leaves: 'ground',
    windup: 0.5,
    active: 0.7,
    recovery: 0.8,
    damage: 46,
    staminaCost: 30,
    baseAccuracy: 0.84,
    momentum: 38,
    scaling: 'technique',
    reversalResist: 0.88,
    unlock: 'fin_iron_clutch',
    description: 'FINISHER: an inescapable body-lock choke. They tap or they sleep.',
    clip: 'iron_clutch',
    impact: 1.2,
  },
] as const;

export const MOVE_BY_ID: ReadonlyMap<string, MoveDef> = new Map(MOVES.map((m) => [m.id, m]));

export const getMove = (id: string): MoveDef => {
  const m = MOVE_BY_ID.get(id);
  if (!m) throw new Error(`Unknown move: ${id}`);
  return m;
};

export const movesForRange = (range: Range): MoveDef[] =>
  MOVES.filter((m) => m.range === range);

/**
 * Skill nodes reference moves by an *unlock token* (e.g. 'power_suplex'),
 * which is not always the move's own id (e.g. 'suplex'). This maps a token to
 * the real move id so progression can never store an unresolvable reference.
 */
export const MOVE_ID_BY_UNLOCK: ReadonlyMap<string, string> = new Map(
  MOVES.filter((m) => m.unlock).map((m) => [m.unlock as string, m.id]),
);

export const resolveUnlockToMoveId = (token: string): string | null =>
  MOVE_ID_BY_UNLOCK.get(token) ?? (MOVE_BY_ID.has(token) ? token : null);

export const hasMove = (id: string): boolean => MOVE_BY_ID.has(id);

/** Total committed time of a move in seconds. */
export const moveDuration = (m: MoveDef): number => m.windup + m.active + m.recovery;

export const STARTER_MOVES: readonly string[] = [
  'jab_setup',
  'collar_elbow',
  'double_leg',
  'half_nelson',
] as const;
