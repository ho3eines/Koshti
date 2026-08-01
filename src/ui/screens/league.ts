import { audio } from '../../engine/audio';
import { t, faNum } from '../../core/i18n';
import type { App } from '../../game/app';
import { overallRating } from '../../game/data/attributes';
import { CLUB_BY_ID, DIVISION_BY_ID, DIVISIONS, FORMAT_META, type MatchFormat } from '../../game/data/leagues';
import { STYLES } from '../../game/data/styles';
import { accumulatePassives } from '../../game/data/skills';
import { STARTER_MOVES, hasMove } from '../../game/data/moves';
import { buildLeaderboard, leagueSlate, type LeagueOpponentOption } from '../../game/career/league';
import { toFighterConfig, type RosterWrestler } from '../../game/career/roster';
import { TRAINING_STAGES } from '../../game/career/training';
import type { FighterConfig, MatchConfig } from '../../game/sim/types';
import { el, hex } from '../dom';
import { toast } from '../toast';
import { runMatch } from './results';

/** League screen: division standing, opponent slate, leaderboard. */
export const renderLeague = (app: App): void => {
  const save = app.requireSave();
  const div = DIVISION_BY_ID.get(save.league.division)!;
  audio.playMusic('menu');

  const screen = el('div', { class: 'screen overlay-bg' });
  screen.appendChild(
    el('div', { class: 'topbar' }, [
      el('button', { class: 'icon-btn', onclick: () => { audio.play('ui_back'); app.go('hub'); } }, [
        document.createTextNode('›'),
      ]),
      el('h1', {}, [
        document.createTextNode(t('league.title')),
        el('span', {
          class: 'sub',
          text: `${t('league.season', { n: faNum(save.league.seasonNumber) })} · ${t(`div.${save.league.division}`)}`,
        }),
      ]),
      el('span', { class: 'chip gold', text: `🪙 ${faNum(save.profile.coins.toLocaleString('en-US'))}` }),
    ]),
  );

  const body = el('div', { class: 'screen-body' });

  // Gate: training must be finished before official competition.
  const trainingDone = save.training.completed.length >= TRAINING_STAGES.length;
  if (!trainingDone) {
    body.appendChild(
      el('div', { class: 'card', style: 'border-color:rgba(251,191,36,.45)' }, [
        el('div', { class: 'card-accent', style: 'background:var(--gold)' }),
        el('div', { class: 'card-title', text: t('league.training_first') }),
        el('p', {
          class: 'card-sub',
          text: t('league.training_body', {
            n: faNum(save.training.completed.length),
            total: faNum(TRAINING_STAGES.length),
          }),
        }),
        el(
          'button',
          {
            class: 'btn',
            style: 'margin-top:12px',
            onclick: () => {
              audio.play('ui_confirm');
              app.go('training');
            },
          },
          [document.createTextNode(t('league.go_training'))],
        ),
      ]),
    );
    screen.appendChild(body);
    app.mount(screen);
    return;
  }

  // Division ladder
  body.appendChild(el('div', { class: 'section-label', text: t('league.your_div') }));
  body.appendChild(
    el('div', { class: 'card', style: `border-color:${div.color}55` }, [
      el('div', { class: 'card-accent', style: `background:${div.color}` }),
      el('div', { class: 'row between mb' }, [
        el('div', { class: 'grow' }, [
          el('div', { style: `font-family:var(--font-display);font-size:20px;color:${div.color}`, text: t(`div.${save.league.division}`) }),
          el('p', { class: 'card-sub', text: div.subtitle }),
        ]),
        el('div', { style: 'text-align:start' }, [
          el('div', { style: 'font-family:var(--font-display);font-size:24px', text: faNum(save.league.points) }),
          el('div', { style: 'font-size:8px;letter-spacing:1.4px;color:var(--text-faint);text-transform:uppercase', text: t('league.pts') }),
        ]),
      ]),
      el('div', { class: 'bar-label' }, [
        el('span', { text: save.league.promotionAvailable ? t('league.promo_unlocked') : t('league.promo_prog') }),
        el('b', { text: t('league.wins', { n: faNum(save.league.winsInDivision), target: faNum(div.winsToPromote) }) }),
      ]),
      el('div', { class: 'bar' }, [
        el('i', {
          style: `width:${Math.min(100, (save.league.winsInDivision / div.winsToPromote) * 100)}%;background:${div.color}`,
        }),
      ]),
      el('div', { class: 'row', style: 'margin-top:10px;gap:6px;flex-wrap:wrap' }, [
        el('span', { class: 'chip', text: `${faNum(save.league.winsInDivision)}W – ${faNum(save.league.lossesInDivision)}L` }),
        el('span', { class: 'chip', text: `${t('league.purse')} 🪙${faNum(div.purse)}` }),
        div.entryFee > 0 ? el('span', { class: 'chip', text: `${t('league.entry')} 🪙${faNum(div.entryFee)}` }) : null,
      ]),
    ]),
  );

  // Division ladder strip.
  const ladder = el('div', { class: 'row', style: 'gap:4px;margin-bottom:14px' });
  for (const d of DIVISIONS) {
    const reached = DIVISIONS.indexOf(d) <= DIVISIONS.indexOf(div);
    ladder.appendChild(
      el('div', {
        style: `flex:1;height:4px;border-radius:3px;background:${reached ? d.color : 'rgba(255,255,255,.09)'}`,
        title: d.name,
      }),
    );
  }
  body.appendChild(ladder);

  // Opponents
  const slate = leagueSlate(save);
  body.appendChild(
    el('div', {
      class: 'section-label',
      text: save.league.promotionAvailable ? t('league.promo_bout') : t('league.opponents'),
    }),
  );

  for (const opt of slate) {
    body.appendChild(opponentCard(app, opt, div.entryFee));
  }

  // Exhibition
  body.appendChild(el('div', { class: 'section-label', text: t('league.other') }));
  const exhib = el('div', { class: 'card interactive' }, [
    el('div', { class: 'card-accent', style: 'background:var(--text-faint)' }),
    el('div', { class: 'row' }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'card-title', text: t('league.exhibition') }),
        el('p', { class: 'card-sub', text: t('league.exhibition_body') }),
      ]),
      el('span', { style: 'color:var(--text-faint);font-size:18px', text: '‹' }),
    ]),
  ]);
  exhib.addEventListener('click', () => {
    audio.play('ui_tap');
    const opt = slate[Math.floor(Math.random() * slate.length)];
    startLeagueMatch(app, opt.wrestler, 'exhibition', false, 0);
  });
  body.appendChild(exhib);

  const tourneyCard = el('div', { class: 'card interactive' }, [
    el('div', { class: 'card-accent', style: 'background:var(--purple)' }),
    el('div', { class: 'row' }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'card-title', text: t('league.tournaments') }),
        el('p', { class: 'card-sub', text: t('league.tournaments_body') }),
      ]),
      el('span', { style: 'color:var(--text-faint);font-size:18px', text: '‹' }),
    ]),
  ]);
  tourneyCard.addEventListener('click', () => {
    audio.play('ui_tap');
    app.go('tournament');
  });
  body.appendChild(tourneyCard);

  // Standings
  body.appendChild(el('div', { class: 'section-label', text: t('league.standings') }));
  const board = buildLeaderboard(save);
  const lbWrap = el('div', { class: 'card', style: 'padding:9px' });
  board.slice(0, 13).forEach((e, i) => {
    const club = e.clubId ? CLUB_BY_ID.get(e.clubId) : null;
    lbWrap.appendChild(
      el('div', { class: `lb-row ${e.isPlayer ? 'me' : ''}` }, [
        el('div', { class: 'lb-rank', text: faNum(i + 1) }),
        el('div', { class: 'lb-name' }, [
          document.createTextNode(e.name),
          club
            ? el('div', { style: `font-size:9px;color:${club.colors[0]};font-weight:600`, text: club.name_fa ?? club.name })
            : null,
        ]),
        el('div', { class: 'lb-stat', text: `${faNum(e.wins)}-${faNum(e.losses)}` }),
        el('div', { class: 'lb-stat', text: `${t('profile.overall')} ${faNum(e.rating)}` }),
        el('div', { class: 'lb-pts', text: faNum(e.points) }),
      ]),
    );
  });
  body.appendChild(lbWrap);

  screen.appendChild(body);
  app.mount(screen);
};

