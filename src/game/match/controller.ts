import { audio } from '../../engine/audio';
import type { GameRenderer } from '../../engine/renderer';
import type { InputManager } from '../../engine/input';
import { MatchSim } from '../sim/combat';
import type { MatchConfig, MatchResult, SimEvent, Side } from '../sim/types';
import { getMove } from '../data/moves';
import { clamp01 } from '../../core/math';

export interface MatchCallbacks {
  onEvent?: (e: SimEvent) => void;
  onEnd?: (result: MatchResult) => void;
  onTick?: (sim: MatchSim, dt: number) => void;
}

const FIXED_STEP = 1 / 60;

/**
 * Glue between the deterministic sim and the presentation layers.
 * Runs the sim on a fixed 60Hz accumulator regardless of render rate, so
 * gameplay feels identical on a 30fps budget phone and a 120Hz flagship.
 */
export class MatchController {
  readonly sim: MatchSim;
  private renderer: GameRenderer;
  private input: InputManager;
  private cbs: MatchCallbacks;
  private accumulator = 0;
  private commentaryCooldown = 0;
  private lastCommentaryEvent = '';
  private unsubs: Array<() => void> = [];
  private ended = false;
  private introTimer = 0;
  private names: Record<Side, string>;
  private crowdSyncTimer = 0;
  private footstepTimer = 0;

  constructor(
    cfg: MatchConfig,
    renderer: GameRenderer,
    input: InputManager,
    cbs: MatchCallbacks = {},
  ) {
    this.renderer = renderer;
    this.input = input;
    this.cbs = cbs;
    this.names = { player: cfg.player.shortName, opponent: cfg.opponent.shortName };
    this.sim = new MatchSim(cfg, { onEvent: (e) => this.handleEvent(e) });
    this.bindInput();
  }

  /** Cinematic intro before the bell. Returns seconds it will take. */
  startIntro(seconds = 3.4): number {
    audio.playMusic('match');
    // A zero/negative intro must start the match immediately, otherwise the
    // sim would stay paused forever waiting for a timer that never ticks.
    if (seconds <= 0) {
      this.introTimer = 0;
      this.beginMatch();
      return 0;
    }
    this.introTimer = seconds;
    this.sim.paused = true;
    this.renderer.setCameraMode('cinematic_intro');
    return seconds;
  }

  private beginMatch(): void {
    this.sim.paused = false;
    this.renderer.setCameraMode('broadcast');
    audio.play('bell', { volume: 1 });
    audio.crowdPop(0.7);
    this.say(`Here we go! ${this.names.player} versus ${this.names.opponent}!`, true);
  }

  // ----------------------------------------------------------------- input

  private bindInput(): void {
    this.unsubs.push(
      this.input.bus.on('action', ({ id }) => this.action(id)),
      this.input.bus.on('gesture', ({ name, power }) => this.gesture(name, power)),
    );
    this.input.enable();
  }

  action(id: string): void {
    if (this.sim.finished || this.sim.paused) return;
    switch (id) {
      case 'guard_on':
        this.sim.command({ c: 'guard', on: true });
        break;
      case 'guard_off':
        this.sim.command({ c: 'guard', on: false });
        break;
      case 'reverse': {
        const ok = this.sim.command({ c: 'reverse' });
        if (!ok) audio.play('ui_error', { volume: 0.35 });
        break;
      }
      case 'escape':
        if (!this.sim.command({ c: 'escape' })) audio.play('ui_error', { volume: 0.35 });
        break;
      case 'pin':
        if (!this.sim.command({ c: 'pin' })) audio.play('ui_error', { volume: 0.35 });
        break;
      case 'taunt':
        this.sim.command({ c: 'taunt' });
        break;
      default:
        if (id.startsWith('move:')) {
          const moveId = id.slice(5);
          const check = this.sim.canStart('player', moveId);
          if (check.ok) {
            this.sim.command({ c: 'move', moveId });
          } else {
            audio.play('ui_error', { volume: 0.4 });
            this.cbs.onEvent?.({ t: 'move_miss', side: 'player', move: getMove(moveId) });
          }
        }
    }
  }

