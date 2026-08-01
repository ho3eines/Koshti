import { audio } from '../../engine/audio';
import { t, faNum } from '../../core/i18n';
import type { App } from '../../game/app';
import {
  ATTRIBUTE_CAP,
  ATTRIBUTE_KEYS,
  ATTRIBUTE_META,
  overallRating,
  type AttributeKey,
} from '../../game/data/attributes';
import { BRANCH_META, SKILL_BY_ID, SKILL_TREE, type SkillBranch } from '../../game/data/skills';
import { getMove, hasMove, MOVES } from '../../game/data/moves';
import { purchaseSkill, trainAttribute, trainAttributeCost } from '../../game/career/progression';
import { el } from '../dom';
import { toast } from '../toast';

const SKILL_KEYS: Record<string, { name: string; desc: string }> = {
  power_root:     { name: 'skill.iron_base.name',     desc: 'skill.iron_base.desc' },
  power_grip:     { name: 'skill.vice_grip.name',     desc: 'skill.vice_grip.desc' },
  power_suplex:   { name: 'skill.suplex_mastery.name',desc: 'skill.suplex_mastery.desc' },
  power_wall:     { name: 'skill.granite_frame.name', desc: 'skill.granite_frame.desc' },
  sig_thunder_slam:{name: 'skill.sig_thunder.name',   desc: 'skill.sig_thunder.desc' },
  fin_koshti_crusher:{name:'skill.fin_koshti.name',   desc: 'skill.fin_koshti.desc' },
  tech_root:      { name: 'skill.chain_wrestling.name', desc: 'skill.chain_wrestling.desc' },
  tech_ankle_pick:{ name: 'skill.ankle_pick.name',    desc: 'skill.ankle_pick.desc' },
  tech_counter:   { name: 'skill.counter_sense.name', desc: 'skill.counter_sense.desc' },
  tech_headlock:  { name: 'skill.headlock_throw.name',desc: 'skill.headlock_throw.desc' },
  tech_guillotine:{ name: 'skill.guillotine.name',    desc: 'skill.guillotine.desc' },
  sig_lightning_roll:{name:'skill.sig_lightning.name',desc: 'skill.sig_lightning.desc' },
  fin_iron_clutch:{ name: 'skill.fin_iron.name',      desc: 'skill.fin_iron.desc' },
  cond_root:      { name: 'skill.deep_lungs.name',    desc: 'skill.deep_lungs.desc' },
  cond_recovery:  { name: 'skill.fast_recovery.name', desc: 'skill.fast_recovery.desc' },
  cond_footwork:  { name: 'skill.live_footwork.name', desc: 'skill.live_footwork.desc' },
  cond_engine:    { name: 'skill.endless_engine.name',desc: 'skill.endless_engine.desc' },
  cond_scramble:  { name: 'skill.scramble_king.name', desc: 'skill.scramble_king.desc' },
  show_root:      { name: 'skill.crowd_worker.name',  desc: 'skill.crowd_worker.desc' },
  show_momentum:  { name: 'skill.feed_roar.name',     desc: 'skill.feed_roar.desc' },
  show_sponsor:   { name: 'skill.sponsor_magnet.name',desc: 'skill.sponsor_magnet.desc' },
  show_clutch:    { name: 'skill.main_event_nerve.name', desc:'skill.main_event_nerve.desc' },
};

const sk = (id: string, fallbackName: string, fallbackDesc: string): { name: string; desc: string } => {
  const k = SKILL_KEYS[id];
  if (!k) return { name: fallbackName, desc: fallbackDesc };
  return { name: t(k.name, {}, fallbackName), desc: t(k.desc, {}, fallbackDesc) };
};

