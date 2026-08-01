import { audio } from '../../engine/audio';
import { t, faNum } from '../../core/i18n';
import type { App } from '../../game/app';
import { CLUB_BY_ID, DIVISION_BY_ID, FORMAT_META } from '../../game/data/leagues';
import { createTournament, tournamentOpponent } from '../../game/career/league';
import { generateDivisionRoster, toFighterConfig, type RosterWrestler } from '../../game/career/roster';
import { TRAINING_STAGES } from '../../game/career/training';
import type { MatchConfig } from '../../game/sim/types';
import { el } from '../dom';
import { toast } from '../toast';
import { buildPlayerConfig } from './league';
import { runMatch, faRoundName } from './results';

export const renderTournament = (app: App): void => {
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
        document.createTextNode(t('tournament.title')),
        el('span', { class: 'sub', text: div.name_fa ?? div.name }),
      ]),
      el('span', { class: 'chip gold', text: `🪙 ${faNum(save.profile.coins)}` }),
    ]),
  );

  const body = el('div', { class: 'screen-body' });

  if (save.training.completed.length < TRAINING_STAGES.length) {
    body.appendChild(
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon', text: '🔒' }),
        el('div', { text: t('tournament.training_first') }),
      ]),
    );
    screen.appendChild(body);
    app.mount(screen);
    return;
  }

  const active = save.tournament && !save.tournament.completed ? save.tournament : null;

  if (active) {
    // ------------------------------------------------------- live bracket
    const roster = generateDivisionRoster(active.division, save.league.seasonNumber, 16);
    const byId = new Map(roster.map((w) => [w.id, w]));
    const nextOppId = tournamentOpponent(active);
    const nextOpp = nextOppId && nextOppId !== 'player' ? byId.get(nextOppId) : null;
    const remaining = active.bracket[active.roundIndex]?.length ?? 0;

    body.appendChild(el('div', { class: 'section-label', text: t('tournament.in_progress') }));
    body.appendChild(
      el('div', { class: 'card', style: 'border-color:var(--purple)' }, [
        el('div', { class: 'card-accent', style: 'background:var(--purple)' }),
        el('div', { class: 'card-title', text: active.name }),
        el('p', {
          class: 'card-sub',
          text: active.eliminated
            ? t('tournament.eliminated')
            : t('tournament.prize_pool', { r: faRoundName(remaining), p: faNum(active.prize) }),
        }),
      ]),
    );

    if (!active.eliminated && nextOpp) {
      body.appendChild(el('div', { class: 'section-label', text: t('tournament.next_bout') }));
      body.appendChild(
        opponentPreview(nextOpp, () => {
          audio.play('ui_confirm');
          startTournamentMatch(app, nextOpp, faRoundName(remaining));
        }),
      );
    } else if (active.eliminated) {
      body.appendChild(
        el(
          'button',
          {
            class: 'btn secondary',
            onclick: () => {
              audio.play('ui_tap');
              save.tournament = null;
              void app.commit(t('tournament.tclosed'));
              app.go('tournament');
            },
          },
          [document.createTextNode(t('tournament.close_bracket'))],
        ),
      );
    }

    // Bracket visualisation.
    body.appendChild(el('div', { class: 'section-label', text: t('tournament.bracket') }));
    const bracket = el('div', { class: 'bracket' });
    active.bracket.forEach((round, ri) => {
      const col = el('div', { class: 'bracket-round' }, [
        el('h5', { text: faRoundName(round.length) }),
      ]);
      for (const id of round) {
        const isPlayer = id === 'player';
        const w = byId.get(id);
        col.appendChild(
          el('div', {
            class: `bracket-slot ${isPlayer ? 'player' : ''}`,
            text: isPlayer ? save.profile.name : (w?.name ?? '—'),
          }),
        );
      }
      if (ri === active.roundIndex && !active.completed) {
        col.style.opacity = '1';
      }
      bracket.appendChild(col);
    });
    body.appendChild(bracket);
  } else {
    // ------------------------------------------------------- enter events
    body.appendChild(el('div', { class: 'section-label', text: t('tournament.open_events') }));

    const divName = div.name_fa ?? div.name;
    const events = [
      {
        name: t('tournament.div_open', { div: divName }),
        size: 8 as const,
        fee: Math.round(div.entryFee * 1.5),
        desc: t('tournament.div_open_desc'),
        color: 'var(--purple)',
        icon: '🗓️',
      },
      {
        name: t('tournament.fast_four', { div: divName }),
        size: 4 as const,
        fee: Math.round(div.entryFee * 0.8),
        desc: t('tournament.fast_four_desc'),
        color: 'var(--blue)',
        icon: '⚡',
      },
    ];

    for (const ev of events) {
      const canAfford = save.profile.coins >= ev.fee;
      const prize = Math.round(div.purse * (ev.size === 8 ? 6 : 3));
      const card = el('div', { class: `card ${canAfford ? 'interactive' : 'locked'}` }, [
        el('div', { class: 'card-accent', style: `background:${ev.color}` }),
        el('div', { class: 'row' }, [
          el('div', {
            style: `width:40px;height:40px;flex-shrink:0;border-radius:12px;display:grid;place-items:center;font-size:20px;background:${ev.color}22;border:1px solid ${ev.color}44`,
            text: ev.icon,
          }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'card-title', text: ev.name }),
            el('p', { class: 'card-sub', text: ev.desc }),
          ]),
        ]),
        el('div', { class: 'row between', style: 'margin-top:9px' }, [
          el('span', { class: 'tiny', style: canAfford ? '' : 'color:var(--red)', text: t('tournament.entry', { n: faNum(ev.fee) }) }),
          el('span', { style: 'font-size:12px;font-weight:800;color:var(--gold)', text: t('tournament.prize', { n: faNum(prize) }) }),
        ]),
      ]);
      if (canAfford) {
        card.addEventListener('click', () => {
          audio.play('ui_confirm');
          save.profile.coins -= ev.fee;
          save.tournament = createTournament(save, ev.name, ev.size);
          void app.commit(`Entered ${ev.name}`);
          toast.show(t('tournament.entered', { n: ev.name }), 'blue', 2600, '🗓️');
          app.go('tournament');
        });
      }
      body.appendChild(card);
    }

    // Club championship — gated on club membership and division.
    if (save.profile.clubId) {
      const club = CLUB_BY_ID.get(save.profile.clubId)!;
      const fee = Math.round(div.entryFee * 2.2);
      const canAfford = save.profile.coins >= fee;
      const eligible = save.league.winsInDivision >= 2;
      const prize = Math.round(div.purse * 9);
      const clubName = club.name_fa ?? club.name;

      body.appendChild(el('div', { class: 'section-label', text: t('tournament.club_title') }));
      const card = el('div', { class: `card ${canAfford && eligible ? 'interactive' : 'locked'}` }, [
        el('div', { class: 'card-accent', style: `background:${club.colors[0]}` }),
        el('div', { class: 'row' }, [
          el('div', {
            style: `width:40px;height:40px;flex-shrink:0;border-radius:12px;display:grid;place-items:center;font-size:20px;background:${club.colors[0]}22;border:1px solid ${club.colors[0]}66`,
            text: '🛡️',
          }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'card-title', text: t('tournament.club_champ', { club: clubName }) }),
            el('p', {
              class: 'card-sub',
              text: eligible
                ? t('tournament.club_eligible', { city: club.city_fa ?? club.city })
                : t('tournament.club_need_wins'),
            }),
          ]),
        ]),
        el('div', { class: 'row between', style: 'margin-top:9px' }, [
          el('span', { class: 'tiny', style: canAfford ? '' : 'color:var(--red)', text: t('tournament.entry', { n: faNum(fee) }) }),
          el('span', { style: 'font-size:12px;font-weight:800;color:var(--gold)', text: t('tournament.prize', { n: faNum(prize) }) }),
        ]),
      ]);
      if (canAfford && eligible) {
        card.addEventListener('click', () => {
          audio.play('ui_confirm');
          save.profile.coins -= fee;
          save.tournament = createTournament(save, t('tournament.club_champ', { club: clubName }), 8);
          save.tournament.prize = prize;
          void app.commit('Entered club championship');
          app.go('tournament');
        });
      }
      body.appendChild(card);
    }

    // Past titles.
    if (save.league.titlesHeld.length > 0) {
      body.appendChild(el('div', { class: 'section-label', text: t('tournament.titles_won') }));
      const titles = el('div', { class: 'card' });
      for (const ti of save.league.titlesHeld) {
        const isClub = ti.startsWith('club');
        const isWorld = ti.startsWith('world');
        titles.appendChild(
          el('div', { class: 'row', style: 'gap:8px;padding:5px 0' }, [
            el('span', { text: isClub ? '🛡️' : isWorld ? '👑' : '🏆' }),
            el('span', {
              style: 'font-size:12.5px;font-weight:700',
              text: isWorld
                ? t('tournament.world_champ')
                : isClub
                  ? t('profile.club_champ')
                  : t('tournament.tourney_champ'),
            }),
          ]),
        );
      }
      body.appendChild(titles);
    }
  }

  screen.appendChild(body);
  app.mount(screen);
};