  /** Gesture-based controls mapped to contextual actions. */
  private gesture(name: string, power: number): void {
    if (this.sim.finished || this.sim.paused) return;
    const stance = this.sim.stance;
    const moves = this.sim.player.cfg.moves
      .map((id) => getMove(id))
      .filter((m) => m.range === stance);

    const pick = (cats: string[]): string | null => {
      // Prefer the strongest available move of the requested categories.
      const opts = moves
        .filter((m) => cats.includes(m.category))
        .filter((m) => this.sim.canStart('player', m.id).ok)
        .sort((a, b) => b.damage - a.damage);
      return opts[0]?.id ?? null;
    };

    switch (name) {
      case 'tap': {
        const id = pick(['strike', 'grapple']);
        if (id) this.sim.command({ c: 'move', moveId: id });
        break;
      }
      case 'swipe_up': {
        const id = pick(['throw', 'signature']);
        if (id) this.sim.command({ c: 'move', moveId: id });
        else audio.play('ui_error', { volume: 0.3 });
        break;
      }
      case 'swipe_down': {
        const id = pick(['takedown', 'submission']);
        if (id) this.sim.command({ c: 'move', moveId: id });
        break;
      }
      case 'swipe_left':
      case 'swipe_right': {
        // Strong swipe = grapple, weak = escape/reposition.
        if (power > 0.6) {
          const id = pick(['grapple', 'takedown']);
          if (id) this.sim.command({ c: 'move', moveId: id });
        } else {
          this.sim.command({ c: 'escape' });
        }
        break;
      }
      case 'circle':
        this.sim.command({ c: 'reverse' });
        break;
      case 'double_tap': {
        const fin = moves.find(
          (m) => m.category === 'finisher' && this.sim.canStart('player', m.id).ok,
        );
        if (fin) this.sim.command({ c: 'move', moveId: fin.id });
        else this.sim.command({ c: 'taunt' });
        break;
      }
      case 'hold_start':
        this.sim.command({ c: 'guard', on: true });
        break;
      case 'hold_end':
        this.sim.command({ c: 'guard', on: false });
        break;
    }
  }

  // ---------------------------------------------------------------- update

  update(dtRaw: number): void {
    if (this.introTimer > 0) {
      this.introTimer -= dtRaw;
      if (this.introTimer <= 0) this.beginMatch();
    }

    // Movement from the virtual stick.
    if (this.input.stick.active && !this.sim.paused && !this.sim.finished) {
      this.sim.command({ c: 'walk', dx: this.input.stick.x, dz: this.input.stick.y });
      this.footstepTimer -= dtRaw;
      if (this.footstepTimer <= 0 && Math.hypot(this.input.stick.x, this.input.stick.y) > 0.4) {
        this.footstepTimer = 0.34;
        audio.play('footstep', { volume: 0.5, pitch: 0.9 + Math.random() * 0.25 });
      }
    }

    // Fixed-step simulation.
    const scaled = dtRaw * this.renderer.timeScaleValue;
    this.accumulator += Math.min(scaled, 0.2);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < 6) {
      this.sim.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps++;
    }

    // Crowd audio follows sim intensity.
    this.crowdSyncTimer -= dtRaw;
    if (this.crowdSyncTimer <= 0) {
      this.crowdSyncTimer = 0.2;
      audio.setCrowd(this.sim.crowd);
    }

    this.commentaryCooldown = Math.max(0, this.commentaryCooldown - dtRaw);

