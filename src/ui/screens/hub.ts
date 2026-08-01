import { audio } from '../../engine/audio';
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
        document.createTextNode(p.name.toUpperCase()),
        el('span', { class: 'sub', text: `${div.name} · ${club?.name ?? 'No club'}` }),
      ]),
    ]),
    el(
      'button',
      {
        class: 'icon-btn',
        'aria-label': 'Settings',
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
          el('div', { style: 'font-size:11px;letter-spacing:1.6px;color:var(--text-faint);text-transform:uppercase;font-weight:800', text: `Level ${p.level}` }),
          el('div', { style: 'font-family:var(--font-display);font-size:19px;letter-spacing:.5px', text: div.name }),
        ]),
        el('div', { style: 'text-align:right' }, [
          el('div', { style: 'font-family:var(--font-display);font-size:32px;line-height:1;color:' + div.color, text: String(rating) }),
          el('div', { style: 'font-size:8px;letter-spacing:1.6px;color:var(--text-faint);text-transform:uppercase', text: 'Overall' }),
        ]),
      ]),
      el('div', { class: 'bar-label' }, [
        el('span', { text: 'Experience' }),
        el('b', { text: `${p.xp} / ${xpNeeded}` }),
      ]),
      el('div', { class: 'bar xp' }, [
        el('i', { style: `width:${Math.min(100, (p.xp / xpNeeded) * 100)}%` }),
      ]),
      el('div', { class: 'row', style: 'margin-top:11px;gap:6px;flex-wrap:wrap' }, [
        el('span', { class: 'chip gold', text: `🪙 ${p.coins.toLocaleString()}` }),
        el('span', { class: 'chip purple', text: `✦ ${p.skillPoints} SP` }),
        el('span', { class: 'chip green', text: `${save.record.wins}W – ${save.record.losses}L` }),
        save.record.streak > 1
          ? el('span', { class: 'chip blue', text: `🔥 ${save.record.streak} streak` })
          : null,
      ]),
    ]),
  );

  // ---------------------------------------------------------- primary action
  if (!trainingDone && training) {
    body.appendChild(el('div', { class: 'section-label', text: 'Continue your journey' }));
    body.appendChild(
      navCard(
        training.icon,
        `Training: ${training.name}`,
        training.subtitle,
        'var(--green)',
        () => app.go('training'),
        save.training.completed.length === 0 ? 'NEW' : undefined,
      ),
    );
  } else {
    body.appendChild(el('div', { class: 'section-label', text: 'Next match' }));
    body.appendChild(
      navCard(
        save.league.promotionAvailable ? '🏆' : '🤼',
        save.league.promotionAvailable ? 'Promotion Bout Available!' : `${div.name}`,
        save.league.promotionAvailable
          ? `Beat the division's best to reach ${DIVISION_BY_ID.get(save.league.division)?.name === div.name ? 'the next tier' : ''}`
          : `${save.league.winsInDivision}/${div.winsToPromote} wins toward promotion`,
        save.league.promotionAvailable ? 'var(--gold)' : div.color,
        () => app.go('league'),
        save.league.promotionAvailable ? 'READY' : undefined,
      ),
    );
  }

  // ------------------------------------------------------------------- menu
  body.appendChild(el('div', { class: 'section-label', text: 'Career' }));

  body.appendChild(
    navCard('🏟️', 'League & Matches', `${div.name} · ${save.league.points} pts`, 'var(--blue)', () =>
      app.go('league'),
    ),
  );

  body.appendChild(
    navCard(
      '🗓️',
      save.tournament && !save.tournament.completed ? 'Tournament In Progress' : 'Tournaments',
      save.tournament && !save.tournament.completed
        ? save.tournament.name
        : 'Bracket events and club championships',
      'var(--purple)',
      () => app.go('tournament'),
      save.tournament && !save.tournament.completed ? 'LIVE' : undefined,
    ),
  );

  body.appendChild(
    navCard(
      '🌳',
      'Skills & Training',
      p.skillPoints > 0 ? `${p.skillPoints} skill point${p.skillPoints > 1 ? 's' : ''} to spend!` : 'Upgrade attributes and unlock moves',
      'var(--purple)',
      () => app.go('skills'),
      p.skillPoints > 0 ? `${p.skillPoints} SP` : undefined,
    ),
  );

  body.appendChild(
    navCard(
      '🥋',
      'Training Hall',
      trainingDone
        ? 'All stages complete — replay for stars'
        : `${save.training.completed.length}/${TRAINING_STAGES.length} stages complete`,
      'var(--green)',
      () => app.go('training'),
    ),
  );

  const achCount = save.achievements.length;
  body.appendChild(
    navCard(
      '👤',
      'Profile & Records',
      `${achCount}/${ACHIEVEMENTS.length} achievements · ${save.record.matchesPlayed} matches`,
      'var(--gold)',
      () => app.go('profile'),
    ),
  );

  // -------------------------------------------------------------- last save
  body.appendChild(
    el('div', { class: 'tiny center', style: 'margin-top:16px;opacity:.5' }, [
      document.createTextNode(
        `Progress saved ${formatRelative(save.checkpoint.savedAt)} · ${save.checkpoint.label}`,
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
        : el('span', { style: 'color:var(--text-faint);font-size:18px', text: '›' }),
    ]),
  ]);
  card.addEventListener('click', () => {
    audio.play('ui_tap');
    onClick();
  });
  return card;
};
