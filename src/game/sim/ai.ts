import { clamp, clamp01 } from '../../core/math';
import { getMove, type MoveDef } from '../data/moves';
import { STYLES } from '../data/styles';
import type { MatchSim } from './combat';

interface PlayerModel {
  /** Rolling frequency the player uses each move category. */
  categoryUse: Record<string, number>;
  /** How often the player guards. */
  guardRate: number;
  /** How often the player successfully reverses us. */
  reversalRate: number;
  /** How aggressive the player is (moves per second). */
  tempo: number;
  samples: number;
}

/**
 * Adaptive opponent AI.
 *
 * Three layers:
 *  1. Style personality (power / technical / speed) — fixed preferences.
 *  2. Situational tactics — reacts to stamina, health, score, stance, momentum.
 *  3. Adaptation — builds a model of the player's habits and counters them.
 */
export class AiBrain {
  private sim: MatchSim;
  private difficulty: number;
  private thinkTimer = 0;
  private model: PlayerModel = {
    categoryUse: {},
    guardRate: 0,
    reversalRate: 0,
    tempo: 0,
    samples: 0,
  };
  private lastPlayerMoveTime = 0;
  private struggleAccum = 0;
  private feintCooldown = 0;

  constructor(sim: MatchSim, difficulty: number) {
    this.sim = sim;
    this.difficulty = clamp01(difficulty);
  }

  private get style() {
    return STYLES[this.sim.opponent.cfg.style].ai;
  }

  /** Called by the sim when the player commits a move (observation hook). */
  observePlayerMove(move: MoveDef, elapsed: number): void {
    const m = this.model;
    m.categoryUse[move.category] = (m.categoryUse[move.category] ?? 0) * 0.88 + 1;
    const dt = elapsed - this.lastPlayerMoveTime;
    this.lastPlayerMoveTime = elapsed;
    if (dt > 0 && dt < 20) m.tempo = m.tempo * 0.8 + (1 / dt) * 0.2;
    m.samples++;
  }

  observePlayerGuard(on: boolean): void {
    this.model.guardRate = this.model.guardRate * 0.9 + (on ? 0.1 : 0);
  }

  observePlayerReversal(): void {
    this.model.reversalRate = clamp01(this.model.reversalRate * 0.85 + 0.15);
  }

  /** Auto-struggle when caught in a pin or submission. */
  struggle(dt: number): void {
    this.struggleAccum += dt;
    const interval = 0.34 - this.difficulty * 0.14;
    if (this.struggleAccum < interval) return;
    this.struggleAccum = 0;
    this.sim.tryEscape('opponent');
  }

