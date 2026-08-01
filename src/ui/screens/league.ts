import { audio } from '../../engine/audio';
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
        document.createTextNode('‹'),
      ]),
      el('h1', {}, [
        document.createTextNode('LEAGUE'),
        el('span', { class: 'sub', text: `Season ${save.league.seasonNumber} · ${div.name}` }),
      ]),
      el('span', { class: 'chip gold', text: `🪙 ${save.profile.coins.toLocaleString()}` }),
    ]),
  );

  const body = el('div', { class: 'screen-body' });

  // Gate: training must be finished before official competition.
  const trainingDone = save.training.completed.length >= TRAINING_STAGES.length;
  if (!trainingDone) {
    body.appendChild(
      el('div', { class: 'card', style: 'border-color:rgba(251,191,36,.45)' }, [
        el('div', { class: 'card-accent', style: 'background:var(--gold)' }),
        el('div', { class: 'card-title', text: 'Finish your training first' }),
        el('p', {
          class: 'card-sub',
          text: `You have completed ${save.training.completed.length} of ${TRAINING_STAGES.length} stages. The league will not sanction you until the full programme is done.`,
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
          [document.createTextNode('Go to Training')],
        ),
      ]),
    );
    screen.appendChild(body);
    app.mount(screen);
    return;
  }

  // ------------------------------------------------------- division ladder
  body.appendChild(el('div', { class: 'section-label', text: 'Your division' }));
  body.appendChild(
    el('div', { class: 'card', style: `border-color:${div.color}55` }, [
      el('div', { class: 'card-accent', style: `background:${div.color}` }),
      el('div', { class: 'row between mb' }, [
        el('div', { class: 'grow' }, [
          el('div', { style: `font-family:var(--font-display);font-size:20px;color:${div.color}`, text: div.name }),
          el('p', { class: 'card-sub', text: div.subtitle }),
        ]),
        el('div', { style: 'text-align:right' }, [
          el('div', { style: 'font-family:var(--font-display);font-size:24px', text: String(save.league.points) }),
          el('div', { style: 'font-size:8px;letter-spacing:1.4px;color:var(--text-faint);text-transform:uppercase', text: 'Points' }),
        ]),
      ]),
      el('div', { class: 'bar-label' }, [
        el('span', { text: save.league.promotionAvailable ? 'Promotion bout unlocked!' : 'Promotion progress' }),
        el('b', { text: `${save.league.winsInDivision} / ${div.winsToPromote} wins` }),
      ]),
      el('div', { class: 'bar' }, [
        el('i', {
          style: `width:${Math.min(100, (save.league.winsInDivision / div.winsToPromote) * 100)}%;background:${div.color}`,
        }),
      ]),
      el('div', { class: 'row', style: 'margin-top:10px;gap:6px' }, [
        el('span', { class: 'chip', text: `${save.league.winsInDivision}W – ${save.league.lossesInDivision}L` }),
        el('span', { class: 'chip', text: `Purse 🪙${div.purse}` }),
        div.entryFee > 0 ? el('span', { class: 'chip', text: `Entry 🪙${div.entryFee}` }) : null,
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

  // --------------------------------------------------------------- opponents
  const slate = leagueSlate(save);
  body.appendChild(
    el('div', {
      class: 'section-label',
      text: save.league.promotionAvailable ? 'Promotion bout' : 'Available opponents',
    }),
  );

  for (const opt of slate) {
    body.appendChild(opponentCard(app, opt, div.entryFee));
  }

  // ------------------------------------------------------------ exhibition
  body.appendChild(el('div', { class: 'section-label', text: 'Other options' }));
  const exhib = el('div', { class: 'card interactive' }, [
    el('div', { class: 'card-accent', style: 'background:var(--text-faint)' }),
    el('div', { class: 'row' }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'card-title', text: 'Exhibition Match' }),
        el('p', { class: 'card-sub', text: 'No entry fee, no league points. Practise against a random opponent.' }),
      ]),
      el('span', { style: 'color:var(--text-faint);font-size:18px', text: '›' }),
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
        el('div', { class: 'card-title', text: 'Tournaments & Club Championships' }),
        el('p', { class: 'card-sub', text: 'Single-elimination brackets with big prize pools.' }),
      ]),
      el('span', { style: 'color:var(--text-faint);font-size:18px', text: '›' }),
    ]),
  ]);
  tourneyCard.addEventListener('click', () => {
    audio.play('ui_tap');
    app.go('tournament');
  });
  body.appendChild(tourneyCard);

  // -------------------------------------------------------------- standings
  body.appendChild(el('div', { class: 'section-label', text: 'Division standings' }));
  const board = buildLeaderboard(save);
  const lbWrap = el('div', { class: 'card', style: 'padding:9px' });
  board.slice(0, 13).forEach((e, i) => {
    const club = e.clubId ? CLUB_BY_ID.get(e.clubId) : null;
    lbWrap.appendChild(
      el('div', { class: `lb-row ${e.isPlayer ? 'me' : ''}` }, [
        el('div', { class: 'lb-rank', text: String(i + 1) }),
        el('div', { class: 'lb-name' }, [
          document.createTextNode(e.name),
          club
            ? el('div', { style: `font-size:9px;color:${club.colors[0]};font-weight:600`, text: club.name })
            : null,
        ]),
        el('div', { class: 'lb-stat', text: `${e.wins}-${e.losses}` }),
        el('div', { class: 'lb-stat', text: `OVR ${e.rating}` }),
        el('div', { class: 'lb-pts', text: String(e.points) }),
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
        el('div', { class: 'meta', text: `"${w.nickname}" · ${club?.name ?? 'Independent'}` }),
        el('span', { class: 'style-pill', style: `color:${style.color}`, text: style.name }),
      ]),
      el('div', { class: 'vs-rating' }, [
        el('div', {
          class: 'num',
          style: `color:${diff > 6 ? 'var(--red)' : diff < -6 ? 'var(--green)' : 'var(--text)'}`,
          text: String(w.rating),
        }),
        el('div', { class: 'lbl', text: 'OVR' }),
      ]),
    ]),
    el('div', { class: 'row between', style: 'margin-top:10px' }, [
      el('span', { class: 'tiny' }, [
        document.createTextNode(
          opt.alreadyBeaten ? '✓ Already beaten this season' : diff > 8 ? '⚠ Tough matchup' : diff < -8 ? 'Favourable matchup' : 'Even matchup',
        ),
      ]),
      el('span', { style: 'font-size:11px;font-weight:800;color:var(--gold)', text: `🪙 ${opt.reward.coins} · ${opt.reward.xp} XP` }),
    ]),
    opt.isPromotionBout
      ? el('div', {
          style: 'margin-top:8px;padding:7px 10px;border-radius:8px;background:rgba(251,191,36,.14);border:1px solid rgba(251,191,36,.34);font-size:11px;font-weight:700;color:var(--gold)',
          text: '🏆 PROMOTION BOUT — win to advance to the next division',
        })
      : null,
    entryFee > 0
      ? el('div', { class: 'tiny', style: `margin-top:6px;color:${canAfford ? 'var(--text-dim)' : 'var(--red)'}`, text: `Entry fee: 🪙${entryFee}${canAfford ? '' : ' (not enough coins)'}` })
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
    // Filter out anything unrecognised so a legacy save cannot break a match.
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
      toast.show('Not enough coins for the entry fee', 'red');
      return;
    }
    save.profile.coins -= entryFee;
  }

  const meta = FORMAT_META[format];
  const config: MatchConfig = {
    format,
    rounds: meta.rounds,
    roundSeconds: meta.roundSeconds,
    arenaCrowd: div.id === 'amateur' ? 0.4 : div.id === 'champion' ? 1 : 0.7,
    seed: (Date.now() ^ (opponent.rating * 7919)) >>> 0,
    player: buildPlayerConfig(app),
    opponent: toFighterConfig(opponent, div.difficulty),
    difficulty: div.difficulty,
    title: isPromotion ? 'PROMOTION BOUT' : meta.name.toUpperCase(),
    subtitle: div.name,
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
