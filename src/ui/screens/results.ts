import { audio } from '../../engine/audio';
import type { App } from '../../game/app';
import { DIVISION_BY_ID, type MatchFormat } from '../../game/data/leagues';
import { applyXp, computeReward } from '../../game/career/progression';
import { advanceTournament, recordLeagueResult, roundName, tournamentOpponent } from '../../game/career/league';
import { accumulatePassives } from '../../game/data/skills';
import type { MatchConfig, MatchResult } from '../../game/sim/types';
import type { RosterWrestler } from '../../game/career/roster';
import type { ScreenId } from '../../game/save/schema';
import { countUp, el } from '../dom';
import { toast } from '../toast';
import type { MatchScreenParams } from './match';

export interface RunMatchOptions {
  config: MatchConfig;
  arena: MatchScreenParams['arena'];
  opponent: RosterWrestler;
  isPromotion: boolean;
  format: MatchFormat;
  returnTo: ScreenId;
  /** Tournament context, if this bout is part of a bracket. */
  tournament?: boolean;
}

/** Launch a competitive match and route into the results flow when it ends. */
export const runMatch = (app: App, opts: RunMatchOptions): void => {
  const params: MatchScreenParams = {
    config: opts.config,
    arena: opts.arena,
    showIntro: true,
    onComplete: (result) => processResult(app, opts, result),
  };
  app.go('match', params as unknown as Record<string, unknown>);
};

// -------------------------------------------------------------- processing

const processResult = (app: App, opts: RunMatchOptions, result: MatchResult): void => {
  const save = app.requireSave();
  const won = 'winner' in result.outcome && result.outcome.winner === 'player';
  const drew = result.outcome.type === 'points' && result.outcome.winner === 'draw';

  // ----- career record
  const rec = save.record;
  rec.matchesPlayed++;
  if (won) {
    rec.wins++;
    rec.streak++;
    rec.bestStreak = Math.max(rec.bestStreak, rec.streak);
    if (result.outcome.type === 'pin') rec.pins++;
    if (result.outcome.type === 'submission') rec.submissions++;
    if (result.outcome.type === 'knockout') rec.knockouts++;
  } else if (drew) {
    rec.draws++;
  } else {
    rec.losses++;
    rec.streak = 0;
  }
  rec.finishersLanded += result.stats.finishersLanded;
  rec.totalReversals += result.stats.reversals;
  save.stats.totalDamageDealt += result.stats.damageDealt;

  // ----- rewards
  const passives = accumulatePassives(save.profile.unlockedSkills);
  const reward = computeReward(result, save.league.division, won, passives.crowdFavour);
  const isExhibition = opts.format === 'exhibition';
  const xp = isExhibition ? Math.round(reward.xp * 0.4) : reward.xp;
  const coins = isExhibition ? Math.round(reward.coins * 0.4) : reward.coins;

  const levelInfo = applyXp(save, xp);
  save.profile.coins += coins;
  save.stats.totalCoinsEarned += coins;

  // ----- league / tournament bookkeeping
  let promotionMsg: string | null = null;
  let tournamentMsg: string | null = null;

  if (opts.tournament && save.tournament) {
    const t = save.tournament;
    const outcome = advanceTournament(t, won);
    if (outcome.finished) {
      if (outcome.championId === 'player') {
        save.profile.coins += t.prize;
        save.stats.totalCoinsEarned += t.prize;
        const titleKey = t.name.toLowerCase().includes('club')
          ? `club:${t.id}`
          : `tournament:${t.id}`;
        if (!save.league.titlesHeld.includes(titleKey)) save.league.titlesHeld.push(titleKey);
        tournamentMsg = `🏆 You won ${t.name}! Prize: ${t.prize.toLocaleString()} coins`;
      } else {
        tournamentMsg = won ? 'Tournament complete.' : `Eliminated from ${t.name}.`;
      }
      t.completed = true;
    } else {
      const remaining = t.bracket[t.roundIndex].length;
      tournamentMsg = `Advancing to the ${roundName(remaining)}!`;
    }
  } else if (opts.format !== 'exhibition') {
    const update = recordLeagueResult(
      save,
      opts.opponent.id,
      won,
      reward.leaguePoints,
      opts.isPromotion,
    );
    if (update.promoted && update.newDivision) {
      const nd = DIVISION_BY_ID.get(update.newDivision)!;
      promotionMsg = `PROMOTED TO ${nd.name.toUpperCase()}`;
    } else if (update.promotionUnlocked) {
      promotionMsg = 'PROMOTION BOUT UNLOCKED';
    } else if (opts.isPromotion && !won) {
      promotionMsg = 'Promotion bout lost — earn another shot';
    }
  }

  void app.commit(won ? 'Match won' : 'Match completed');
  renderResults(app, {
    result,
    reward: { xp, coins, bonuses: reward.bonuses },
    levelInfo,
    won,
    drew,
    opponentName: opts.opponent.name,
    promotionMsg,
    tournamentMsg,
    returnTo: opts.returnTo,
    isTournament: Boolean(opts.tournament),
    config: opts.config,
  });

  // ----- history log
  save.history.unshift({
    at: Date.now(),
    opponent: opts.opponent.name,
    opponentClub: opts.opponent.clubId,
    division: save.league.division,
    won,
    method: methodLabel(result),
    scoreFor: result.playerScore,
    scoreAgainst: result.opponentScore,
    xp,
    coins,
  });
  if (save.history.length > 40) save.history.length = 40;
};

