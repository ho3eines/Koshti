import type { AttributeKey } from '../data/attributes';

export type TrainingObjectiveKind =
  | 'walk'
  | 'stance'
  | 'move_category'
  | 'move_specific'
  | 'guard'
  | 'reverse'
  | 'combo'
  | 'survive'
  | 'takedown_count'
  | 'finish';

export interface TrainingObjective {
  id: string;
  kind: TrainingObjectiveKind;
  /** Target count / seconds. */
  target: number;
  label: string;
  hint: string;
  /** Extra qualifier: category name, move id, stance name. */
  arg?: string;
}

export interface TrainingStage {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  brief: string;
  /** Ordered objectives — the tutorial walks through them one at a time. */
  objectives: TrainingObjective[];
  /** Seconds allowed; 0 = untimed. */
  timeLimit: number;
  requires: string | null;
  rewards: {
    xp: number;
    coins: number;
    skillPoints: number;
    attribute?: { key: AttributeKey; amount: number };
    unlocksMove?: string;
  };
  /** Star thresholds in seconds (faster = more stars). 0 index = 1 star. */
  starTimes: [number, number, number];
  /** Opponent aggression during this drill 0..1. */
  dummyAggression: number;
  icon: string;
}

export const TRAINING_STAGES: readonly TrainingStage[] = [
  {
    id: 'stance',
    index: 0,
    name: 'Stance & Footwork',
    subtitle: 'Basic movement and positioning',
    brief:
      'Everything starts with your base. Learn to circle, close distance and keep your hips under you.',
    objectives: [
      {
        id: 'move_around',
        kind: 'walk',
        target: 6,
        label: 'Circle the mat',
        hint: 'Drag the left side of the screen to move. Stay light on your feet.',
      },
      {
        id: 'enter_clinch',
        kind: 'stance',
        target: 2,
        arg: 'clinch',
        hint: 'Tap COLLAR & ELBOW to tie up and enter the clinch.',
        label: 'Enter the clinch twice',
      },
      {
        id: 'break_away',
        kind: 'stance',
        target: 2,
        arg: 'standing',
        label: 'Break back to open space',
        hint: 'Tap ESCAPE to disengage and reset to standing.',
      },
    ],
    timeLimit: 0,
    requires: null,
    rewards: { xp: 90, coins: 80, skillPoints: 1, attribute: { key: 'speed', amount: 1 } },
    starTimes: [70, 45, 28],
    dummyAggression: 0,
    icon: '🦵',
  },
  {
    id: 'attack',
    index: 1,
    name: 'Attacking Basics',
    subtitle: 'Landing your first offense',
    brief: 'A takedown is a level change plus commitment. Set it up, then finish it.',
    objectives: [
      {
        id: 'land_strikes',
        kind: 'move_category',
        target: 3,
        arg: 'strike',
        label: 'Land 3 setup strikes',
        hint: 'SNAP breaks their posture and opens the shot.',
      },
      {
        id: 'land_grapples',
        kind: 'move_category',
        target: 2,
        arg: 'grapple',
        label: 'Win 2 tie-ups',
        hint: 'Grapples control the position and build momentum.',
      },
      {
        id: 'land_takedowns',
        kind: 'takedown_count',
        target: 3,
        label: 'Score 3 takedowns',
        hint: 'DOUBLE LEG from standing. Watch your stamina bar.',
      },
    ],
    timeLimit: 120,
    requires: 'stance',
    rewards: { xp: 140, coins: 120, skillPoints: 1, attribute: { key: 'strength', amount: 1 } },
    starTimes: [110, 75, 50],
    dummyAggression: 0.05,
    icon: '🥊',
  },
  {
    id: 'defense',
    index: 2,
    name: 'Defense & Blocking',
    subtitle: 'Not getting scored on',
    brief:
      'Defense wins divisions. Hold your guard to absorb damage and pick your moment to fire back.',
    objectives: [
      {
        id: 'hold_guard',
        kind: 'guard',
        target: 8,
        label: 'Hold guard for 8 seconds',
        hint: 'Press and hold the GUARD button. Guarding drains less stamina than getting hit.',
      },
      {
        id: 'survive',
        kind: 'survive',
        target: 30,
        label: 'Survive 30 seconds of pressure',
        hint: 'The coach is coming forward. Block, circle, recover.',
      },
    ],
    timeLimit: 90,
    requires: 'attack',
    rewards: { xp: 160, coins: 140, skillPoints: 1, attribute: { key: 'defense', amount: 2 } },
    starTimes: [80, 60, 42],
    dummyAggression: 0.55,
    icon: '🛡️',
  },
  {
    id: 'counters',
    index: 3,
    name: 'Counters & Reversals',
    subtitle: 'Turning defense into offense',
    brief:
      'When they commit, a window opens. Tap REVERSE inside it and the match flips in one beat.',
    objectives: [
      {
        id: 'reverse_3',
        kind: 'reverse',
        target: 3,
        label: 'Land 3 reversals',
        hint: 'The REVERSE button flashes when the window is open. Timing beats strength.',
      },
    ],
    timeLimit: 120,
    requires: 'defense',
    rewards: {
      xp: 220,
      coins: 190,
      skillPoints: 1,
      attribute: { key: 'technique', amount: 2 },
      unlocksMove: 'single_leg',
    },
    starTimes: [110, 80, 55],
    dummyAggression: 0.8,
    icon: '🔄',
  },
  {
    id: 'ground',
    index: 4,
    name: 'Ground Control',
    subtitle: 'Finishing on the mat',
    brief:
      'Points are won on top. Turn them, hold them, and take the pin or the tap when it is there.',
    objectives: [
      {
        id: 'ground_moves',
        kind: 'move_category',
        target: 3,
        arg: 'submission',
        label: 'Apply 3 ground holds',
        hint: 'Get the takedown first, then work HALF NELSON on the mat.',
      },
      {
        id: 'pin_once',
        kind: 'finish',
        target: 1,
        label: 'Secure one pin',
        hint: 'When they are hurt or downed, tap PIN and hold them there.',
      },
    ],
    timeLimit: 150,
    requires: 'counters',
    rewards: { xp: 260, coins: 230, skillPoints: 1, attribute: { key: 'technique', amount: 1 } },
    starTimes: [140, 100, 70],
    dummyAggression: 0.35,
    icon: '🤼',
  },
  {
    id: 'combos',
    index: 5,
    name: 'Advanced Combinations',
    subtitle: 'Chaining it all together',
    brief:
      'Elite wrestlers never throw one move. Chain them before the combo timer expires to multiply damage.',
    objectives: [
      {
        id: 'combo_4',
        kind: 'combo',
        target: 4,
        label: 'Land a 4-move combo',
        hint: 'Keep landing before the combo meter drains. Strike → tie-up → takedown → turn.',
      },
      {
        id: 'finish_it',
        kind: 'finish',
        target: 1,
        label: 'Finish the drill',
        hint: 'Pin or submit the coach to graduate.',
      },
    ],
    timeLimit: 180,
    requires: 'ground',
    rewards: {
      xp: 380,
      coins: 350,
      skillPoints: 2,
      attribute: { key: 'stamina', amount: 2 },
      unlocksMove: 'hip_toss',
    },
    starTimes: [170, 120, 85],
    dummyAggression: 0.6,
    icon: '🌀',
  },
] as const;

export const STAGE_BY_ID = new Map(TRAINING_STAGES.map((s) => [s.id, s]));

export const nextStage = (completed: readonly string[]): TrainingStage | null => {
  for (const s of TRAINING_STAGES) if (!completed.includes(s.id)) return s;
  return null;
};

export const stageUnlocked = (stage: TrainingStage, completed: readonly string[]): boolean =>
  stage.requires === null || completed.includes(stage.requires);

export const starsForTime = (stage: TrainingStage, seconds: number): number => {
  const [one, two, three] = stage.starTimes;
  if (seconds <= three) return 3;
  if (seconds <= two) return 2;
  if (seconds <= one) return 1;
  return 1;
};
