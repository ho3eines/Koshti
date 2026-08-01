import { clamp, clamp01, damp } from '../../core/math';
import { Rng } from '../../core/rng';
import { getMove, hasMove, type MoveDef } from '../data/moves';
import { STYLES } from '../data/styles';
import {
  emptyStats,
  other,
  type FighterConfig,
  type FighterState,
  type MatchConfig,
  type MatchResult,
  type MatchStats,
  type PlayerCommand,
  type Side,
  type SimEvent,
  type Stance,
} from './types';
import { AiBrain } from './ai';

const MAT_RADIUS = 4.6;
const BASE_HEALTH = 150;
const BASE_STAMINA = 100;
const MAX_MOMENTUM = 100;
const COMBO_WINDOW = 2.1;
const PIN_HOLD_TIME = 3.0;
const SUB_HOLD_TIME = 4.0;

export interface SimOptions {
  onEvent?: (e: SimEvent) => void;
}

const makeFighter = (side: Side, cfg: FighterConfig): FighterState => {
  const a = cfg.attributes;
  const maxHealth = BASE_HEALTH + a.defense * 1.6 + a.stamina * 0.8;
  const maxStamina = BASE_STAMINA + a.stamina * 1.4;
  return {
    side,
    cfg,
    health: maxHealth,
    maxHealth,
    stamina: maxStamina,
    maxStamina,
    momentum: 0,
    maxMomentum: MAX_MOMENTUM,
    score: 0,
    phase: 'idle',
    move: null,
    phaseTime: 0,
    guarding: false,
    combo: 0,
    comboTimer: 0,
    fatigue: 0,
    x: side === 'player' ? -1.0 : 1.0,
    z: 0,
    facing: side === 'player' ? Math.PI / 2 : -Math.PI / 2,
    reversalStreak: 0,
    counterWindow: 0,
    lastMoveId: null,
    downedTimer: 0,
  };
};

/**
 * Deterministic wrestling match simulation.
 *
 * Fixed-step (60Hz) so results are reproducible given the same seed and the
 * same command stream. The renderer reads state; it never writes it.
 */
export class MatchSim {
  readonly cfg: MatchConfig;
  readonly player: FighterState;
  readonly opponent: FighterState;
  readonly rng: Rng;
  readonly stats: MatchStats = emptyStats();

  stance: Stance = 'standing';
  round = 1;
  roundTime: number;
  elapsed = 0;
  finished = false;
  result: MatchResult | null = null;
  paused = false;

  /** Set when someone is being pinned / submitted. */
  pinning: { by: Side; progress: number } | null = null;
  submitting: { by: Side; progress: number } | null = null;

  /** Round-transition freeze. */
  intermission = 0;

  private ai: AiBrain;
  private emit: (e: SimEvent) => void;
  private crowdIntensity = 0;
  private pendingWalk = { dx: 0, dz: 0 };
  private secondWindUsed = new Set<Side>();