  update(dt: number): void {
    const sim = this.sim;
    const me = sim.opponent;
    const foe = sim.player;
    if (sim.finished || sim.intermission > 0) return;

    this.feintCooldown = Math.max(0, this.feintCooldown - dt);

    // --- Reaction layer: attempt reversals inside the counter window.
    if (me.counterWindow > 0 && foe.move) {
      // Reaction delay scales with difficulty: weak AI often misses the window.
      const reactChance = (0.18 + this.difficulty * 0.72) * this.style.patience * 1.3;
      if (sim.rng.chance(reactChance * dt * 9)) {
        const reversed = sim.tryReversal('opponent');
        if (reversed) return;
      }
    }

    // --- Escape layer: get out of bad spots.
    if (sim.stance === 'ground' && sim.submitting?.by === 'player') {
      this.struggle(dt);
      return;
    }
    if (me.phase !== 'idle' && me.phase !== 'blocking') return;
    if (me.downedTimer > 0) return;

    this.thinkTimer -= dt;
    if (this.thinkTimer > 0) return;
    // Higher difficulty = faster decision cadence.
    this.thinkTimer = clamp(0.62 - this.difficulty * 0.4, 0.16, 0.7) * sim.rng.range(0.8, 1.25);

    const healthRatio = me.health / me.maxHealth;
    const stamRatio = me.stamina / me.maxStamina;
    const scoreDelta = me.score - foe.score;

    // --- Defensive posture: gas low or badly hurt -> guard and recover.
    // Smarter opponents defend their stamina far more deliberately; this is
    // what stops a well-conditioned player from simply out-lasting every AI.
    const gasThreshold = 0.2 + this.difficulty * 0.16;
    const wantGuard =
      (stamRatio < gasThreshold && sim.rng.chance(0.55 + this.difficulty * 0.4)) ||
      (healthRatio < 0.25 && scoreDelta > 0 && sim.rng.chance(0.5)) ||
      (this.model.tempo > 0.8 && sim.rng.chance(0.25 * this.style.patience));
    if (wantGuard) {
      me.guarding = true;
      me.phase = 'blocking';
      // Hold the shell long enough to actually bank stamina back.
      const recover = 0.4 + this.difficulty * 0.7;
      this.thinkTimer = sim.rng.range(recover, recover + 0.8);
      return;
    }
    me.guarding = false;
    if (me.phase === 'blocking') me.phase = 'idle';

    // --- Escape ground/clinch if losing the position badly.
    if (sim.stance === 'ground' && healthRatio < 0.4 && sim.rng.chance(0.35)) {
      if (sim.tryEscape('opponent')) return;
    }

    // --- Offense: score every legal move and pick weighted-best.
    const candidates = me.cfg.moves
      .map((id) => getMove(id))
      .filter((m) => sim.canStart('opponent', m.id).ok);

    if (candidates.length === 0) {
      // Nothing available in this range — change the range.
      if (sim.stance !== 'standing') sim.tryEscape('opponent');
      return;
    }

    // Pin attempt when the player is helpless.
    if (
      sim.stance === 'ground' &&
      (foe.downedTimer > 0 || foe.health < foe.maxHealth * 0.5) &&
      !sim.pinning &&
      !sim.submitting &&
      sim.rng.chance(0.35 + this.difficulty * 0.4)
    ) {
      if (sim.tryPin('opponent')) return;
    }

    let best: MoveDef | null = null;
    let bestScore = -Infinity;

    for (const m of candidates) {
      let s = 1;

      // 1. Style preference.
      s *= this.style.prefer[m.category] ?? 1;

      // 2. Efficiency: damage per stamina, weighted by remaining gas.
      // Good opponents value efficiency; weak ones swing for the fences.
      const eff = m.damage / Math.max(1, m.staminaCost);
      const effWeight = 0.35 + this.difficulty * 0.75;
      s *= 0.6 + eff * effWeight * (stamRatio > 0.5 ? 1 : stamRatio * 1.5);

      // Never spend the last of the tank on an expensive move.
      if (m.staminaCost > me.stamina * 0.6) s *= 0.25 + (1 - this.difficulty) * 0.6;

      // 3. Finishers/signatures when available are strongly favoured.
      if (m.category === 'finisher') s *= 6;
      else if (m.category === 'signature') s *= 3;

      // 4. Adaptation: if the player reverses a lot, prefer high reversalResist.
      const adapt = this.style.adaptivity * this.difficulty;
      s *= 1 + this.model.reversalRate * adapt * (m.reversalResist - 0.5) * 2.4;

      // 5. If the player guards a lot, prefer grapples/takedowns over strikes.
      if (this.model.guardRate > 0.25) {
        if (m.category === 'strike') s *= 1 - adapt * 0.5;
        else s *= 1 + adapt * 0.3;
      }

      // 6. Situational: behind on points -> chase high-scoring throws.
      if (scoreDelta < 0 && sim.roundTime < 35) {
        if (m.category === 'throw' || m.category === 'signature') s *= 1.9;
      }
      // Ahead on points and clock winding down -> play safe, low-risk moves.
      if (scoreDelta > 3 && sim.roundTime < 25) {
        s *= m.staminaCost < 10 ? 1.5 : 0.5;
      }

      // 7. Aggression / burst personality.
      s *= 1 + (this.style.aggression - 0.5) * (m.damage / 30);
      if (m.staminaCost > me.stamina * 0.5) s *= this.style.burst;

      // 8. Avoid repeating the exact same move (readable AI is boring).
      if (me.lastMoveId === m.id) s *= 0.45;

      // 9. Low-difficulty AI makes worse choices on purpose.
      s *= sim.rng.range(1 - (1 - this.difficulty) * 0.8, 1 + (1 - this.difficulty) * 0.8);

      if (s > bestScore) {
        bestScore = s;
        best = m;
      }
    }

    if (!best) return;

    // Weak AI sometimes just... hesitates.
    if (sim.rng.chance((1 - this.difficulty) * 0.28)) {
      this.thinkTimer += sim.rng.range(0.2, 0.6);
      return;
    }

    me.lastMoveId = best.id;
    sim.startMove('opponent', best.id);
  }
}
