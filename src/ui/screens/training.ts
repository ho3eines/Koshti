import { audio } from '../../engine/audio';
import type { App } from '../../game/app';
import { emptyPassives, accumulatePassives } from '../../game/data/skills';
import { STARTER_MOVES, hasMove, resolveUnlockToMoveId } from '../../game/data/moves';
import {
  stageUnlocked,
  starsForTime,
  STAGE_BY_ID,
  TRAINING_STAGES,
  type TrainingObjective,
  type TrainingStage,
} from '../../game/career/training';
import { applyXp } from '../../game/career/progression';
import type { FighterConfig, MatchConfig, SimEvent } from '../../game/sim/types';
import { el, stars } from '../dom';
import { toast } from '../toast';
import type { MatchScreenParams } from './match';
import type { MatchSim } from '../../game/sim/combat';
import { ATTRIBUTE_CAP } from '../../game/data/attributes';

/** Training hall — stage select and the interactive drill runner. */
export const renderTraining = (app: App, params?: Record<string, unknown>): void => {
  const save = app.requireSave();
  const firstTime = Boolean(params?.firstTime);
  audio.playMusic('menu');

  const screen = el('div', { class: 'screen overlay-bg' });
  screen.appendChild(
    el('div', { class: 'topbar' }, [
      el('button', { class: 'icon-btn', onclick: () => { audio.play('ui_back'); app.go('hub'); } }, [
        document.createTextNode('‹'),
      ]),
      el('h1', {}, [
        document.createTextNode('TRAINING HALL'),
        el('span', {
          class: 'sub',
          text: `${save.training.completed.length} / ${TRAINING_STAGES.length} stages complete`,
        }),
      ]),
    ]),
  );

  const body = el('div', { class: 'screen-body' });

  if (firstTime) {
    body.appendChild(
      el('div', { class: 'card', style: 'border-color:rgba(74,222,128,.4)' }, [
        el('div', { class: 'card-accent', style: 'background:var(--green)' }),
        el('div', { class: 'card-title', text: `Welcome to the mat, ${save.profile.name}.` }),
        el('p', {
          class: 'card-sub',
          text: 'Coach will take you through six stages. Finish them and you will be ready for the Amateur Circuit — plus you will earn skill points and unlock new moves along the way.',
        }),
      ]),
    );
  }

  body.appendChild(el('div', { class: 'section-label', text: 'Stages' }));

  for (const stage of TRAINING_STAGES) {
    const unlocked = stageUnlocked(stage, save.training.completed);
    const done = save.training.completed.includes(stage.id);
    const starCount = save.training.stars[stage.id] ?? 0;

    const card = el(
      'div',
      { class: `card ${unlocked ? 'interactive' : 'locked'}` },
      [
        el('div', {
          class: 'card-accent',
          style: `background:${done ? 'var(--green)' : unlocked ? 'var(--accent)' : 'var(--text-faint)'}`,
        }),
        el('div', { class: 'row' }, [
          el('div', {
            style: `width:42px;height:42px;flex-shrink:0;border-radius:12px;display:grid;place-items:center;font-size:21px;background:rgba(0,0,0,.3);border:1px solid var(--line)`,
            text: stage.icon,
          }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'card-title', text: `${stage.index + 1}. ${stage.name}` }),
            el('p', { class: 'card-sub', text: stage.subtitle }),
            done
              ? el('div', { class: 'stars', style: 'margin-top:3px', html: stars(starCount) })
              : null,
          ]),
          done
            ? el('span', { class: 'badge done', text: 'DONE' })
            : unlocked
              ? el('span', { style: 'color:var(--text-faint);font-size:18px', text: '›' })
              : el('span', { class: 'badge locked', text: '🔒' }),
        ]),
      ],
    );

    if (unlocked) {
      card.addEventListener('click', () => {
        audio.play('ui_tap');
        showStageBrief(app, stage);
      });
    }
    body.appendChild(card);
  }

  screen.appendChild(body);
  app.mount(screen);
};

// ------------------------------------------------------------------- brief