  constructor(cfg: MatchConfig, opts: SimOptions = {}) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.player = makeFighter('player', cfg.player);
    this.opponent = makeFighter('opponent', cfg.opponent);
    this.roundTime = cfg.roundSeconds;
    this.emit = opts.onEvent ?? (() => {});
    this.ai = new AiBrain(this, cfg.difficulty);
    this.emit({ t: 'round_start', round: 1 });
  }

  get(side: Side): FighterState {
    return side === 'player' ? this.player : this.opponent;
  }

  get crowd(): number {
    return this.crowdIntensity;
  }

  // ------------------------------------------------------------------ input

  command(cmd: PlayerCommand): boolean {
    if (this.finished || this.paused || this.intermission > 0) return false;
    const p = this.player;
    switch (cmd.c) {
      case 'walk':
        this.pendingWalk.dx = cmd.dx;
        this.pendingWalk.dz = cmd.dz;
        return true;
      case 'guard':
        if (p.phase === 'idle' || p.phase === 'blocking') {
          p.guarding = cmd.on;
          p.phase = cmd.on ? 'blocking' : 'idle';
          this.ai.observePlayerGuard(cmd.on);
          return true;
        }
        return false;
      case 'reverse':
        return this.tryReversal('player');
      case 'escape':
        return this.tryEscape('player');
      case 'pin':
        return this.tryPin('player');
      case 'taunt':
        if (p.phase === 'idle' && this.stance !== 'ground') {
          p.momentum = clamp(p.momentum + 6 + p.cfg.attributes.charisma * 0.08, 0, MAX_MOMENTUM);
          this.bumpCrowd(0.25);
          this.emit({ t: 'taunt', side: 'player' });
          return true;
        }
        return false;
      case 'move':
        return this.startMove('player', cmd.moveId);
    }
  }

  /** Can this side legally start this move right now? */
  canStart(side: Side, moveId: string): { ok: boolean; reason?: string } {
    const f = this.get(side);
    if (this.finished || this.intermission > 0) return { ok: false, reason: 'inactive' };
    if (f.phase !== 'idle' && f.phase !== 'blocking') return { ok: false, reason: 'busy' };
    if (f.downedTimer > 0) return { ok: false, reason: 'downed' };
    // A save could carry a stale/unknown move id — treat it as locked, never throw.
    if (!hasMove(moveId)) return { ok: false, reason: 'unknown' };
    if (!f.cfg.moves.includes(moveId)) return { ok: false, reason: 'locked' };
    const move = getMove(moveId);
    if (move.range !== this.stance) return { ok: false, reason: 'range' };
    if (f.stamina < move.staminaCost) return { ok: false, reason: 'stamina' };
    if (move.category === 'finisher' && f.momentum < MAX_MOMENTUM * 0.999)
      return { ok: false, reason: 'momentum' };
    if (move.category === 'signature' && f.momentum < MAX_MOMENTUM * 0.5)
      return { ok: false, reason: 'momentum' };
    return { ok: true };
  }

  startMove(side: Side, moveId: string): boolean {
    const check = this.canStart(side, moveId);
    if (!check.ok) return false;
    const f = this.get(side);
    const move = getMove(moveId);
    const speedup = 1 - clamp01(f.cfg.passives.shotSpeed) * 0.5 - (f.cfg.attributes.speed / 99) * 0.18;
    f.move = move;
    f.phase = 'windup';
    f.phaseTime = move.windup * Math.max(0.5, speedup);
    f.guarding = false;
    f.stamina = Math.max(0, f.stamina - move.staminaCost * (1 + f.fatigue * 0.35));
    if (side === 'player') {
      this.stats.movesAttempted++;
      this.ai.observePlayerMove(move, this.elapsed);
    }
    this.emit({ t: 'move_start', side, move });

    // Open the defender's counter window during wind-up.
    const def = this.get(other(side));
    const window = this.counterWindowFor(def, move);
    def.counterWindow = window;
    this.emit({ t: 'counter_window', side: def.side, move, duration: window });
    return true;
  }

  private counterWindowFor(defender: FighterState, move: MoveDef): number {
    const base = 0.24 + defender.cfg.attributes.technique / 99 * 0.16;
    const bonus = defender.cfg.passives.reversalWindow;
    const penalty = move.reversalResist * 0.14;
    const fatiguePenalty = defender.fatigue * 0.08;
    return Math.max(0.1, base + bonus - penalty - fatiguePenalty);
  }

  tryReversal(side: Side): boolean {
    const def = this.get(side);
    const atk = this.get(other(side));
    if (def.counterWindow <= 0 || !atk.move) return false;
    if (def.phase === 'downed' || def.downedTimer > 0) return false;
    if (atk.phase !== 'windup' && atk.phase !== 'active') return false;

    const move = atk.move;
    const perfect = def.counterWindow > this.counterWindowFor(def, move) * 0.55;
    const tech = def.cfg.attributes.technique / 99;
    const spd = def.cfg.attributes.speed / 99;
    let chance =
      0.34 + tech * 0.3 + spd * 0.12 + def.cfg.passives.reversalPower - move.reversalResist * 0.3;
    if (perfect) chance += 0.18;
    chance -= def.fatigue * 0.15;
    // Reversing a top-division wrestler is meaningfully harder.
    if (def.side === 'player') chance -= (this.cfg.difficulty - 0.5) * 0.22;
    chance = clamp(chance, 0.05, 0.95);

    def.counterWindow = 0;
    this.emit({ t: 'counter_window_end', side });

    const stCost = 8 + move.damage * 0.2;
    if (def.stamina < stCost) return false;
    def.stamina -= stCost;

    if (!this.rng.chance(chance)) {
      // Failed reversal — you eat the move harder.
      def.phase = 'stunned';
      def.phaseTime = 0.35;
      return false;
    }

    // Success: attacker is punished, defender takes control.
    atk.phase = 'stunned';
    atk.phaseTime = 0.55 + move.recovery;
    atk.move = null;
    atk.combo = 0;
    def.reversalStreak++;
    atk.reversalStreak = 0;

    const dmg = this.computeDamage(def, atk, move, perfect ? 0.7 : 0.5);
    this.applyDamage(atk, dmg);
    def.momentum = clamp(
      def.momentum + (move.momentum * 0.8 + (perfect ? 12 : 6)) * (1 + def.cfg.passives.momentumGain),
      0,
      MAX_MOMENTUM,
    );
    this.addScore(def.side, perfect ? 3 : 2, perfect ? 'Perfect reversal' : 'Reversal');
    this.bumpCrowd(perfect ? 0.85 : 0.6);

    if (side === 'player') {
      this.stats.reversals++;
      if (perfect) this.stats.perfectCounters++;
      this.stats.damageDealt += dmg;
    } else {
      this.stats.reversalsAgainst++;
      this.stats.damageTaken += dmg;
    }

    if (side === 'player') this.ai.observePlayerReversal();
    this.emit({ t: 'reversal', side, against: move, perfect });
    if (move.leaves === 'ground') this.setStance('ground');
    this.checkFinish();
    return true;
  }

  tryEscape(side: Side): boolean {
    const f = this.get(side);
    if (this.pinning?.by === other(side)) {
      const power = 0.14 + f.cfg.attributes.strength / 99 * 0.12 + f.cfg.passives.escapeSpeed * 0.2;
      this.pinning.progress = Math.max(0, this.pinning.progress - power);
      f.stamina = Math.max(0, f.stamina - 4);
      if (this.pinning.progress <= 0.001) {
        this.emit({ t: 'pin_broken', side });
        this.pinning = null;
        this.bumpCrowd(0.7);
      }
      return true;
    }
    if (this.submitting?.by === other(side)) {
      const power =
        0.11 + f.cfg.attributes.technique / 99 * 0.1 + f.cfg.passives.escapeSpeed * 0.18;
      this.submitting.progress = Math.max(0, this.submitting.progress - power);
      f.stamina = Math.max(0, f.stamina - 5);
      if (this.submitting.progress <= 0.001) {
        this.emit({ t: 'submission_broken', side });
        this.submitting = null;
        this.bumpCrowd(0.75);
      }
      return true;
    }
    if (this.stance === 'ground' && f.phase === 'idle') {
      const cost = 14 * (1 - f.cfg.passives.escapeSpeed * 0.4);
      if (f.stamina < cost) return false;
      f.stamina -= cost;
      const chance = clamp(0.4 + f.cfg.attributes.speed / 99 * 0.35 + f.cfg.passives.escapeSpeed, 0.1, 0.95);
      if (this.rng.chance(chance)) {
        this.setStance('standing');
        return true;
      }
      f.phase = 'recovery';
      f.phaseTime = 0.4;
      return false;
    }
    if (this.stance === 'clinch' && f.phase === 'idle') {
      f.stamina = Math.max(0, f.stamina - 8);
      if (this.rng.chance(0.6 + f.cfg.attributes.speed / 200)) {
        this.setStance('standing');
        return true;
      }
      return false;
    }
    return false;
  }

  tryPin(side: Side): boolean {
    if (this.stance !== 'ground') return false;
    const f = this.get(side);
    const o = this.get(other(side));
    if (f.phase !== 'idle') return false;
    if (this.pinning || this.submitting) return false;
    // Only viable when the opponent is hurt or downed.
    if (o.downedTimer <= 0 && o.health > o.maxHealth * 0.55) return false;
    f.stamina = Math.max(0, f.stamina - 10);
    this.pinning = { by: side, progress: 0.001 };
    this.emit({ t: 'pin_attempt', side, progress: 0 });
    this.bumpCrowd(0.9);
    return true;
  }

  // ------------------------------------------------------------- simulation

  /** Fixed-step update. Call with dt <= 1/30 for stability. */
  step(dt: number): void {
    if (this.finished || this.paused) return;

    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) {
        this.intermission = 0;
        this.startRound();
      }
      return;
    }

    this.elapsed += dt;
    this.roundTime -= dt;

    this.ai.update(dt);
    this.updateFighter(this.player, dt);
    this.updateFighter(this.opponent, dt);
    this.updateHolds(dt);
    this.updatePositions(dt);

    this.crowdIntensity = damp(this.crowdIntensity, this.cfg.arenaCrowd * 0.35, 1.2, dt);

    if (this.roundTime <= 0) this.endRound();
    this.checkFinish();
  }

  private updateFighter(f: FighterState, dt: number): void {
    // Counter window ticks down.
    if (f.counterWindow > 0) {
      f.counterWindow = Math.max(0, f.counterWindow - dt);
      if (f.counterWindow === 0) this.emit({ t: 'counter_window_end', side: f.side });
    }

    // Combo decay.
    if (f.combo > 0) {
      f.comboTimer -= dt;
      if (f.comboTimer <= 0) f.combo = 0;
    }

    // Downed recovery.
    if (f.downedTimer > 0) {
      f.downedTimer -= dt;
      if (f.downedTimer <= 0) {
        f.phase = 'idle';
        this.emit({ t: 'recover', side: f.side });
      }
    }

    // Stamina regen / fatigue.
    const regenBase = f.phase === 'idle' || f.phase === 'blocking' ? 9.5 : 3.0;
    const regen = regenBase * (1 + f.cfg.passives.staminaRegen) * (1 - f.fatigue * 0.5);
    const effectiveMax = f.maxStamina * (1 - f.fatigue * 0.35);
    f.stamina = clamp(f.stamina + regen * dt, 0, effectiveMax);

    // Fatigue creeps up over the match, faster when gassed.
    const fatigueRate = f.stamina < f.maxStamina * 0.25 ? 0.028 : 0.008;
    f.fatigue = clamp01(f.fatigue + fatigueRate * dt * (1 - f.cfg.attributes.stamina / 180));

    if (f.stamina < f.maxStamina * 0.12 && !this.secondWindUsed.has(f.side)) {
      this.emit({ t: 'exhausted', side: f.side });
      this.secondWindUsed.add(f.side);
    }

    // Phase machine.
    if (f.phase === 'idle' || f.phase === 'blocking' || f.phase === 'downed') return;
    f.phaseTime -= dt;
    if (f.phaseTime > 0) return;

    switch (f.phase) {
      case 'windup': {
        f.phase = 'active';
        f.phaseTime = f.move ? f.move.active : 0.1;
        break;
      }
      case 'active': {
        if (f.move) this.resolveMove(f, f.move);
        f.phase = 'recovery';
        f.phaseTime = f.move ? f.move.recovery * (1 + f.fatigue * 0.3) : 0.2;
        break;
      }
      case 'recovery':
      case 'stunned': {
        f.phase = 'idle';
        f.move = null;
        f.phaseTime = 0;
        break;
      }
      default:
        break;
    }
  }

  private resolveMove(atk: FighterState, move: MoveDef): void {
    const def = this.get(other(atk.side));

    // Defender downed = guaranteed connect on ground moves.
    const defenderHelpless = def.downedTimer > 0 || def.phase === 'stunned';

    let acc = move.baseAccuracy;
    const scale = atk.cfg.attributes[move.scaling] / 99;
    acc += scale * 0.16;
    acc -= (def.cfg.attributes.defense / 99) * 0.14;
    acc -= atk.fatigue * 0.18;
    // Championship-calibre opponents simply miss less.
    if (atk.side === 'opponent') acc += (this.cfg.difficulty - 0.5) * 0.14;
    if (def.guarding) acc -= 0.22;
    if (defenderHelpless) acc = 0.98;
    acc = clamp(acc, 0.08, 0.98);

    if (!this.rng.chance(acc)) {
      this.emit({ t: 'move_miss', side: atk.side, move });
      atk.combo = 0;
      atk.momentum = Math.max(0, atk.momentum - 3);
      return;
    }

    if (def.guarding && !defenderHelpless && this.rng.chance(0.55)) {
      const chip = this.computeDamage(atk, def, move, 0.22);
      this.applyDamage(def, chip);
      def.stamina = Math.max(0, def.stamina - move.damage * 0.25);
      this.emit({ t: 'move_blocked', side: atk.side, move });
      this.bumpCrowd(0.15);
      return;
    }

    // Clean hit.
    const critical = this.rng.chance(0.08 + scale * 0.1 + atk.combo * 0.02);
    const dmg = this.computeDamage(atk, def, move, critical ? 1.45 : 1.0);
    this.applyDamage(def, dmg);

    atk.combo++;
    atk.comboTimer = COMBO_WINDOW;
    if (atk.side === 'player') {
      this.stats.movesLanded++;
      this.stats.damageDealt += dmg;
      this.stats.biggestHit = Math.max(this.stats.biggestHit, dmg);
      this.stats.maxCombo = Math.max(this.stats.maxCombo, atk.combo);
      if (move.category === 'finisher') this.stats.finishersLanded++;
    } else {
      this.stats.damageTaken += dmg;
    }

    const momo = move.momentum * (1 + atk.cfg.passives.momentumGain) * (critical ? 1.3 : 1);
    const before = atk.momentum;
    atk.momentum = clamp(atk.momentum + momo, 0, MAX_MOMENTUM);
    if (before < MAX_MOMENTUM && atk.momentum >= MAX_MOMENTUM) {
      this.emit({ t: 'momentum_full', side: atk.side });
    }
    def.momentum = Math.max(0, def.momentum - momo * 0.25);

    // Scoring: wrestling points by category.
    const pts = this.pointsFor(move, critical);
    if (pts > 0) this.addScore(atk.side, pts, move.name);

    this.emit({ t: 'move_hit', side: atk.side, move, damage: dmg, critical, combo: atk.combo });
    this.bumpCrowd(clamp01(move.impact * 0.45 + (critical ? 0.25 : 0)));

    if (move.leaves !== this.stance) this.setStance(move.leaves);

    if (move.knockdown) {
      def.phase = 'downed';
      def.downedTimer = clamp(1.0 + move.damage * 0.03 - def.cfg.attributes.defense / 260, 0.5, 3.0);
      def.move = null;
      def.combo = 0;
      this.emit({ t: 'knockdown', side: def.side });
    }

    // Finishers and heavy submissions start a hold.
    if (move.category === 'submission' || move.category === 'finisher') {
      if (move.category === 'submission' || move.range === 'ground') {
        this.submitting = { by: atk.side, progress: move.category === 'finisher' ? 0.45 : 0.2 };
        this.emit({ t: 'submission_attempt', side: atk.side, progress: this.submitting.progress });
      }
    }

    if (move.category === 'finisher' || move.category === 'signature') {
      atk.momentum = move.category === 'finisher' ? 0 : Math.max(0, atk.momentum - 50);
    }
  }

  private pointsFor(move: MoveDef, critical: boolean): number {
    let p = 0;
    switch (move.category) {
      case 'takedown':
        p = 2;
        break;
      case 'throw':
        p = 4;
        break;
      case 'submission':
        p = 2;
        break;
      case 'signature':
        p = 4;
        break;
      case 'finisher':
        p = 5;
        break;
      case 'grapple':
        p = 1;
        break;
      default:
        p = 0;
    }
    if (critical && p > 0) p += 1;
    return p;
  }

  private computeDamage(atk: FighterState, def: FighterState, move: MoveDef, mult: number): number {
    const scale = atk.cfg.attributes[move.scaling] / 99;
    let dmg = move.damage * (0.72 + scale * 0.66) * mult;

    if (move.category === 'throw') dmg *= 1 + atk.cfg.passives.throwPower;
    if (move.category === 'submission') dmg *= 1 + atk.cfg.passives.submissionPower;

    // Combo bonus.
    dmg *= 1 + Math.min(atk.combo, 5) * 0.06;
    // Attacker fatigue softens output.
    dmg *= 1 - atk.fatigue * 0.28;
    // Defender resistance.
    dmg *= 1 - clamp01(def.cfg.attributes.defense / 99) * 0.24;
    dmg *= 1 - clamp01(def.cfg.passives.damageReduction);
    // Difficulty scaling for the AI so higher divisions genuinely bite.
    if (atk.side === 'opponent') dmg *= 0.72 + this.cfg.difficulty * 0.95;

    return Math.max(1, Math.round(dmg * 10) / 10);
  }

  private applyDamage(f: FighterState, dmg: number): void {
    f.health = Math.max(0, f.health - dmg);
    f.stamina = Math.max(0, f.stamina - dmg * 0.18);
  }

  private addScore(side: Side, points: number, reason: string): void {
    this.get(side).score += points;
    this.emit({ t: 'score', side, points, reason });
  }

  private setStance(s: Stance): void {
    if (this.stance === s) return;
    this.stance = s;
    if (s !== 'ground') {
      this.pinning = null;
      this.submitting = null;
    }
    this.emit({ t: 'stance_change', stance: s });
  }

  private updateHolds(dt: number): void {
    // NOTE: the AI's auto-struggle below can clear `pinning` / `submitting`
    // mid-update (a successful escape). Everything after that call must be
    // re-checked against a local snapshot rather than the live field.
    const pin = this.pinning;
    if (pin) {
      const by = this.get(pin.by);
      const victim = this.get(other(pin.by));
      const rate =
        (1 / PIN_HOLD_TIME) *
        (0.7 + by.cfg.attributes.strength / 160) *
        (victim.downedTimer > 0 ? 1.25 : 0.85) *
        (1 - victim.cfg.attributes.defense / 320);
      pin.progress = clamp01(pin.progress + rate * dt);
      this.emit({ t: 'pin_attempt', side: pin.by, progress: pin.progress });

      if (victim.side === 'opponent') this.ai.struggle(dt);

      // Only finish if the hold survived the struggle.
      if (this.pinning === pin && pin.progress >= 1) {
        this.finish({ type: 'pin', winner: pin.by });
        return;
      }
    }

    const sub = this.submitting;
    if (sub) {
      const by = this.get(sub.by);
      const victim = this.get(other(sub.by));
      const tight =
        (1 / SUB_HOLD_TIME) *
        (0.65 + by.cfg.attributes.technique / 150) *
        (1 + by.cfg.passives.submissionPower * 0.5) *
        (1 - victim.cfg.attributes.defense / 300) *
        (victim.stamina < victim.maxStamina * 0.25 ? 1.4 : 1.0);
      sub.progress = clamp01(sub.progress + tight * dt);
      this.emit({ t: 'submission_attempt', side: sub.by, progress: sub.progress });

      if (victim.side === 'opponent') this.ai.struggle(dt);

      if (this.submitting === sub && sub.progress >= 1) {
        this.finish({ type: 'submission', winner: sub.by });
      }
    }
  }

  private updatePositions(dt: number): void {
    const p = this.player;
    const o = this.opponent;

    if (this.stance === 'standing') {
      if (p.phase === 'idle' || p.phase === 'blocking') {
        const sp = 1.9 + p.cfg.attributes.speed / 99 * 1.5;
        p.x += this.pendingWalk.dx * sp * dt;
        p.z += this.pendingWalk.dz * sp * dt;
      }
    }
    this.pendingWalk.dx *= 0.85;
    this.pendingWalk.dz *= 0.85;

    // Keep both on the mat.
    for (const f of [p, o]) {
      const d = Math.hypot(f.x, f.z);
      if (d > MAT_RADIUS) {
        f.x = (f.x / d) * MAT_RADIUS;
        f.z = (f.z / d) * MAT_RADIUS;
      }
    }

    // Opponent closes distance / holds spacing depending on stance.
    const target = this.stance === 'standing' ? 1.85 : this.stance === 'clinch' ? 0.85 : 0.7;
    const dx = o.x - p.x;
    const dz = o.z - p.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const nx = dx / dist;
    const nz = dz / dist;
    const err = dist - target;
    const closeSpeed = (this.stance === 'standing' ? 1.6 : 3.2) * dt;
    const adj = clamp(err, -closeSpeed, closeSpeed);
    o.x -= nx * adj * 0.6;
    o.z -= nz * adj * 0.6;
    p.x += nx * adj * 0.4;
    p.z += nz * adj * 0.4;

    p.facing = Math.atan2(o.x - p.x, o.z - p.z);
    o.facing = Math.atan2(p.x - o.x, p.z - o.z);
  }

  private bumpCrowd(amount: number): void {
    this.crowdIntensity = clamp01(this.crowdIntensity + amount * (0.4 + this.cfg.arenaCrowd * 0.6));
    this.emit({ t: 'crowd', intensity: this.crowdIntensity });
  }

  private endRound(): void {
    this.emit({ t: 'round_end', round: this.round });
    if (this.round >= this.cfg.rounds) {
      const ps = this.player.score;
      const os = this.opponent.score;
      this.finish({ type: 'points', winner: ps === os ? 'draw' : ps > os ? 'player' : 'opponent' });
      return;
    }
    this.round++;
    this.intermission = 2.6;
  }

  private startRound(): void {
    this.roundTime = this.cfg.roundSeconds;
    this.setStance('standing');
    this.pinning = null;
    this.submitting = null;
    for (const f of [this.player, this.opponent]) {
      f.phase = 'idle';
      f.move = null;
      f.phaseTime = 0;
      f.combo = 0;
      f.downedTimer = 0;
      f.counterWindow = 0;
      // Partial recovery between rounds.
      f.stamina = clamp(f.stamina + f.maxStamina * 0.4, 0, f.maxStamina * (1 - f.fatigue * 0.35));
      f.health = Math.min(f.maxHealth, f.health + f.maxHealth * 0.06);
    }
    this.emit({ t: 'round_start', round: this.round });
    this.emit({ t: 'second_wind', side: 'player' });
  }

  private checkFinish(): void {
    if (this.finished) return;
    if (this.player.health <= 0) this.finish({ type: 'knockout', winner: 'opponent' });
    else if (this.opponent.health <= 0) this.finish({ type: 'knockout', winner: 'player' });
  }

  private finish(outcome: MatchResult['outcome']): void {
    if (this.finished) return;
    this.finished = true;
    this.result = {
      outcome,
      playerScore: this.player.score,
      opponentScore: this.opponent.score,
      rounds: this.round,
      duration: this.elapsed,
      stats: { ...this.stats },
    };
    this.crowdIntensity = 1;
    this.emit({ t: 'match_end', result: this.result });
  }

  /** Force-end the match (player retired / quit). */
  retire(): void {
    this.finish({ type: 'retired', winner: 'opponent' });
  }
}

export { MAT_RADIUS, MAX_MOMENTUM };
export const styleOf = (cfg: FighterConfig) => STYLES[cfg.style];
