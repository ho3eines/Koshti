import { audio } from '../../engine/audio';
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
        document.createTextNode('‹'),
      ]),
      el('h1', {}, [
        document.createTextNode('PROFILE'),
        el('span', { class: 'sub', text: `${div.name} · ${club?.name ?? 'Independent'}` }),
      ]),
    ]),
  );

  const tabs = el('div', { class: 'tree-tabs' });
  const body = el('div', { class: 'screen-body' });
  screen.appendChild(tabs);
  screen.appendChild(body);

  const drawTabs = (): void => {
    tabs.replaceChildren();
    for (const t of [
      { id: 'overview' as const, label: 'Overview' },
      { id: 'achievements' as const, label: `Awards ${save.achievements.length}/${ACHIEVEMENTS.length}` },
      { id: 'history' as const, label: 'History' },
    ]) {
      const btn = el('button', { class: `tree-tab ${tab === t.id ? 'active' : ''}`, text: t.label });
      btn.addEventListener('click', () => {
        audio.play('ui_tap');
        tab = t.id;
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
            el('div', { style: 'font-family:var(--font-display);font-size:22px;letter-spacing:.5px', text: p.name }),
            el('div', { class: 'tiny', text: `Level ${p.level} · ${style.name}` }),
            el('span', { class: 'style-pill', style: `color:${style.color}`, text: div.name }),
          ]),
          el('div', { style: 'text-align:center' }, [
            el('div', { style: `font-family:var(--font-display);font-size:34px;line-height:1;color:${div.color}`, text: String(rating) }),
            el('div', { style: 'font-size:8px;letter-spacing:1.4px;color:var(--text-faint)', text: 'OVERALL' }),
          ]),
        ]),
        el('div', { style: 'margin-top:12px' }, [
          el('div', { class: 'bar-label' }, [
            el('span', { text: 'Experience' }),
            el('b', { text: `${p.xp} / ${xpNeeded}` }),
          ]),
          el('div', { class: 'bar xp' }, [el('i', { style: `width:${(p.xp / xpNeeded) * 100}%` })]),
        ]),
      ]),
    );

    // Career record.
    body.appendChild(el('div', { class: 'section-label', text: 'Career record' }));
    body.appendChild(
      el('div', { class: 'card' }, [
        el('div', { class: 'stat-grid' }, [
          statBox(String(save.record.wins), 'Wins'),
          statBox(String(save.record.losses), 'Losses'),
          statBox(`${winRate}%`, 'Win Rate'),
          statBox(String(save.record.pins), 'Pinfalls'),
          statBox(String(save.record.submissions), 'Submissions'),
          statBox(String(save.record.knockouts), 'Stoppages'),
          statBox(String(save.record.bestStreak), 'Best Streak'),
          statBox(String(save.record.totalReversals), 'Reversals'),
          statBox(String(save.record.finishersLanded), 'Finishers'),
        ]),
      ]),
    );

    // Attributes.
    body.appendChild(el('div', { class: 'section-label', text: 'Attributes' }));
    const attrCard = el('div', { class: 'card' });
    for (const key of ATTRIBUTE_KEYS) {
      const meta = ATTRIBUTE_META[key];
      const val = p.attributes[key];
      attrCard.appendChild(
        el('div', { class: 'attr-row' }, [
          el('div', { class: 'attr-name', style: `color:${meta.color}`, text: meta.short }),
          el('div', { class: 'attr-bar' }, [
            el('i', { style: `width:${(val / ATTRIBUTE_CAP) * 100}%;background:${meta.color}` }),
          ]),
          el('div', { class: 'attr-val', text: String(val) }),
        ]),
      );
    }
    body.appendChild(attrCard);

    // Lifetime stats.
    body.appendChild(el('div', { class: 'section-label', text: 'Lifetime' }));
    body.appendChild(
      el('div', { class: 'card' }, [
        infoRow('Time played', formatDuration(save.stats.totalPlaySeconds)),
        infoRow('Total XP earned', save.stats.totalXpEarned.toLocaleString()),
        infoRow('Total coins earned', `🪙${save.stats.totalCoinsEarned.toLocaleString()}`),
        infoRow('Damage dealt', Math.round(save.stats.totalDamageDealt).toLocaleString()),
        infoRow('Skills unlocked', String(p.unlockedSkills.length)),
        infoRow('Moves known', String(p.unlockedMoves.length)),
        infoRow('Career started', new Date(p.createdAt).toLocaleDateString()),
      ]),
    );

    // Titles.
    if (save.league.titlesHeld.length > 0) {
      body.appendChild(el('div', { class: 'section-label', text: 'Titles' }));
      const t = el('div', { class: 'card' });
      for (const title of save.league.titlesHeld) {
        t.appendChild(
          el('div', { class: 'row', style: 'gap:8px;padding:5px 0' }, [
            el('span', { text: title.startsWith('world') ? '👑' : title.startsWith('club') ? '🛡️' : '🏆' }),
            el('span', { style: 'font-size:12.5px;font-weight:700', text: title.startsWith('world') ? 'World Champion' : title.startsWith('club') ? 'Club Champion' : 'Tournament Champion' }),
          ]),
        );
      }
      body.appendChild(t);
    }
  };

  // ------------------------------------------------------------ achievements
  const drawAchievements = (): void => {
    const owned = new Map(save.achievements.map((a) => [a.id, a.unlockedAt]));
    const unlocked = ACHIEVEMENTS.filter((a) => owned.has(a.id));
    const locked = ACHIEVEMENTS.filter((a) => !owned.has(a.id));

    body.appendChild(
      el('div', { class: 'card', style: 'text-align:center' }, [
        el('div', { style: 'font-family:var(--font-display);font-size:32px;color:var(--gold)', text: `${unlocked.length} / ${ACHIEVEMENTS.length}` }),
        el('div', { class: 'tiny', text: 'Achievements unlocked' }),
        el('div', { class: 'bar', style: 'margin-top:10px' }, [
          el('i', { style: `width:${(unlocked.length / ACHIEVEMENTS.length) * 100}%;background:var(--gold)` }),
        ]),
      ]),
    );

    if (unlocked.length) {
      body.appendChild(el('div', { class: 'section-label', text: 'Unlocked' }));
      for (const a of unlocked) body.appendChild(achievementCard(a, true, owned.get(a.id)));
    }
    body.appendChild(el('div', { class: 'section-label', text: 'Locked' }));
    for (const a of locked) body.appendChild(achievementCard(a, false));
  };

  // ---------------------------------------------------------------- history
  const drawHistory = (): void => {
    if (save.history.length === 0) {
      body.appendChild(
        el('div', { class: 'empty-state' }, [
          el('div', { class: 'icon', text: '📋' }),
          el('div', { text: 'No matches yet. Your career log will appear here.' }),
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
                el('span', { style: `color:${h.won ? 'var(--green)' : 'var(--red)'}`, text: h.won ? 'W' : 'L' }),
                document.createTextNode(`  vs ${h.opponent}`),
              ]),
              el('div', { class: 'tiny', text: `${h.method} · ${h.scoreFor}–${h.scoreAgainst} · ${formatRelative(h.at)}` }),
            ]),
            el('div', { style: 'text-align:right;font-size:10.5px' }, [
              el('div', { style: 'color:var(--blue);font-weight:700', text: `+${h.xp} XP` }),
              el('div', { style: 'color:var(--gold);font-weight:700', text: `🪙${h.coins}` }),
            ]),
          ]),
        ]),
      );
    }
  };

  draw();
  app.mount(screen);
};

const achievementCard = (
  a: (typeof ACHIEVEMENTS)[number],
  unlocked: boolean,
  at?: number,
): HTMLElement =>
  el('div', { class: `card ${unlocked ? '' : 'locked'}`, style: 'padding:11px' }, [
    el('div', { class: 'row' }, [
      el('div', {
        style: `width:38px;height:38px;flex-shrink:0;border-radius:11px;display:grid;place-items:center;font-size:19px;background:rgba(0,0,0,.32);border:1px solid ${unlocked ? 'rgba(251,191,36,.4)' : 'var(--line)'}`,
        text: unlocked ? a.icon : '🔒',
      }),
      el('div', { class: 'grow' }, [
        el('div', { style: 'font-size:13px;font-weight:800', text: a.name }),
        el('div', { class: 'tiny', text: a.description }),
        unlocked && at ? el('div', { class: 'tiny', style: 'opacity:.6', text: formatRelative(at) }) : null,
      ]),
      el('div', { style: 'font-size:10.5px;font-weight:800;color:var(--gold);text-align:right' }, [
        document.createTextNode(`🪙${a.coins}`),
      ]),
    ]),
  ]);

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
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
