import { audio } from '../../engine/audio';
import { t, faNum } from '../../core/i18n';
import type { App } from '../../game/app';
import { ATTRIBUTE_KEYS, ATTRIBUTE_META, ATTRIBUTE_CAP, overallRating } from '../../game/data/attributes';
import { CLUB_BY_ID, DIVISION_BY_ID } from '../../game/data/leagues';
import { STYLES } from '../../game/data/styles';
import { ACHIEVEMENTS } from '../../game/career/achievements';
import { xpForLevel } from '../../game/career/progression';
import { el, formatRelative } from '../dom';

export const renderProfile = (app: App): void => {
  const save = app.requireSave();
  const p = save.profile;
  const div = DIVISION_BY_ID.get(save.league.division)!;
  const club = p.clubId ? CLUB_BY_ID.get(p.clubId) : null;
  const style = STYLES[p.style];
  audio.playMusic('menu');

  let tab: 'overview' | 'achievements' | 'history' = 'overview';

  const screen = el('div', { class: 'screen overlay-bg' });
  screen.appendChild(
    el('div', { class: 'topbar' }, [
      el('button', { class: 'icon-btn', onclick: () => { audio.play('ui_back'); app.go('hub'); } }, [
        document.createTextNode('›'),
      ]),
      el('h1', {}, [
        document.createTextNode(t('profile.title')),
        el('span', {
          class: 'sub',
          text: `${div.name_fa ?? div.name} · ${club?.name_fa ?? club?.name ?? t('profile.independent')}`,
        }),
      ]),
    ]),
  );

  const tabs = el('div', { class: 'tree-tabs' });
  const body = el('div', { class: 'screen-body' });
  screen.appendChild(tabs);
  screen.appendChild(body);

  const drawTabs = (): void => {
    tabs.replaceChildren();
    for (const tb of [
      { id: 'overview' as const, label: t('profile.overview') },
      {
        id: 'achievements' as const,
        label: `${t('profile.achievements_tab')} ${faNum(save.achievements.length)}/${faNum(ACHIEVEMENTS.length)}`,
      },
      { id: 'history' as const, label: t('profile.history') },
    ]) {
      const btn = el('button', { class: `tree-tab ${tab === tb.id ? 'active' : ''}`, text: tb.label });
      btn.addEventListener('click', () => {
        audio.play('ui_tap');
        tab = tb.id;
        draw();
      });
      tabs.appendChild(btn);
    }
  };

  const draw = (): void => {
    drawTabs();
    body.replaceChildren();
    if (tab === 'overview') drawOverview();
    else if (tab === 'achievements') drawAchievements();
    else drawHistory();
  };

  // ---------------------------------------------------------------- overview
  const drawOverview = (): void => {
    const rating = overallRating(p.attributes);
    const xpNeeded = xpForLevel(p.level);
    const winRate = save.record.matchesPlayed
      ? Math.round((save.record.wins / save.record.matchesPlayed) * 100)
      : 0;

    body.appendChild(
      el('div', { class: 'card', style: `border-color:${style.color}44` }, [
        el('div', { class: 'card-accent', style: `background:${style.color}` }),
        el('div', { class: 'row', style: 'gap:14px' }, [
          el('div', {
            style: `width:64px;height:64px;flex-shrink:0;border-radius:18px;display:grid;place-items:center;font-family:var(--font-display);font-size:28px;background:linear-gradient(135deg,#${p.tint.toString(16)},#${p.trunks.toString(16)});border:2px solid rgba(255,255,255,.2)`,
            text: p.name.charAt(0).toUpperCase(),
          }),
          el('div', { class: 'grow' }, [
            el('div', { style: 'font-family:var(--font-display);font-size:22px', text: p.name }),
            el('div', { class: 'tiny', text: `${t('profile.level', { lvl: p.level })} · ${style.name_fa ?? style.name}` }),
            el('span', { class: 'style-pill', style: `color:${style.color}`, text: div.name_fa ?? div.name }),
          ]),
          el('div', { style: 'text-align:center' }, [
            el('div', { style: `font-family:var(--font-display);font-size:34px;line-height:1;color:${div.color}`, text: faNum(rating) }),
            el('div', { style: 'font-size:8px;letter-spacing:1.4px;color:var(--text-faint)', text: t('profile.overall') }),
          ]),
        ]),
        el('div', { style: 'margin-top:12px' }, [
          el('div', { class: 'bar-label' }, [
            el('span', { text: t('profile.experience') }),
            el('b', { text: `${faNum(p.xp)} / ${faNum(xpNeeded)}` }),
          ]),
          el('div', { class: 'bar xp' }, [el('i', { style: `width:${(p.xp / xpNeeded) * 100}%` })]),
        ]),
      ]),
    );

    // Career record.
    body.appendChild(el('div', { class: 'section-label', text: t('profile.career_record') }));
    body.appendChild(
      el('div', { class: 'card' }, [
        el('div', { class: 'stat-grid' }, [
          statBox(faNum(save.record.wins), t('profile.wins')),
          statBox(faNum(save.record.losses), t('profile.losses')),
          statBox(`${faNum(winRate)}٪`, t('profile.winrate')),
          statBox(faNum(save.record.pins), t('profile.pins')),
          statBox(faNum(save.record.submissions), t('profile.submissions')),
          statBox(faNum(save.record.knockouts), t('profile.stoppages')),
          statBox(faNum(save.record.bestStreak), t('profile.best_streak')),
          statBox(faNum(save.record.totalReversals), t('profile.reversals')),
          statBox(faNum(save.record.finishersLanded), t('profile.finishers')),
        ]),
      ]),
    );

    // Attributes.
    body.appendChild(el('div', { class: 'section-label', text: t('profile.attributes') }));
    const attrCard = el('div', { class: 'card' });
    for (const key of ATTRIBUTE_KEYS) {
      const meta = ATTRIBUTE_META[key];
      const val = p.attributes[key];
      const shortKey = `attr.short.${key}`;
      attrCard.appendChild(
        el('div', { class: 'attr-row' }, [
          el('div', { class: 'attr-name', style: `color:${meta.color}`, text: t(shortKey, {}, meta.short) }),
          el('div', { class: 'attr-bar' }, [
            el('i', { style: `width:${(val / ATTRIBUTE_CAP) * 100}%;background:${meta.color}` }),
          ]),
          el('div', { class: 'attr-val', text: faNum(val) }),
        ]),
      );
    }
    body.appendChild(attrCard);

    // Lifetime stats.
    body.appendChild(el('div', { class: 'section-label', text: t('profile.lifetime') }));
    body.appendChild(
      el('div', { class: 'card' }, [
        infoRow(t('profile.time_played'), formatDuration(save.stats.totalPlaySeconds)),
        infoRow(t('profile.total_xp'), faNum(save.stats.totalXpEarned)),
        infoRow(t('profile.total_coins'), `🪙${faNum(save.stats.totalCoinsEarned)}`),
        infoRow(t('profile.damage_dealt'), faNum(Math.round(save.stats.totalDamageDealt))),
        infoRow(t('profile.skills_unlocked'), faNum(p.unlockedSkills.length)),
        infoRow(t('profile.moves_known'), faNum(p.unlockedMoves.length)),
        infoRow(t('profile.career_started'), new Date(p.createdAt).toLocaleDateString('fa-IR')),
      ]),
    );

    // Titles.
    if (save.league.titlesHeld.length > 0) {
      body.appendChild(el('div', { class: 'section-label', text: t('profile.titles') }));
      const tCard = el('div', { class: 'card' });
      for (const title of save.league.titlesHeld) {
        const isWorld = title.startsWith('world');
        const isClub = title.startsWith('club');
        tCard.appendChild(
          el('div', { class: 'row', style: 'gap:8px;padding:5px 0' }, [
            el('span', { text: isWorld ? '👑' : isClub ? '🛡️' : '🏆' }),
            el('span', {
              style: 'font-size:12.5px;font-weight:700',
              text: isWorld
                ? t('profile.world_champ')
                : isClub
                  ? t('profile.club_champ')
                  : t('profile.tournament_champ'),
            }),
          ]),
        );
      }
      body.appendChild(tCard);
    }
  };

  // ------------------------------------------------------------ achievements
  const drawAchievements = (): void => {
    const owned = new Map(save.achievements.map((a) => [a.id, a.unlockedAt]));
    const unlocked = ACHIEVEMENTS.filter((a) => owned.has(a.id));
    const locked = ACHIEVEMENTS.filter((a) => !owned.has(a.id));

    body.appendChild(
      el('div', { class: 'card', style: 'text-align:center' }, [
        el('div', {
          style: 'font-family:var(--font-display);font-size:32px;color:var(--gold)',
          text: `${faNum(unlocked.length)} / ${faNum(ACHIEVEMENTS.length)}`,
        }),
        el('div', { class: 'tiny', text: t('profile.unlocked_achs') }),
        el('div', { class: 'bar', style: 'margin-top:10px' }, [
          el('i', { style: `width:${(unlocked.length / ACHIEVEMENTS.length) * 100}%;background:var(--gold)` }),
        ]),
      ]),
    );

    if (unlocked.length) {
      body.appendChild(el('div', { class: 'section-label', text: t('profile.unlocked') }));
      for (const a of unlocked) body.appendChild(achievementCard(a, true, owned.get(a.id)));
    }
    body.appendChild(el('div', { class: 'section-label', text: t('profile.locked') }));
    for (const a of locked) body.appendChild(achievementCard(a, false));
  };

  // ---------------------------------------------------------------- history
  const drawHistory = (): void => {
    if (save.history.length === 0) {
      body.appendChild(
        el('div', { class: 'empty-state' }, [
          el('div', { class: 'icon', text: '📋' }),
          el('div', { text: t('profile.empty_history') }),
        ]),
      );
      return;
    }
    for (const h of save.history) {
      body.appendChild(
        el('div', { class: 'card', style: 'padding:11px' }, [
          el('div', {
            class: 'card-accent',
            style: `background:${h.won ? 'var(--green)' : 'var(--red)'}`,
          }),
          el('div', { class: 'row between' }, [
            el('div', { class: 'grow' }, [
              el('div', { style: 'font-size:13px;font-weight:800' }, [
                el('span', { style: `color:${h.won ? 'var(--green)' : 'var(--red)'}`, text: h.won ? t('profile.w_short') : t('profile.l_short') }),
                document.createTextNode(`  ${t('profile.vs')} ${h.opponent}`),
              ]),
              el('div', { class: 'tiny', text: `${faMethod(h.method)} · ${faNum(h.scoreFor)}–${faNum(h.scoreAgainst)} · ${formatRelative(h.at)}` }),
            ]),
            el('div', { style: 'text-align:right;font-size:10.5px' }, [
              el('div', { style: 'color:var(--blue);font-weight:700', text: `+${faNum(h.xp)} ${t('result.xp', { n: '' }).trim()}` }),
              el('div', { style: 'color:var(--gold);font-weight:700', text: `🪙${faNum(h.coins)}` }),
            ]),
          ]),
        ]),
      );
    }
  };

  draw();
  app.mount(screen);
};