// ----------------------------------------------------------------- helpers

const opponentCard = (app: App, opt: LeagueOpponentOption, entryFee: number): HTMLElement => {
  const save = app.requireSave();
  const w = opt.wrestler;
  const club = CLUB_BY_ID.get(w.clubId);
  const style = STYLES[w.style];
  const playerRating = overallRating(save.profile.attributes);
  const diff = w.rating - playerRating;
  const canAfford = save.profile.coins >= entryFee;

  const matchHint = opt.alreadyBeaten
    ? t('league.beaten')
    : diff > 8 ? t('league.tough') : diff < -8 ? t('league.fav') : t('league.even');

  const card = el('div', { class: `card ${canAfford ? 'interactive' : 'locked'}` }, [
    el('div', { class: 'card-accent', style: `background:${opt.isPromotionBout ? 'var(--gold)' : style.color}` }),
    el('div', { class: 'vs-card' }, [
      el('div', {
        class: 'vs-avatar',
        style: `background:linear-gradient(135deg, ${hex(w.tint)}, ${hex(w.trunks)})`,
        text: w.name.charAt(0),
      }),
      el('div', { class: 'vs-info' }, [
        el('h4', { text: w.name }),
        el('div', { class: 'meta', text: `«${w.nickname_fa ?? w.nickname}» · ${club?.name_fa ?? (club?.name ?? t('league.independent'))}` }),
        el('span', { class: 'style-pill', style: `color:${style.color}`, text: t(`style.${w.style}`) }),
      ]),
      el('div', { class: 'vs-rating' }, [
        el('div', {
          class: 'num',
          style: `color:${diff > 6 ? 'var(--red)' : diff < -6 ? 'var(--green)' : 'var(--text)'}`,
          text: faNum(w.rating),
        }),
        el('div', { class: 'lbl', text: t('profile.overall') }),
      ]),
    ]),
    el('div', { class: 'row between', style: 'margin-top:10px' }, [
      el('span', { class: 'tiny', text: matchHint }),
      el('span', { style: 'font-size:11px;font-weight:800;color:var(--gold)', text: `🪙 ${faNum(opt.reward.coins)} · ${faNum(opt.reward.xp)} ${t('result.xp', { n: '' }).trim()}` }),
    ]),
    opt.isPromotionBout
      ? el('div', {
          style: 'margin-top:8px;padding:7px 10px;border-radius:8px;background:rgba(251,191,36,.14);border:1px solid rgba(251,191,36,.34);font-size:11px;font-weight:700;color:var(--gold)',
          text: '🏆 ' + t('league.promo_body'),
        })
      : null,
    entryFee > 0
      ? el('div', {
          class: 'tiny',
          style: `margin-top:6px;color:${canAfford ? 'var(--text-dim)' : 'var(--red)'}`,
          text: `${t('league.entry_fee', { n: faNum(entryFee) })}${canAfford ? '' : ' (' + t('league.not_enough') + ')'}`,
        })
      : null,
  ]);

  if (canAfford) {
    card.addEventListener('click', () => {
      audio.play('ui_tap');
      startLeagueMatch(app, w, opt.isPromotionBout ? 'title' : 'league', opt.isPromotionBout, entryFee);
    });
  }
  return card;
};