    this.cbs.onTick?.(this.sim, dtRaw);
    this.renderer.render(
      dtRaw,
      { player: this.sim.player, opponent: this.sim.opponent },
      this.sim.crowd,
    );
  }

  // ---------------------------------------------------------------- events

  private handleEvent(e: SimEvent): void {
    switch (e.t) {
      case 'move_start': {
        const heavy = e.move.damage > 18;
        audio.play(heavy ? 'whoosh' : 'grapple', { volume: heavy ? 0.6 : 0.35 });
        if (e.move.category === 'finisher') {
          this.renderer.setCameraMode('finisher', 2.2);
          this.renderer.slowmo(1.1, 0.4);
          audio.play('finisher_charge', { volume: 0.8 });
          audio.crowdPop(1);
          this.say(`${this.names[e.side]} is going for the finish!`, true);
        } else if (e.move.category === 'signature') {
          this.renderer.setCameraMode('closeup', 1.4);
          audio.crowdPop(0.6);
        }
        break;
      }

      case 'move_hit': {
        const m = e.move;
        const impact = m.impact * (e.critical ? 1.35 : 1);
        this.renderer.impact(
          e.side === 'player' ? 'opponent' : 'player',
          impact,
          e.critical ? 0xffd24a : 0xfff0c0,
        );
        this.renderer.showDamage(e.side === 'player' ? 'opponent' : 'player', e.damage, e.critical);

        if (m.category === 'throw' || m.category === 'finisher') audio.play('slam', { volume: 1 });
        else if (m.impact > 0.6) audio.play('hit_heavy', { volume: 0.9 });
        else if (m.impact > 0.3) audio.play('hit_medium', { volume: 0.8 });
        else audio.play('hit_light', { volume: 0.7 });

        audio.crowdPop(clamp01(m.impact * 0.55 + (e.critical ? 0.3 : 0)));
        if (e.side === 'player') this.input.haptic(Math.round(10 + m.impact * 26));

        if (e.combo >= 3) this.say(`${e.combo} move chain from ${this.names[e.side]}!`);
        else if (m.category === 'throw') this.say(`What a ${m.name.toLowerCase()}!`);
        else if (e.critical) this.say('Oh, that one hurt!');
        break;
      }

      case 'move_miss':
        audio.play('whoosh', { volume: 0.4 });
        break;

      case 'move_blocked':
        audio.play('block', { volume: 0.6 });
        this.renderer.impact(e.side === 'player' ? 'opponent' : 'player', 0.2, 0x9fd8ff);
        break;

      case 'reversal': {
        audio.play('reversal', { volume: 0.95 });
        audio.crowdPop(e.perfect ? 0.95 : 0.7);
        this.renderer.setCameraMode('closeup', 1.5);
        this.renderer.impact(e.side === 'player' ? 'opponent' : 'player', 0.9, 0x38bdf8);
        if (e.side === 'player') {
          this.input.haptic([12, 26, 12]);
          this.renderer.slowmo(0.55, 0.5);
        }
        this.say(
          e.perfect
            ? `Perfect counter by ${this.names[e.side]}! Textbook!`
            : `Reversed! ${this.names[e.side]} turns it around!`,
          true,
        );
        break;
      }

      case 'counter_window':
        if (e.side === 'player') this.input.haptic(6);
        break;

      case 'knockdown':
        audio.play('slam', { volume: 0.85 });
        this.renderer.setCameraMode('ground', 1.8);
        audio.crowdPop(0.75);
        break;

      case 'stance_change':
        if (e.stance === 'ground') this.renderer.setCameraMode('ground', 2.5);
        break;

      case 'score':
        if (e.points >= 4) {
          audio.crowdPop(0.8);
          this.say(`${e.points} points! ${e.reason}!`);
        }
        break;

      case 'submission_attempt':
        if (e.progress > 0.5 && e.progress < 0.56) {
          audio.play('submission', { volume: 0.7 });
          this.say(`This could be it! Is ${this.names[e.side === 'player' ? 'opponent' : 'player']} going to tap?`, true);
        }
        break;

      case 'pin_attempt':
        if (e.progress > 0.35 && e.progress < 0.42) {
          audio.crowdPop(0.85);
          this.say('Shoulders are down! One... two...!', true);
        }
        break;

      case 'pin_broken':
      case 'submission_broken':
        audio.crowdPop(0.8);
        audio.play('breath', { volume: 0.7 });
        this.say('Escaped! Incredible heart!', true);
        break;

      case 'momentum_full':
        if (e.side === 'player') {
          audio.play('finisher_charge', { volume: 0.55 });
          this.input.haptic([20, 40, 20, 40]);
        }
        break;

      case 'exhausted':
        audio.play('breath', { volume: 0.8 });
        this.say(`${this.names[e.side]} is running on empty out there.`);
        break;

      case 'round_end':
        audio.play('bell', { volume: 0.9 });
        audio.play('whistle', { volume: 0.6 });
        break;

      case 'round_start':
        if (e.round > 1) {
          audio.play('bell', { volume: 0.9 });
          this.say(`Round ${e.round}. Let's go!`, true);
        }
        break;

      case 'taunt':
        audio.crowdPop(0.5);
        break;

      case 'match_end':
        this.finish(e.result);
        break;
    }

    this.cbs.onEvent?.(e);
  }

  private finish(result: MatchResult): void {
    if (this.ended) return;
    this.ended = true;
    const playerWon = 'winner' in result.outcome && result.outcome.winner === 'player';

    audio.play('bell', { volume: 1 });
    audio.crowdPop(1);
    audio.stopMusic();
    this.renderer.setCameraMode('victory');
    if (playerWon) {
      this.renderer.celebrate();
      this.renderer.playClip('player', 'celebrate');
      this.renderer.playClip('opponent', 'down');
      audio.play('victory', { volume: 1 });
      audio.playMusic('victory');
      this.input.haptic([40, 60, 40, 60, 80]);
      this.say(
        `${this.names.player} wins it! What a performance here tonight!`,
        true,
      );
    } else {
      this.renderer.playClip('opponent', 'celebrate');
      this.renderer.playClip('player', 'down');
      audio.play('defeat', { volume: 0.9 });
      this.say(`${this.names.opponent} takes it. Back to the gym.`, true);
    }

    this.input.disable();
    this.cbs.onEnd?.(result);
  }

  private say(line: string, priority = false): void {
    if (this.commentaryCooldown > 0 && !priority) return;
    if (line === this.lastCommentaryEvent) return;
    this.lastCommentaryEvent = line;
    this.commentaryCooldown = priority ? 1.5 : 4;
    audio.say(line, priority);
  }

  retire(): void {
    this.sim.retire();
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.input.disable();
    audio.stopCommentary();
    audio.setCrowd(0);
  }
}