/** Localized label for a move id. */
const mvName = (id: string): string => {
  const m = MOVES.find((x) => x.id === id);
  return t(`move.${id}`, {}, m?.name ?? id);
};

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
        document.createTextNode('›'),
      ]),
      el('h1', {}, [
        document.createTextNode(t('skills.title')),
        el('span', { class: 'sub', text: t('skills.overall', { n: faNum(overallRating(save.profile.attributes)) }) }),
      ]),
      el('span', { class: 'chip purple', text: `✦ ${faNum(save.profile.skillPoints)}` }),
      el('span', { class: 'chip gold', text: `🪙 ${faNum(save.profile.coins)}` }),
    );
  };

  const drawTabs = (): void => {
    tabsRow.replaceChildren();
    const tabs: Array<{ id: typeof tab; label: string; color: string }> = [
      { id: 'attributes',  label: t('skills.tab.attributes'),  color: '#38bdf8' },
      { id: 'power',       label: t('skills.tab.power'),       color: BRANCH_META.power.color },
      { id: 'technique',   label: t('skills.tab.technique'),   color: BRANCH_META.technique.color },
      { id: 'conditioning',label: t('skills.tab.conditioning'),color: BRANCH_META.conditioning.color },
      { id: 'showmanship', label: t('skills.tab.showmanship'), color: BRANCH_META.showmanship.color },
      { id: 'moves',       label: t('skills.tab.moves'),       color: '#fbbf24' },
    ];
    for (const tt of tabs) {
      const btn = el('button', {
        class: `tree-tab ${tab === tt.id ? 'active' : ''}`,
        style: `--tc:${tt.color}`,
        text: tt.label,
      });
      btn.addEventListener('click', () => {
        audio.play('ui_tap');
        tab = tt.id;
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
        text: t('skills.attr_hint'),
      }),
    );

    const card = el('div', { class: 'card' });
    for (const key of ATTRIBUTE_KEYS) {
      const meta = ATTRIBUTE_META[key];
      const val = save.profile.attributes[key];
      const cost = trainAttributeCost(val);
      const affordable = save.profile.coins >= cost && val < ATTRIBUTE_CAP;
      const attrShort = t(`attr.short.${key}`, {}, meta.short);
      const attrLabel = t(`attr.${key}`, {}, meta.label);

      const btn = el('button', {
        class: 'attr-train',
        disabled: !affordable,
        title: t('skills.train_cost', { c: faNum(cost) }),
      }, [document.createTextNode('+')]);

      btn.addEventListener('click', () => {
        const res = trainAttribute(save, key);
        if (!res.ok) {
          audio.play('ui_error');
          toast.show(res.reason ?? t('skills.cannot_train'), 'red');
          return;
        }
        audio.play('coin');
        toast.show(t('skills.trained', { attr: attrLabel, c: faNum(res.cost ?? cost) }), 'green', 1600);
        void app.commit(`Trained ${meta.label}`);
        draw();
      });

      card.appendChild(
        el('div', { class: 'attr-row' }, [
          el('div', { class: 'attr-name', style: `color:${meta.color}`, text: attrShort }),
          el('div', { class: 'attr-bar' }, [
            el('i', { style: `width:${(val / ATTRIBUTE_CAP) * 100}%;background:${meta.color}` }),
          ]),
          el('div', { class: 'attr-val', text: faNum(val) }),
          el('div', {
            style: 'font-size:9.5px;color:var(--gold);width:48px;text-align:right',
            text: val >= ATTRIBUTE_CAP ? t('skills.max') : `🪙${faNum(cost)}`,
          }),
          btn,
        ]),
      );
    }
    body.appendChild(card);

    body.appendChild(el('div', { class: 'section-label', text: t('skills.what_they_do') }));
    const info = el('div', { class: 'card' });
    for (const key of ATTRIBUTE_KEYS) {
      const meta = ATTRIBUTE_META[key];
      const blurb = t(`attr.blurb.${key}`, {}, meta.blurb);
      info.appendChild(
        el('div', { style: 'padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)' }, [
          el('div', {
            style: `font-size:12px;font-weight:800;color:${meta.color}`,
            text: t(`attr.${key}`, {}, meta.label),
          }),
          el('div', { class: 'tiny', text: blurb }),
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
    const branchName = t(`skills.branch.${branch}`, {}, meta.name);

    body.appendChild(
      el('div', { class: 'row between', style: 'margin-bottom:10px' }, [
        el('div', { style: `font-family:var(--font-display);font-size:18px;color:${meta.color}`, text: branchName }),
        el('span', {
          class: 'tiny',
          text: t('skills.unlocked_count', { n: faNum(nodes.filter((n) => owned.has(n.id)).length), t: faNum(nodes.length) }),
        }),
      ]),
    );

    let lastTier = -1;
    for (const node of nodes) {
      if (node.tier !== lastTier) {
        lastTier = node.tier;
        body.appendChild(
          el('div', { class: 'section-label', style: 'margin:12px 0 6px', text: t('skills.tier', { n: faNum(node.tier + 1) }) }),
        );
      }

      const isOwned = owned.has(node.id);
      const reqMet = node.requires.every((r) => owned.has(r));
      const affordable = save.profile.skillPoints >= node.cost;
      const state = isOwned ? 'owned' : reqMet && affordable ? 'available' : 'locked';
      const localized = sk(node.id, node.name, node.description);

      const card = el('div', { class: `skill-node ${state}`, style: `--nc:${meta.color}` }, [
        el('div', { class: 'skill-icon', style: isOwned ? `border-color:${meta.color}66` : '', text: node.icon }),
        el('div', { class: 'skill-body' }, [
          el('h4', { text: localized.name }),
          el('p', { text: localized.desc }),
          !reqMet && !isOwned
            ? el('p', {
                style: 'color:var(--red);font-size:10.5px;margin-top:3px',
                text: t('skills.requires', {
                  list: node.requires
                    .map((r) => {
                      const sk2 = SKILL_BY_ID.get(r);
                      const l2 = sk2 ? sk(r, sk2.name, sk2.description) : { name: r, desc: '' };
                      return l2.name;
                    })
                    .join('، '),
                }),
              })
            : null,
        ]),
        el('div', { class: 'skill-cost', text: isOwned ? '✓' : `✦${faNum(node.cost)}` }),
      ]);

      if (state === 'available') {
        card.addEventListener('click', () => {
          const res = purchaseSkill(save, node.id);
          if (!res.ok) {
            audio.play('ui_error');
            toast.show(res.reason ?? t('skills.cannot_unlock'), 'red');
            return;
          }
          audio.play('unlock');
          toast.show(t('skills.unlocked_new', { n: localized.name }), 'gold', 2800, node.icon);
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
        text: t('skills.moves_hint'),
      }),
    );

    for (const [range, list] of Object.entries(byRange)) {
      body.appendChild(el('div', { class: 'section-label', text: t(`range.${range}`, {}, range) }));
      if (list.length === 0) {
        body.appendChild(el('div', { class: 'tiny', style: 'padding:6px 2px', text: t('skills.no_moves') }));
        continue;
      }
      const card = el('div', { class: 'card' });
      for (const mv of list) {
        const catColor =
          mv.category === 'finisher'
            ? 'var(--gold)'
            : mv.category === 'signature'
              ? 'var(--purple)'
              : mv.category === 'throw'
                ? 'var(--accent)'
                : mv.category === 'submission'
                  ? 'var(--blue)'
                  : 'var(--text-dim)';
        const catLabel = t(`cat.${mv.category}`, {}, mv.category);
        card.appendChild(
          el('div', { style: 'padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)' }, [
            el('div', { class: 'row between' }, [
              el('span', { style: 'font-size:13px;font-weight:800', text: mvName(mv.id) }),
              el('span', { class: 'style-pill', style: `color:${catColor}`, text: catLabel }),
            ]),
            el('div', { class: 'tiny', style: 'margin-top:2px', text: mv.description }),
            el('div', { class: 'row', style: 'gap:8px;margin-top:5px' }, [
              el('span', { class: 'tiny mono', text: t('mv.damage', { n: faNum(mv.damage) }) }),
              el('span', { class: 'tiny mono', text: t('mv.stamina', { n: faNum(mv.staminaCost) }) }),
              el('span', { class: 'tiny mono', text: t('mv.accuracy', { n: faNum(Math.round(mv.baseAccuracy * 100)) }) }),
              el('span', { class: 'tiny mono', text: t('mv.resist', { n: faNum(Math.round(mv.reversalResist * 100)) }) }),
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