const faMethod = (m: string): string => {
  const k =
    m === 'By pinfall' ? 'result.method.pin'
    : m === 'By submission' ? 'result.method.submission'
    : m === 'By stoppage' ? 'result.method.knockout'
    : m === 'By forfeit' ? 'result.method.retired'
    : m === 'On points' ? 'result.method.points'
    : m === 'Drawn on points' ? 'result.method.draw_points'
    : null;
  return k ? t(k) : m;
};

const achievementCard = (
  a: (typeof ACHIEVEMENTS)[number],
  unlocked: boolean,
  at?: number,
): HTMLElement => {
  const key = `ach.${a.id}`;
  const name = t(`${key}.name`, {}, a.name);
  const desc = t(`${key}.desc`, {}, a.description);
  return el('div', { class: `card ${unlocked ? '' : 'locked'}`, style: 'padding:11px' }, [
    el('div', { class: 'row' }, [
      el('div', {
        style: `width:38px;height:38px;flex-shrink:0;border-radius:11px;display:grid;place-items:center;font-size:19px;background:rgba(0,0,0,.32);border:1px solid ${unlocked ? 'rgba(251,191,36,.4)' : 'var(--line)'}`,
        text: unlocked ? a.icon : '🔒',
      }),
      el('div', { class: 'grow' }, [
        el('div', { style: 'font-size:13px;font-weight:800', text: name }),
        el('div', { class: 'tiny', text: desc }),
        unlocked && at ? el('div', { class: 'tiny', style: 'opacity:.6', text: formatRelative(at) }) : null,
      ]),
      el('div', { style: 'font-size:10.5px;font-weight:800;color:var(--gold);text-align:right' }, [
        document.createTextNode(`🪙${faNum(a.coins)}`),
      ]),
    ]),
  ]);
};

const statBox = (v: string, l: string): HTMLElement =>
  el('div', { class: 'stat-box' }, [el('div', { class: 'v', text: v }), el('div', { class: 'l', text: l })]);

const infoRow = (label: string, value: string): HTMLElement =>
  el('div', { class: 'row between', style: 'padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)' }, [
    el('span', { class: 'tiny', text: label }),
    el('span', { style: 'font-size:12px;font-weight:700', text: value }),
  ]);

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return t('dur.hm', { h: faNum(h), m: faNum(m) }, `${h}h ${m}m`);
  return t('dur.m', { m: faNum(m) }, `${m}m`);
};
