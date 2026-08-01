import { audio } from '../../engine/audio';
import type { App } from '../../game/app';
import {
  ATTRIBUTE_CAP,
  ATTRIBUTE_KEYS,
  ATTRIBUTE_META,
  overallRating,
  type AttributeKey,
} from '../../game/data/attributes';
import { BRANCH_META, SKILL_BY_ID, SKILL_TREE, type SkillBranch } from '../../game/data/skills';
import { getMove, hasMove } from '../../game/data/moves';
import { purchaseSkill, trainAttribute, trainAttributeCost } from '../../game/career/progression';
import { el } from '../dom';
import { toast } from '../toast';

/** Skill tree + attribute training + loadout. */
export const renderSkills = (app: App): void => {
  audio.playMusic('menu');
  let tab: SkillBranch | 'attributes' | 'moves' = 'attributes';

  const screen = el('div', { class: 'screen overlay-bg' });
  const header = el('div', { class: 'topbar' });
  const tabsRow = el('div', { class: 'tree-tabs' });
  const body = el('div', { class: 'screen-body' });
  screen.appendChild(header);
  screen.appendChild(tabsRow);
  screen.appendChild(body);

  const drawHeader = (): void => {
    const save = app.requireSave();
    header.replaceChildren(
      el('button', { class: 'icon-btn', onclick: () => { audio.play('ui_back'); app.go('hub'); } }, [
        document.createTextNode('‹'),
      ]),
      el('h1', {}, [
        document.createTextNode('DEVELOPMENT'),
        el('span', { class: 'sub', text: `Overall ${overallRating(save.profile.attributes)}` }),
      ]),
      el('span', { class: 'chip purple', text: `✦ ${save.profile.skillPoints}` }),
      el('span', { class: 'chip gold', text: `🪙 ${save.profile.coins.toLocaleString()}` }),
    );
  };

  const drawTabs = (): void => {
    tabsRow.replaceChildren();
    const tabs: Array<{ id: typeof tab; label: string; color: string }> = [
      { id: 'attributes', label: 'Stats', color: '#38bdf8' },
      { id: 'power', label: 'Power', color: BRANCH_META.power.color },
      { id: 'technique', label: 'Tech', color: BRANCH_META.technique.color },
      { id: 'conditioning', label: 'Cond', color: BRANCH_META.conditioning.color },
      { id: 'showmanship', label: 'Show', color: BRANCH_META.showmanship.color },
      { id: 'moves', label: 'Moves', color: '#fbbf24' },
    ];
    for (const t of tabs) {
      const btn = el('button', {
        class: `tree-tab ${tab === t.id ? 'active' : ''}`,
        style: `--tc:${t.color}`,
        text: t.label,
      });
      btn.addEventListener('click', () => {
        audio.play('ui_tap');
        tab = t.id;
        draw();
      });
      tabsRow.appendChild(btn);
    }
  };

  const draw = (): void => {
    drawHeader();
    drawTabs();
    body.replaceChildren();
    if (tab === 'attributes') drawAttributes();
    else if (tab === 'moves') drawMoves();
    else drawBranch(tab);
  };

  // ------------------------------------------------------------ attributes
  const drawAttributes = (): void => {
    const save = app.requireSave();
    body.appendChild(
      el('p', {
        class: 'hint',
        style: 'text-align:left;margin-bottom:12px',
        text: 'Spend coins to grind out permanent attribute gains. Costs rise as you approach the cap.',
      }),
    );

    const card = el('div', { class: 'card' });
    for (const key of ATTRIBUTE_KEYS) {
      const meta = ATTRIBUTE_META[key];
      const val = save.profile.attributes[key];
      const cost = trainAttributeCost(val);
      const affordable = save.profile.coins >= cost && val < ATTRIBUTE_CAP;

      const btn = el('button', {
        class: 'attr-train',
        disabled: !affordable,
        title: `Train for ${cost} coins`,
      }, [document.createTextNode('+')]);

      btn.addEventListener('click', () => {
        const res = trainAttribute(save, key);
        if (!res.ok) {
          audio.play('ui_error');
          toast.show(res.reason ?? 'Cannot train', 'red');
          return;
        }
        audio.play('coin');
        toast.show(`${meta.label} +1 (🪙${res.cost})`, 'green', 1600);
        void app.commit(`Trained ${meta.label}`);
        draw();
      });

      card.appendChild(
        el('div', { class: 'attr-row' }, [
          el('div', { class: 'attr-name', style: `color:${meta.color}`, text: meta.short }),
          el('div', { class: 'attr-bar' }, [
            el('i', { style: `width:${(val / ATTRIBUTE_CAP) * 100}%;background:${meta.color}` }),
          ]),
          el('div', { class: 'attr-val', text: String(val) }),
          el('div', { style: 'font-size:9.5px;color:var(--gold);width:38px;text-align:right', text: val >= ATTRIBUTE_CAP ? 'MAX' : `🪙${cost}` }),
          btn,
        ]),
      );
    }
    body.appendChild(card);

    body.appendChild(el('div', { class: 'section-label', text: 'What they do' }));
    const info = el('div', { class: 'card' });
    for (const key of ATTRIBUTE_KEYS) {
      const meta = ATTRIBUTE_META[key];
      info.appendChild(
        el('div', { style: 'padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)' }, [
          el('div', { style: `font-size:12px;font-weight:800;color:${meta.color}`, text: meta.label }),
          el('div', { class: 'tiny', text: meta.blurb }),
        ]),
      );
    }
    body.appendChild(info);
  };

  // ----------------------------------------------------------- skill branch
  const drawBranch = (branch: SkillBranch): void => {
    const save = app.requireSave();
    const meta = BRANCH_META[branch];
    const owned = new Set(save.profile.unlockedSkills);
    const nodes = SKILL_TREE.filter((n) => n.branch === branch).sort((a, b) => a.tier - b.tier);

    body.appendChild(
      el('div', { class: 'row between', style: 'margin-bottom:10px' }, [
        el('div', { style: `font-family:var(--font-display);font-size:18px;color:${meta.color}`, text: meta.name.toUpperCase() }),
        el('span', { class: 'tiny', text: `${nodes.filter((n) => owned.has(n.id)).length}/${nodes.length} unlocked` }),
      ]),
    );

    let lastTier = -1;
    for (const node of nodes) {
      if (node.tier !== lastTier) {
        lastTier = node.tier;
        body.appendChild(
          el('div', { class: 'section-label', style: 'margin:12px 0 6px', text: `Tier ${node.tier + 1}` }),
        );
      }

      const isOwned = owned.has(node.id);
      const reqMet = node.requires.every((r) => owned.has(r));
      const affordable = save.profile.skillPoints >= node.cost;
      const state = isOwned ? 'owned' : reqMet && affordable ? 'available' : 'locked';

      const card = el('div', { class: `skill-node ${state}`, style: `--nc:${meta.color}` }, [
        el('div', { class: 'skill-icon', style: isOwned ? `border-color:${meta.color}66` : '', text: node.icon }),
        el('div', { class: 'skill-body' }, [
          el('h4', { text: node.name }),
          el('p', { text: node.description }),
          !reqMet && !isOwned
            ? el('p', {
                style: 'color:var(--red);font-size:10.5px;margin-top:3px',
                text: `Requires: ${node.requires.map((r) => SKILL_BY_ID.get(r)?.name ?? r).join(', ')}`,
              })
            : null,
        ]),
        el('div', { class: 'skill-cost', text: isOwned ? '✓' : `${node.cost} SP` }),
      ]);

      if (state === 'available') {
        card.addEventListener('click', () => {
          const res = purchaseSkill(save, node.id);
          if (!res.ok) {
            audio.play('ui_error');
            toast.show(res.reason ?? 'Cannot unlock', 'red');
            return;
          }
          audio.play('unlock');
          toast.show(`Unlocked: ${node.name}`, 'gold', 2800, node.icon);
          void app.commit(`Unlocked ${node.name}`);
          draw();
        });
      }
      body.appendChild(card);
    }
  };

  // ------------------------------------------------------------------ moves
  const drawMoves = (): void => {
    const save = app.requireSave();
    const moves = save.profile.unlockedMoves.filter(hasMove).map((id) => getMove(id));
    const byRange = {
      standing: moves.filter((m) => m.range === 'standing'),
      clinch: moves.filter((m) => m.range === 'clinch'),
      ground: moves.filter((m) => m.range === 'ground'),
    };

    body.appendChild(
      el('p', {
        class: 'hint',
        style: 'text-align:left;margin-bottom:10px',
        text: 'Your full moveset. Moves are contextual — only the ones matching your current position appear during a match.',
      }),
    );

    for (const [range, list] of Object.entries(byRange)) {
      body.appendChild(el('div', { class: 'section-label', text: range }));
      if (list.length === 0) {
        body.appendChild(el('div', { class: 'tiny', style: 'padding:6px 2px', text: 'No moves in this range yet — unlock them in the skill tree.' }));
        continue;
      }
      const card = el('div', { class: 'card' });
      for (const m of list) {
        const catColor =
          m.category === 'finisher'
            ? 'var(--gold)'
            : m.category === 'signature'
              ? 'var(--purple)'
              : m.category === 'throw'
                ? 'var(--accent)'
                : m.category === 'submission'
                  ? 'var(--blue)'
                  : 'var(--text-dim)';
        card.appendChild(
          el('div', { style: 'padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)' }, [
            el('div', { class: 'row between' }, [
              el('span', { style: 'font-size:13px;font-weight:800', text: m.name }),
              el('span', { class: 'style-pill', style: `color:${catColor}`, text: m.category }),
            ]),
            el('div', { class: 'tiny', style: 'margin-top:2px', text: m.description }),
            el('div', { class: 'row', style: 'gap:8px;margin-top:5px' }, [
              el('span', { class: 'tiny mono', text: `⚔ ${m.damage}` }),
              el('span', { class: 'tiny mono', text: `⚡ ${m.staminaCost}` }),
              el('span', { class: 'tiny mono', text: `🎯 ${Math.round(m.baseAccuracy * 100)}%` }),
              el('span', { class: 'tiny mono', text: `🛡 ${Math.round(m.reversalResist * 100)}%` }),
            ]),
          ]),
        );
      }
      body.appendChild(card);
    }
  };

  draw();
  app.mount(screen);
};

export type { AttributeKey };
