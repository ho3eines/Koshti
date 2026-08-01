import { audio } from '../../engine/audio';
import { t, faNum } from '../../core/i18n';
import type { App } from '../../game/app';
import { overallRating } from '../../game/data/attributes';
import { CLUB_BY_ID, DIVISION_BY_ID } from '../../game/data/leagues';
import { nextStage, TRAINING_STAGES } from '../../game/career/training';
import { xpForLevel } from '../../game/career/progression';
import { el, formatRelative } from '../dom';
import { ACHIEVEMENTS } from '../../game/career/achievements';

/** Career hub — the home screen everything routes through. */
export const renderHub = (app: App): void => {
  const save = app.requireSave();
  const p = save.profile;
  const div = DIVISION_BY_ID.get(save.league.division)!;
  const club = p.clubId ? CLUB_BY_ID.get(p.clubId) : null;
  const rating = overallRating(p.attributes);
  const training = nextStage(save.training.completed);
  const trainingDone = save.training.completed.length >= TRAINING_STAGES.length;

  audio.playMusic('menu');
  app.renderer.setCameraMode('broadcast');

  const screen = el('div', { class: 'screen overlay-bg' });

  // ------------------------------------------------------------------ top
  const top = el('div', { class: 'topbar' }, [
    el('div', { class: 'grow' }, [
      el('h1', {}, [
        document.createTextNode(p.name),
        el('span', {
          class: 'sub',
          text: `${t(`div.${save.league.division}`)} · ${club?.name_fa ?? club?.name ?? t('hub.no_club')}`,
        }),
      ]),
    ]),
    el(
      'button',
      {
        class: 'icon-btn',
        'aria-label': t('match.settings'),
        onclick: () => {
          audio.play('ui_tap');
          app.go('settings');
        },
      },
      [document.createTextNode('⚙')],
    ),
  ]);
  screen.appendChild(top);

  const body = el('div', { class: 'screen-body' });

  // ------------------------------------------------------------- profile card
  const xpNeeded = xpForLevel(p.level);
  body.appendChild(
    el('div', { class: 'card', style: `--sc:${div.color}` }, [
      el('div', { class: 'card-accent', style: `background:${div.color}` }),
      el('div', { class: 'row between mb' }, [
        el('div', { class: 'grow' }, [
          el('div', {
            style: 'font-size:11px;letter-spacing:1.6px;color:var(--text-faint);font-weight:800',
            text: `سطح ${faNum(p.level)}`,
          }),
          el('div', { style: 'font-family:var(--font-display);font-size:19px;letter-spacing:.5px', text: t(`div.${save.league.division}`) }),
        ]),
        el('div', { style: 'text-align:start' }, [
          el('div', {
            style: 'font-family:var(--font-display);font-size:32px;line-height:1;color:' + div.color,
            text: faNum(rating),
          }),
          el('div', {
            style: 'font-size:8px;letter-spacing:1.6px;color:var(--text-faint);text-transform:uppercase',
            text: t('hub.overall'),
          }),
        ]),
      ]),
      el('div', { class: 'bar-label' }, [
        el('span', { text: t('hub.xp') }),
        el('b', { text: `${faNum(p.xp)} / ${faNum(xpNeeded)}` }),
      ]),
      el('div', { class: 'bar xp' }, [
        el('i', { style: `width:${Math.min(100, (p.xp / xpNeeded) * 100)}%` }),
      ]),
      el('div', { class: 'row', style: 'margin-top:11px;gap:6px;flex-wrap:wrap' }, [
        el('span', { class: 'chip gold', text: t('hub.coins', { n: faNum(p.coins.toLocaleString('en-US')) }) }),
        el('span', { class: 'chip purple', text: t('hub.sp', { n: faNum(p.skillPoints) }) }),
        el('span', { class: 'chip green', text: t('hub.record', { w: faNum(save.record.wins), l: faNum(save.record.losses) }) }),
        save.record.streak > 1
          ? el('span', { class: 'chip blue', text: t('hub.streak', { n: faNum(save.record.streak) }) })
          : null,
      ]),
    ]),
  );

  // ---------------------------------------------------------- primary action
  if (!trainingDone && training) {
    body.appendChild(el('div', { class: 'section-label', text: t('hub.continue') }));
    body.appendChild(
      navCard(
        training.icon,
        `${t('training.title')}: ${t(`stage.${training.id}.name`)}`,
        t(`stage.${training.id}.sub`),
        'var(--green)',
        () => app.go('training'),
        save.training.completed.length === 0 ? t('hub.new_badge') : undefined,
      ),
    );
  } else {
    body.appendChild(el('div', { class: 'section-label', text: t('hub.next_match') }));
    body.appendChild(
      navCard(
        save.league.promotionAvailable ? '🏆' : '🤼',
        save.league.promotionAvailable ? t('hub.promotion_ready') : t(`div.${save.league.division}`),
        save.league.promotionAvailable
          ? t('hub.promotion_body')
          : t('hub.wins_to_promo', { n: faNum(save.league.winsInDivision), target: faNum(div.winsToPromote) }),
        save.league.promotionAvailable ? 'var(--gold)' : div.color,
        () => app.go('league'),
        save.league.promotionAvailable ? t('hub.ready') : undefined,
      ),
    );
  }

  // ------------------------------------------------------------------- menu
  body.appendChild(el('div', { class: 'section-label', text: t('hub.career') }));

  body.appendChild(
    navCard('🏟️', t('hub.league'), t('hub.league_sub', { div: t(`div.${save.league.division}`), pts: faNum(save.league.points) }), 'var(--blue)', () =>
      app.go('league'),
    ),
  );

  body.appendChild(
    navCard(
      '🗓️',
      save.tournament && !save.tournament.completed ? t('hub.tournament_live') : t('hub.tournaments'),
      save.tournament && !save.tournament.completed
        ? save.tournament.name
        : t('hub.tournaments_sub'),
      'var(--purple)',
      () => app.go('tournament'),
      save.tournament && !save.tournament.completed ? t('hub.live') : undefined,
    ),
  );

  body.appendChild(
    navCard(
      '🌳',
      t('hub.skills'),
      p.skillPoints > 0 ? t('hub.skills_sub_sp', { n: faNum(p.skillPoints) }) : t('hub.skills_sub'),
      'var(--purple)',
      () => app.go('skills'),
      p.skillPoints > 0 ? `${faNum(p.skillPoints)} SP` : undefined,
    ),
  );

  body.appendChild(
    navCard(
      '🥋',
      t('hub.training_hall'),
      trainingDone
        ? t('hub.training_done')
        : t('hub.training_progress', { n: faNum(save.training.completed.length), total: faNum(TRAINING_STAGES.length) }),
      'var(--green)',
      () => app.go('training'),
    ),
  );

  const achCount = save.achievements.length;
  body.appendChild(
    navCard(
      '👤',
      t('hub.profile'),
      t('hub.profile_sub', {
        a: faNum(achCount),
        total: faNum(ACHIEVEMENTS.length),
        m: faNum(save.record.matchesPlayed),
      }),
      'var(--gold)',
      () => app.go('profile'),
    ),
  );

  // -------------------------------------------------------------- last save
  body.appendChild(
    el('div', { class: 'tiny center', style: 'margin-top:16px;opacity:.5' }, [
      document.createTextNode(
        t('hub.save_line', {
          rel: formatRelative(save.checkpoint.savedAt),
          label: save.checkpoint.label,
        }),
      ),
    ]),
  );

  screen.appendChild(body);
  app.mount(screen);
};

const navCard = (
  icon: string,
  title: string,
  sub: string,
  color: string,
  onClick: () => void,
  badge?: string,
): HTMLElement => {
  const card = el('div', { class: 'card interactive' }, [
    el('div', { class: 'card-accent', style: `background:${color}` }),
    el('div', { class: 'row' }, [
      el('div', {
        style: `width:40px;height:40px;flex-shrink:0;border-radius:12px;display:grid;place-items:center;font-size:20px;background:${color}22;border:1px solid ${color}44`,
        text: icon,
      }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card-title', text: title }),
        el('p', { class: 'card-sub', text: sub }),
      ]),
      badge
        ? el('span', { class: 'badge new', style: `background:${color}`, text: badge })
        : el('span', { style: 'color:var(--text-faint);font-size:18px', text: '‹' }),
    ]),
  ]);
  card.addEventListener('click', () => {
    audio.play('ui_tap');
    onClick();
  });
  return card;
};