const opponentPreview = (w: RosterWrestler, onClick: () => void): HTMLElement => {
  const club = CLUB_BY_ID.get(w.clubId);
  const card = el('div', { class: 'card interactive' }, [
    el('div', { class: 'card-accent', style: 'background:var(--accent)' }),
    el('div', { class: 'vs-card' }, [
      el('div', {
        class: 'vs-avatar',
        style: `background:linear-gradient(135deg,#${w.tint.toString(16)},#${w.trunks.toString(16)})`,
        text: w.name.charAt(0),
      }),
      el('div', { class: 'vs-info' }, [
        el('h4', { text: w.name }),
        el('div', {
          class: 'meta',
          text: `«${w.nickname_fa ?? w.nickname}» · ${club?.name_fa ?? club?.name ?? t('profile.independent')}`,
        }),
      ]),
      el('div', { class: 'vs-rating' }, [
        el('div', { class: 'num', text: faNum(w.rating) }),
        el('div', { class: 'lbl', text: t('profile.overall') }),
      ]),
    ]),
    el('button', { class: 'btn', style: 'margin-top:11px' }, [document.createTextNode(t('tournament.fight'))]),
  ]);
  card.addEventListener('click', onClick);
  return card;
};

const startTournamentMatch = (app: App, opponent: RosterWrestler, round: string): void => {
  const save = app.requireSave();
  const div = DIVISION_BY_ID.get(save.league.division)!;
  const isClub = save.tournament?.name.toLowerCase().includes('باشگاه') ?? save.tournament?.name.toLowerCase().includes('club') ?? false;
  const format = isClub ? 'club_championship' : 'tournament';
  const meta = FORMAT_META[format];

  const config: MatchConfig = {
    format,
    rounds: meta.rounds,
    roundSeconds: meta.roundSeconds,
    arenaCrowd: 0.85,
    seed: (Date.now() ^ (opponent.rating * 104729)) >>> 0,
    player: buildPlayerConfig(app),
    opponent: toFighterConfig(opponent, Math.min(1, div.difficulty + 0.06)),
    difficulty: Math.min(1, div.difficulty + 0.06),
    title: round,
    subtitle: save.tournament?.name ?? t('tournament.title'),
  };

  runMatch(app, {
    config,
    arena: div.arena,
    opponent,
    isPromotion: false,
    format,
    returnTo: 'tournament',
    tournament: true,
  });
};