const showStageBrief = (app: App, stage: TrainingStage): void => {
  const save = app.requireSave();
  const done = save.training.completed.includes(stage.id);
  const backdrop = el('div', { class: 'modal-backdrop' });

  const objList = el('div');
  for (const o of stage.objectives) {
    objList.appendChild(
      el('div', { class: 'row', style: 'gap:8px;padding:6px 0;align-items:flex-start' }, [
        el('span', { style: 'color:var(--green);font-size:13px', text: '◆' }),
        el('div', { class: 'grow' }, [
          el('div', { style: 'font-size:12.5px;font-weight:700', text: o.label }),
          el('div', { class: 'tiny', text: o.hint }),
        ]),
      ]),
    );
  }

  const r = stage.rewards;
  const rewardText = [
    `${r.xp} XP`,
    `${r.coins} coins`,
    `${r.skillPoints} SP`,
    r.attribute ? `+${r.attribute.amount} ${r.attribute.key}` : null,
    r.unlocksMove ? 'new move' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  backdrop.appendChild(
    el('div', { class: 'modal' }, [
      el('h2', { text: stage.name }),
      el('p', { text: stage.brief }),
      el('div', { class: 'section-label', style: 'margin-top:0', text: 'Objectives' }),
      objList,
      el('div', { class: 'divider' }),
      el('div', { class: 'row between' }, [
        el('span', { class: 'tiny', text: 'Rewards' }),
        el('span', { style: 'font-size:12px;font-weight:800;color:var(--gold)', text: rewardText }),
      ]),
      stage.timeLimit > 0
        ? el('div', { class: 'row between', style: 'margin-top:6px' }, [
            el('span', { class: 'tiny', text: 'Time limit' }),
            el('span', { style: 'font-size:12px;font-weight:800', text: `${stage.timeLimit}s` }),
          ])
        : null,
      el('div', { class: 'btn-row', style: 'margin-top:16px' }, [
        el('button', { class: 'btn secondary', onclick: () => { audio.play('ui_back'); backdrop.remove(); } }, [
          document.createTextNode('Back'),
        ]),
        el(
          'button',
          {
            class: 'btn',
            onclick: () => {
              audio.play('ui_confirm');
              backdrop.remove();
              startStage(app, stage);
            },
          },
          [document.createTextNode(done ? 'Replay' : 'Start')],
        ),
      ]),
    ]),
  );
  app.mount(backdrop);
};

// ------------------------------------------------------- objective tracking

interface ObjectiveProgress {
  obj: TrainingObjective;
  value: number;
  complete: boolean;
}

class ObjectiveTracker {
  readonly items: ObjectiveProgress[];
  private guardTime = 0;
  private surviveTime = 0;
  private walkDistance = 0;
  onChange?: () => void;
  onComplete?: () => void;

  constructor(objectives: readonly TrainingObjective[]) {
    this.items = objectives.map((obj) => ({ obj, value: 0, complete: false }));
  }

  get current(): ObjectiveProgress | null {
    return this.items.find((i) => !i.complete) ?? null;
  }

  get allDone(): boolean {
    return this.items.every((i) => i.complete);
  }

  private bump(kind: string, amount = 1, arg?: string): void {
    const item = this.items.find(
      (i) => !i.complete && i.obj.kind === kind && (i.obj.arg === undefined || i.obj.arg === arg),
    );
    if (!item) return;
    item.value = Math.min(item.obj.target, item.value + amount);
    if (item.value >= item.obj.target) {
      item.complete = true;
      audio.play('unlock', { volume: 0.7 });
      toast.show(`✓ ${item.obj.label}`, 'green', 2000);
      if (this.allDone) this.onComplete?.();
    }
    this.onChange?.();
  }

  /** Continuous trackers driven from the frame loop. */
  tickGuard(dt: number, guarding: boolean): void {
    if (!guarding) return;
    this.guardTime += dt;
    const item = this.items.find((i) => !i.complete && i.obj.kind === 'guard');
    if (item && this.guardTime >= item.obj.target) this.bump('guard', item.obj.target);
    else if (item) {
      item.value = Math.floor(this.guardTime);
      this.onChange?.();
    }
  }

  tickSurvive(dt: number): void {
    const item = this.items.find((i) => !i.complete && i.obj.kind === 'survive');
    if (!item) return;
    this.surviveTime += dt;
    if (this.surviveTime >= item.obj.target) this.bump('survive', item.obj.target);
    else {
      item.value = Math.floor(this.surviveTime);
      this.onChange?.();
    }
  }

  tickWalk(dt: number, speed: number): void {
    const item = this.items.find((i) => !i.complete && i.obj.kind === 'walk');
    if (!item || speed < 0.15) return;
    this.walkDistance += speed * dt * 2.4;
    if (this.walkDistance >= item.obj.target) this.bump('walk', item.obj.target);
    else {
      item.value = Math.floor(this.walkDistance);
      this.onChange?.();
    }
  }

  handle(e: SimEvent): void {
    switch (e.t) {
      case 'move_hit':
        if (e.side !== 'player') return;
        this.bump('move_category', 1, e.move.category);
        this.bump('move_specific', 1, e.move.id);
        if (e.move.category === 'takedown' || e.move.category === 'throw') {
          this.bump('takedown_count', 1);
        }
        if (e.combo >= 1) {
          const item = this.items.find((i) => !i.complete && i.obj.kind === 'combo');
          if (item) {
            item.value = Math.max(item.value, e.combo);
            if (item.value >= item.obj.target) this.bump('combo', item.obj.target);
            else this.onChange?.();
          }
        }
        break;
      case 'reversal':
        if (e.side === 'player') this.bump('reverse', 1);
        break;
      case 'stance_change':
        this.bump('stance', 1, e.stance);
        break;
      case 'match_end':
        if ('winner' in e.result.outcome && e.result.outcome.winner === 'player') {
          this.bump('finish', 1);
        }
        break;
    }
  }
}

// -------------------------------------------------------------- run a stage

const startStage = (app: App, stage: TrainingStage): void => {
  const save = app.requireSave();
  const p = save.profile;

  const playerCfg: FighterConfig = {
    id: 'player',
    name: p.name,
    shortName: p.name.split(' ')[0],
    attributes: p.attributes,
    style: p.style,
    moves: (p.unlockedMoves.filter(hasMove).length
      ? p.unlockedMoves.filter(hasMove)
      : [...STARTER_MOVES]),
    passives: accumulatePassives(p.unlockedSkills),
    tint: p.tint,
    trunks: p.trunks,
    clubId: p.clubId ?? undefined,
  };

  // The coach: scales with the player so drills stay teachable, never brutal.
  const coachAttr = { ...p.attributes };
  for (const k of Object.keys(coachAttr) as Array<keyof typeof coachAttr>) {
    coachAttr[k] = Math.min(ATTRIBUTE_CAP, Math.round(coachAttr[k] * 0.85));
  }
  const coachCfg: FighterConfig = {
    id: 'coach',
    name: 'Coach Bekzat',
    shortName: 'Coach',
    attributes: coachAttr,
    style: 'allround',
    moves: ['jab_setup', 'collar_elbow', 'double_leg', 'underhook', 'half_nelson', 'hip_toss'],
    passives: emptyPassives(),
    difficulty: stage.dummyAggression,
    tint: 0x475569,
    trunks: 0x1f2937,
  };

  const config: MatchConfig = {
    format: 'exhibition',
    rounds: 1,
    roundSeconds: stage.timeLimit > 0 ? stage.timeLimit : 600,
    arenaCrowd: 0.05,
    seed: Date.now() >>> 0,
    player: playerCfg,
    opponent: coachCfg,
    difficulty: stage.dummyAggression,
    title: stage.name.toUpperCase(),
    subtitle: 'TRAINING DRILL',
  };

  const tracker = new ObjectiveTracker(stage.objectives);
  let elapsed = 0;
  let completed = false;
  let card: HTMLElement | null = null;

  const buildCard = (): HTMLElement => {
    const cur = tracker.current;
    const node = el('div', { class: 'tutorial-card' });
    if (!cur) {
      node.appendChild(el('div', { class: 'obj' }, [el('span', { text: '✓ Drill complete!' })]));
      node.appendChild(el('div', { class: 'hint', text: 'Great work. Wrapping up…' }));
      return node;
    }
    node.appendChild(
      el('div', { class: 'obj' }, [
        el('span', { text: cur.obj.label }),
        el('span', { class: 'count', text: `${Math.floor(cur.value)}/${cur.obj.target}` }),
      ]),
    );
    node.appendChild(el('div', { class: 'hint', text: cur.obj.hint }));
    const doneCount = tracker.items.filter((i) => i.complete).length;
    node.appendChild(
      el('div', { class: 'prog' }, [
        el('i', { style: `width:${(doneCount / tracker.items.length) * 100}%` }),
      ]),
    );
    return node;
  };

  let host: HTMLElement | null = null;
  const refresh = (): void => {
    if (!host) return;
    const fresh = buildCard();
    if (card) card.replaceWith(fresh);
    else host.appendChild(fresh);
    card = fresh;
  };

  tracker.onChange = refresh;
  tracker.onComplete = () => {
    if (completed) return;
    completed = true;
    audio.play('levelup');
    audio.crowdPop(0.6);
    toast.show('Stage complete!', 'gold', 2600, '🎓');
    globalThis.setTimeout(() => finishStage(app, stage, elapsed, true), 1600);
  };

  const matchParams: MatchScreenParams = {
    config,
    arena: 'training_hall',
    showIntro: false,
    overlayHost: (h) => {
      host = h;
      refresh();
    },
    onSimEvent: (e) => tracker.handle(e),
    onTick: (dt) => {
      elapsed += dt;
      // Continuous objectives read live sim state each frame.
      const sim = (app.activeMatch as { sim?: MatchSim } | null)?.sim;
      if (sim) {
        tracker.tickGuard(dt, sim.player.guarding);
        if (stage.objectives.some((o) => o.kind === 'survive')) tracker.tickSurvive(dt);
        tracker.tickWalk(dt, Math.hypot(app.input.stick.x, app.input.stick.y));
      }
    },
    onComplete: (result) => {
      // Timed out or the coach won — count it if objectives were met.
      const success = tracker.allDone || ('winner' in result.outcome && result.outcome.winner === 'player' && tracker.allDone);
      if (!completed) finishStage(app, stage, elapsed, success);
    },
  };

  app.go('match', matchParams as unknown as Record<string, unknown>);
};

// ------------------------------------------------------------------ rewards

const finishStage = (app: App, stage: TrainingStage, seconds: number, success: boolean): void => {
  const save = app.requireSave();

  if (!success) {
    audio.play('defeat', { volume: 0.7 });
    showStageResult(app, stage, 0, null, false);
    return;
  }

  const starCount = starsForTime(stage, seconds);
  const prevStars = save.training.stars[stage.id] ?? 0;
  const firstClear = !save.training.completed.includes(stage.id);

  save.training.stars[stage.id] = Math.max(prevStars, starCount);
  if (firstClear) save.training.completed.push(stage.id);
  save.training.currentStage = stage.id;

  const r = stage.rewards;
  // Replays give reduced rewards so grinding is possible but not optimal.
  const mult = firstClear ? 1 : 0.25;
  const xp = Math.round(r.xp * mult);
  const coins = Math.round(r.coins * mult);

  const levelInfo = applyXp(save, xp);
  save.profile.coins += coins;
  save.stats.totalCoinsEarned += coins;

  if (firstClear) {
    save.profile.skillPoints += r.skillPoints;
    if (r.attribute) {
      save.profile.attributes[r.attribute.key] = Math.min(
        ATTRIBUTE_CAP,
        save.profile.attributes[r.attribute.key] + r.attribute.amount,
      );
    }
    if (r.unlocksMove) {
      const moveId = resolveUnlockToMoveId(r.unlocksMove);
      if (moveId && !save.profile.unlockedMoves.includes(moveId)) {
        save.profile.unlockedMoves.push(moveId);
      }
    }
  }

  void app.commit(`Completed ${stage.name}`);
  showStageResult(app, stage, starCount, { xp, coins, levelInfo, firstClear }, true);
};

const showStageResult = (
  app: App,
  stage: TrainingStage,
  starCount: number,
  rewards: { xp: number; coins: number; levelInfo: { levelsGained: number; newLevel: number; skillPointsGained: number }; firstClear: boolean } | null,
  success: boolean,
): void => {
  const save = app.requireSave();
  app.setFrameCallback(null);
  app.uiRoot.replaceChildren();

  const screen = el('div', { class: 'screen overlay-bg' });
  const body = el('div', { class: 'screen-body' });

  body.appendChild(
    el('div', { class: 'result-hero' }, [
      el('div', {
        class: `result-verdict ${success ? 'win' : 'loss'}`,
        text: success ? 'COMPLETE' : 'TRY AGAIN',
      }),
      el('div', { class: 'result-method', text: stage.name }),
      success
        ? el('div', { class: 'stars', style: 'font-size:30px;margin-top:10px', html: stars(starCount) })
        : null,
    ]),
  );

  if (rewards) {
    const r = stage.rewards;
    body.appendChild(el('div', { class: 'section-label', text: 'Rewards' }));
    const card = el('div', { class: 'card' });
    card.appendChild(rewardRow('Experience', `+${rewards.xp} XP`, 'var(--blue)', 0));
    card.appendChild(rewardRow('Coins', `+${rewards.coins}`, 'var(--gold)', 1));
    if (rewards.firstClear) {
      card.appendChild(rewardRow('Skill Points', `+${r.skillPoints}`, 'var(--purple)', 2));
      if (r.attribute) {
        card.appendChild(
          rewardRow('Attribute', `+${r.attribute.amount} ${r.attribute.key.toUpperCase()}`, 'var(--green)', 3),
        );
      }
      if (r.unlocksMove) {
        card.appendChild(rewardRow('New Move Unlocked', '★', 'var(--accent)', 4));
      }
    }
    if (rewards.levelInfo.levelsGained > 0) {
      card.appendChild(
        rewardRow(
          `LEVEL UP → ${rewards.levelInfo.newLevel}`,
          `+${rewards.levelInfo.skillPointsGained} SP`,
          'var(--gold)',
          5,
        ),
      );
    }
    body.appendChild(card);
  }

  const nextIdx = stage.index + 1;
  const next = nextIdx < TRAINING_STAGES.length ? TRAINING_STAGES[nextIdx] : null;
  const allDone = save.training.completed.length >= TRAINING_STAGES.length;

  if (allDone) {
    body.appendChild(
      el('div', { class: 'card', style: 'border-color:var(--gold);margin-top:14px' }, [
        el('div', { class: 'card-accent', style: 'background:var(--gold)' }),
        el('div', { class: 'card-title', text: '🎓 Training Complete' }),
        el('p', {
          class: 'card-sub',
          text: 'You are ready. The Amateur Circuit is open — go earn your first win.',
        }),
      ]),
    );
  }

  const actions = el('div', { class: 'btn-row', style: 'margin-top:16px' });
  if (success && next && !save.training.completed.includes(next.id)) {
    actions.appendChild(
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            audio.play('ui_confirm');
            // Render the hall first so the briefing modal stacks on top of it.
            app.go('training');
            showStageBrief(app, next);
          },
        },
        [document.createTextNode('Next Stage')],
      ),
    );
  } else if (!success) {
    actions.appendChild(
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            audio.play('ui_confirm');
            startStage(app, stage);
          },
        },
        [document.createTextNode('Retry')],
      ),
    );
  } else if (allDone) {
    actions.appendChild(
      el('button', { class: 'btn gold', onclick: () => { audio.play('ui_confirm'); app.go('league'); } }, [
        document.createTextNode('Enter the League'),
      ]),
    );
  }
  actions.appendChild(
    el('button', { class: 'btn secondary', onclick: () => { audio.play('ui_back'); app.go('training'); } }, [
      document.createTextNode('Training Hall'),
    ]),
  );
  body.appendChild(actions);

  screen.appendChild(body);
  app.mount(screen);
};

const rewardRow = (label: string, value: string, color: string, i: number): HTMLElement =>
  el('div', { class: 'reward-row', style: `animation-delay:${i * 90}ms` }, [
    el('span', { text: label }),
    el('span', { class: 'val', style: `color:${color}`, text: value }),
  ]);

export { STAGE_BY_ID };
