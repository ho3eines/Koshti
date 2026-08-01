import type { Attributes } from '../data/attributes';
import type { MoveDef, Range } from '../data/moves';
import type { FightingStyle } from '../data/styles';
import type { PassiveKey } from '../data/skills';
import type { MatchFormat } from '../data/leagues';

export type Side = 'player' | 'opponent';

export const other = (s: Side): Side => (s === 'player' ? 'opponent' : 'player');

export interface FighterConfig {
  id: string;
  name: string;
  shortName: string;
  attributes: Attributes;
  style: FightingStyle;
  moves: readonly string[];
  passives: Record<PassiveKey, number>;
  clubId?: string;
  /** 0..1 — colours the AI difficulty. Ignored for the player. */
  difficulty?: number;
  tint: number;
  trunks: number;
}

export type ActionPhase = 'idle' | 'windup' | 'active' | 'recovery' | 'stunned' | 'downed' | 'blocking';

export interface FighterState {
  side: Side;
  cfg: FighterConfig;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  momentum: number;
  maxMomentum: number;
  score: number;
  phase: ActionPhase;
  /** Currently executing move. */
  move: MoveDef | null;
  /** Seconds remaining in the current phase. */
  phaseTime: number;
  /** Blocking / defensive posture held. */
  guarding: boolean;
  /** Consecutive successful moves — powers combo scoring. */
  combo: number;
  comboTimer: number;
  /** Fatigue 0..1 accumulates and suppresses max effective stamina. */
  fatigue: number;
  /** Position on the mat (x,z metres) — drives the 3D renderer. */
  x: number;
  z: number;
  facing: number;
  /** How many times reversed in a row — used by adaptive AI. */
  reversalStreak: number;
  /** Set while a reversal input window is open against this fighter's attacker. */
  counterWindow: number;
  lastMoveId: string | null;
  downedTimer: number;
}

export type Stance = Range;

export interface MatchConfig {
  format: MatchFormat;
  rounds: number;
  roundSeconds: number;
  arenaCrowd: number;
  seed: number;
  player: FighterConfig;
  opponent: FighterConfig;
  /** Difficulty scalar 0..1 from the division. */
  difficulty: number;
  title?: string;
  subtitle?: string;
}

export type MatchOutcome =
  | { type: 'pin'; winner: Side }
  | { type: 'submission'; winner: Side }
  | { type: 'knockout'; winner: Side }
  | { type: 'points'; winner: Side | 'draw' }
  | { type: 'retired'; winner: Side };

export interface MatchResult {
  outcome: MatchOutcome;
  playerScore: number;
  opponentScore: number;
  rounds: number;
  duration: number;
  stats: MatchStats;
}

export interface MatchStats {
  movesLanded: number;
  movesAttempted: number;
  reversals: number;
  reversalsAgainst: number;
  biggestHit: number;
  finishersLanded: number;
  perfectCounters: number;
  damageDealt: number;
  damageTaken: number;
  maxCombo: number;
}

export const emptyStats = (): MatchStats => ({
  movesLanded: 0,
  movesAttempted: 0,
  reversals: 0,
  reversalsAgainst: 0,
  biggestHit: 0,
  finishersLanded: 0,
  perfectCounters: 0,
  damageDealt: 0,
  damageTaken: 0,
  maxCombo: 0,
});

export type SimEvent =
  | { t: 'move_start'; side: Side; move: MoveDef }
  | { t: 'move_hit'; side: Side; move: MoveDef; damage: number; critical: boolean; combo: number }
  | { t: 'move_miss'; side: Side; move: MoveDef }
  | { t: 'move_blocked'; side: Side; move: MoveDef }
  | { t: 'reversal'; side: Side; against: MoveDef; perfect: boolean }
  | { t: 'counter_window'; side: Side; move: MoveDef; duration: number }
  | { t: 'counter_window_end'; side: Side }
  | { t: 'stance_change'; stance: Stance }
  | { t: 'knockdown'; side: Side }
  | { t: 'recover'; side: Side }
  | { t: 'score'; side: Side; points: number; reason: string }
  | { t: 'exhausted'; side: Side }
  | { t: 'second_wind'; side: Side }
  | { t: 'momentum_full'; side: Side }
  | { t: 'round_end'; round: number }
  | { t: 'round_start'; round: number }
  | { t: 'match_end'; result: MatchResult }
  | { t: 'crowd'; intensity: number }
  | { t: 'pin_attempt'; side: Side; progress: number }
  | { t: 'pin_broken'; side: Side }
  | { t: 'submission_attempt'; side: Side; progress: number }
  | { t: 'submission_broken'; side: Side }
  | { t: 'taunt'; side: Side };

export type PlayerCommand =
  | { c: 'move'; moveId: string }
  | { c: 'guard'; on: boolean }
  | { c: 'reverse' }
  | { c: 'escape' }
  | { c: 'pin' }
  | { c: 'taunt' }
  | { c: 'walk'; dx: number; dz: number };