export const buildPlayerConfig = (app: App): FighterConfig => {
  const p = app.requireSave().profile;
  return {
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
};

export const startLeagueMatch = (
  app: App,
  opponent: RosterWrestler,
  format: MatchFormat,
  isPromotion: boolean,
  entryFee: number,
): void => {
  const save = app.requireSave();
  const div = DIVISION_BY_ID.get(save.league.division)!;

  if (entryFee > 0) {
    if (save.profile.coins < entryFee) {
      toast.show(t('league.no_coins'), 'red');
      return;
    }
    save.profile.coins -= entryFee;
  }

  const meta = FORMAT_META[format];
  const formatNameMap: Record<MatchFormat, string> = {
    exhibition: t('format.exhibition'),
    league: t('format.league'),
    tournament: t('format.tournament'),
    club_championship: t('format.club'),
    title: t('format.title'),
  };
  const config: MatchConfig = {
    format,
    rounds: meta.rounds,
    roundSeconds: meta.roundSeconds,
    arenaCrowd: div.id === 'amateur' ? 0.4 : div.id === 'champion' ? 1 : 0.7,
    seed: (Date.now() ^ (opponent.rating * 7919)) >>> 0,
    player: buildPlayerConfig(app),
    opponent: toFighterConfig(opponent, div.difficulty),
    difficulty: div.difficulty,
    title: isPromotion ? t('league.promo_bout').toUpperCase() : formatNameMap[format],
    subtitle: t(`div.${save.league.division}`),
  };

  runMatch(app, {
    config,
    arena: div.arena,
    opponent,
    isPromotion,
    format,
    returnTo: 'league',
  });
};