// ------------------------------------------------------------------ screen

interface ResultsParams {
  result: MatchResult;
  reward: { xp: number; coins: number; bonuses: { label: string; xp: number; coins: number }[] };
  levelInfo: { levelsGained: number; newLevel: number; skillPointsGained: number };
  won: boolean;
  drew: boolean;
  opponentName: string;
  promotionMsg: string | null;
  tournamentMsg: string | null;
  returnTo: ScreenId;
  isTournament: boolean;
  config: MatchConfig;
}

const renderResults = (app: App, p: ResultsParams): void => {
  const save = app.requireSave();
  app.setFrameCallback(null);
  app.uiRoot.replaceChildren();
  app.currentScreen = 'results';

  // Keep the 3D celebration running behind the panel.
  app.setFrameCallback((dt) => app.renderer.renderMenu(dt));

  const screen = el('div', { class: 'screen overlay-bg' });
  const body = el('div', { class: 'screen-body' });

  const verdict = p.won ? 'VICTORY' : p.drew ? 'DRAW' : 'DEFEAT';
  body.appendChild(
    el('div', { class: 'result-hero' }, [
      el('div', { class: `result-verdict ${p.won ? 'win' : 'loss'}`, text: verdict }),
      el('div', { class: 'result-method', text: `${methodLabel(p.result)} · vs ${p.opponentName}` }),
      el('div', {
        style: 'font-family:var(--font-display);font-size:30px;margin-top:8px;letter-spacing:2px',
        html: `<span style="color:var(--blue)">${p.result.playerScore}</span> <span style="color:var(--text-faint)">–</span> <span style="color:var(--red)">${p.result.opponentScore}</span>`,
      }),
    ]),
  );

  if (p.promotionMsg) {
    body.appendChild(
      el('div', { class: 'card', style: 'border-color:var(--gold);text-align:center' }, [
        el('div', { class: 'card-accent', style: 'background:var(--gold)' }),
        el('div', { style: 'font-family:var(--font-display);font-size:17px;color:var(--gold);letter-spacing:1px', text: p.promotionMsg }),
      ]),
    );
    if (p.promotionMsg.startsWith('PROMOTED')) {
      audio.play('levelup');
      app.renderer.celebrate();
    }
  }

  if (p.tournamentMsg) {
    body.appendChild(
      el('div', { class: 'card', style: 'border-color:var(--purple);text-align:center' }, [
        el('div', { class: 'card-accent', style: 'background:var(--purple)' }),
        el('div', { style: 'font-size:14px;font-weight:800;color:var(--purple)', text: p.tournamentMsg }),
      ]),
    );
  }

  // ------------------------------------------------------------- rewards
  body.appendChild(el('div', { class: 'section-label', text: 'Rewards' }));
  const rewardCard = el('div', { class: 'card' });

  let i = 0;
  const baseXp = p.reward.xp - p.reward.bonuses.reduce((s, b) => s + b.xp, 0);
  const baseCoins = p.reward.coins - p.reward.bonuses.reduce((s, b) => s + b.coins, 0);
  rewardCard.appendChild(rewardRow(p.won ? 'Win bonus' : 'Participation', `+${baseXp} XP · 🪙${baseCoins}`, 'var(--text)', i++));
  for (const b of p.reward.bonuses) {
    rewardCard.appendChild(
      rewardRow(b.label, `+${b.xp} XP · 🪙${b.coins}`, 'var(--green)', i++),
    );
  }

  const totalXpNode = el('span', { class: 'val', style: 'color:var(--blue)', text: '0' });
  const totalCoinNode = el('span', { class: 'val', style: 'color:var(--gold)', text: '0' });
  rewardCard.appendChild(
    el('div', { class: 'reward-row total', style: `animation-delay:${i * 90}ms` }, [
      el('span', { text: 'Total' }),
      el('span', { class: 'row', style: 'gap:12px' }, [totalXpNode, totalCoinNode]),
    ]),
  );
  body.appendChild(rewardCard);

  globalThis.setTimeout(() => {
    countUp(totalXpNode, p.reward.xp, 900, '');
    totalXpNode.textContent = '0 XP';
    const start = performance.now();
    const anim = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      const e = 1 - Math.pow(1 - t, 3);
      totalXpNode.textContent = `${Math.round(p.reward.xp * e)} XP`;
      totalCoinNode.textContent = `🪙${Math.round(p.reward.coins * e).toLocaleString()}`;
      if (t < 1) requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
    audio.play('coin');
  }, i * 90 + 200);

  if (p.levelInfo.levelsGained > 0) {
    audio.play('levelup');
    toast.show(`LEVEL ${p.levelInfo.newLevel}! +${p.levelInfo.skillPointsGained} skill points`, 'gold', 4000, '⬆');
    body.appendChild(
      el('div', { class: 'card', style: 'border-color:var(--gold);text-align:center;margin-top:4px' }, [
        el('div', { style: 'font-family:var(--font-display);font-size:19px;color:var(--gold)', text: `LEVEL UP → ${p.levelInfo.newLevel}` }),
        el('p', { class: 'card-sub', text: `+${p.levelInfo.skillPointsGained} skill point${p.levelInfo.skillPointsGained > 1 ? 's' : ''} available in the skill tree.` }),
      ]),
    );
  }

  // --------------------------------------------------------------- stats
  const s = p.result.stats;
  body.appendChild(el('div', { class: 'section-label', text: 'Match statistics' }));
  body.appendChild(
    el('div', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, [
        statBox(String(s.movesLanded), 'Landed'),
        statBox(`${Math.round((s.movesLanded / Math.max(1, s.movesAttempted)) * 100)}%`, 'Accuracy'),
        statBox(String(s.reversals), 'Reversals'),
        statBox(String(s.maxCombo), 'Best Combo'),
        statBox(String(Math.round(s.damageDealt)), 'Damage'),
        statBox(String(Math.round(s.biggestHit)), 'Biggest Hit'),
      ]),
    ]),
  );

  // -------------------------------------------------------------- actions
  const actions = el('div', { class: 'btn-row', style: 'margin-top:16px' });

  if (p.isTournament && save.tournament && !save.tournament.completed && !save.tournament.eliminated) {
    const nextOpp = tournamentOpponent(save.tournament);
    actions.appendChild(
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            audio.play('ui_confirm');
            app.go('tournament');
          },
        },
        [document.createTextNode(nextOpp ? 'Next Round' : 'View Bracket')],
      ),
    );
  } else {
    actions.appendChild(
      el('button', { class: 'btn', onclick: () => { audio.play('ui_confirm'); app.go(p.returnTo); } }, [
        document.createTextNode(p.returnTo === 'league' ? 'Back to League' : 'Continue'),
      ]),
    );
  }

  actions.appendChild(
    el('button', { class: 'btn secondary', onclick: () => { audio.play('ui_back'); app.go('hub'); } }, [
      document.createTextNode('Hub'),
    ]),
  );
  body.appendChild(actions);

  if (save.profile.skillPoints > 0) {
    body.appendChild(
      el(
        'button',
        {
          class: 'btn ghost',
          style: 'margin-top:8px',
          onclick: () => {
            audio.play('ui_tap');
            app.go('skills');
          },
        },
        [document.createTextNode(`Spend ${save.profile.skillPoints} skill point${save.profile.skillPoints > 1 ? 's' : ''} →`)],
      ),
    );
  }

  screen.appendChild(body);
  app.mount(screen);
};

const rewardRow = (label: string, value: string, color: string, i: number): HTMLElement =>
  el('div', { class: 'reward-row', style: `animation-delay:${i * 90}ms` }, [
    el('span', { text: label }),
    el('span', { class: 'val', style: `color:${color}`, text: value }),
  ]);

const statBox = (v: string, l: string): HTMLElement =>
  el('div', { class: 'stat-box' }, [el('div', { class: 'v', text: v }), el('div', { class: 'l', text: l })]);

export const methodLabel = (r: MatchResult): string => {
  switch (r.outcome.type) {
    case 'pin':
      return 'By pinfall';
    case 'submission':
      return 'By submission';
    case 'knockout':
      return 'By stoppage';
    case 'retired':
      return 'By forfeit';
    case 'points':
      return r.outcome.winner === 'draw' ? 'Drawn on points' : 'On points';
  }
};
