import { audio } from '../../engine/audio';
import { t } from '../../core/i18n';
import type { App } from '../../game/app';
import { STYLE_LIST, type FightingStyle } from '../../game/data/styles';
import { CLUBS } from '../../game/data/leagues';
import { clear, el, formatRelative } from '../dom';
import { toast } from '../toast';

/**
 * First-run flow: title → name entry → style pick → club pick → career start.
 * Also serves as the "continue or new career" gate on subsequent launches.
 */
export const renderOnboarding = (app: App): void => {
  const screen = el('div', { class: 'screen overlay-bg' });
  const body = el('div', { class: 'screen-body' });
  screen.appendChild(body);
  app.mount(screen);

  let step: 'gate' | 'name' | 'style' | 'club' = 'gate';
  let name = '';
  let style: FightingStyle = 'allround';
  let clubId: string | null = null;

  const unlockAudio = () => void audio.unlock();

  const draw = (): void => {
    clear(body);
    switch (step) {
      case 'gate':
        drawGate();
        break;
      case 'name':
        drawName();
        break;
      case 'style':
        drawStyle();
        break;
      case 'club':
        drawClub();
        break;
    }
  };

  // ------------------------------------------------------------------ gate
  const drawGate = (): void => {
    void app.saves.peek().then((meta) => {
      clear(body);
      const wrap = el('div', { class: 'onboard' });

      wrap.appendChild(el('div', { class: 'onboard-logo', text: t('app.title') }));
      wrap.appendChild(el('div', { class: 'onboard-tag', text: t('app.subtitle') }));

      if (meta.exists) {
        wrap.appendChild(
          el('div', { class: 'card', style: 'text-align:start;margin-top:18px' }, [
            el('div', { class: 'section-label', text: t('onboard.continue') }),
            el('div', { class: 'row between' }, [
              el('div', { class: 'grow' }, [
                el('div', { class: 'card-title', text: meta.name ?? t('onboard.begin') }),
                el('p', {
                  class: 'card-sub',
                  text: `${t(`div.${meta.division ?? 'amateur'}`)} · سطح ${meta.level ?? 1} · ${formatRelative(meta.savedAt ?? Date.now())}`,
                }),
              ]),
            ]),
            el('div', { class: 'tiny', style: 'margin-top:8px;opacity:.7' }, [
              document.createTextNode(`${meta.label ?? 'Autosave'}`),
            ]),
          ]),
        );

        wrap.appendChild(
          el(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                unlockAudio();
                audio.play('ui_confirm');
                const save = await app.saves.load();
                if (!save) {
                  toast.show(t('onboard.save_bad'), 'red');
                  return;
                }
                app.save = save;
                app.saves.attach(save);
                app.applyAudioSettings();
                app.applyInputSettings();
                app.applyGraphicsSettings();
                audio.playMusic('menu');
                const resume = save.checkpoint.screen;
                app.go(resume === 'match' || resume === 'results' ? 'hub' : resume);
              },
            },
            [document.createTextNode(t('onboard.continue'))],
          ),
        );

        wrap.appendChild(
          el(
            'button',
            {
              class: 'btn secondary',
              onclick: () => {
                unlockAudio();
                audio.play('ui_tap');
                confirmNewCareer();
              },
            },
            [document.createTextNode(t('onboard.new'))],
          ),
        );
      } else {
        wrap.appendChild(
          el('p', {
            class: 'hint',
            style: 'margin-top:14px',
            text: t('onboard.intro'),
          }),
        );
        wrap.appendChild(
          el(
            'button',
            {
              class: 'btn',
              style: 'margin-top:12px',
              onclick: () => {
                unlockAudio();
                audio.play('ui_confirm');
                audio.playMusic('menu');
                step = 'name';
                draw();
              },
            },
            [document.createTextNode(t('onboard.begin'))],
          ),
        );
      }

      wrap.appendChild(
        el('div', { class: 'tiny center', style: 'margin-top:14px;opacity:.55' }, [
          document.createTextNode(
            `${app.caps.isMobile ? 'Mobile' : 'Desktop'} · GPU tier ${app.caps.gpuTier} · ${app.caps.memoryGB}GB`,
          ),
        ]),
      );

      body.appendChild(wrap);
    });
  };

  const confirmNewCareer = (): void => {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const modal = el('div', { class: 'modal' }, [
      el('h2', { text: t('onboard.confirm_wipe_title') }),
      el('p', { text: t('onboard.confirm_wipe_body') }),
      el('div', { class: 'btn-row' }, [
        el(
          'button',
          {
            class: 'btn secondary',
            onclick: () => {
              audio.play('ui_back');
              backdrop.remove();
            },
          },
          [document.createTextNode(t('onboard.cancel'))],
        ),
        el(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              audio.play('ui_confirm');
              await app.saves.wipe();
              backdrop.remove();
              step = 'name';
              draw();
            },
          },
          [document.createTextNode(t('onboard.erase'))],
        ),
      ]),
    ]);
    backdrop.appendChild(modal);
    app.mount(backdrop);
  };

  // ------------------------------------------------------------------ name
  const drawName = (): void => {
    const wrap = el('div', { class: 'onboard' });
    wrap.appendChild(el('div', { class: 'onboard-logo', text: t('app.title') }));
    wrap.appendChild(
      el('p', { class: 'hint', text: t('onboard.name_prompt') }),
    );

    const input = el('input', {
      class: 'name-input',
      type: 'text',
      placeholder: t('onboard.name_placeholder'),
      maxlength: 20,
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
    }) as HTMLInputElement;

    const next = el('button', { class: 'btn', disabled: true }, [
      document.createTextNode(t('onboard.next')),
    ]) as HTMLButtonElement;

    const validate = (): void => {
      name = input.value.trim();
      const ok = name.length >= 2 && name.length <= 20;
      next.disabled = !ok;
      err.textContent = name.length > 0 && name.length < 2 ? t('onboard.name_min') : '';
    };

    const err = el('div', { class: 'tiny', style: 'color:var(--red);min-height:16px' });

    input.addEventListener('input', validate);
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && !next.disabled) next.click();
    });

    next.addEventListener('click', () => {
      audio.play('ui_confirm');
      input.blur();
      step = 'style';
      draw();
    });

    wrap.appendChild(input);
    wrap.appendChild(err);
    wrap.appendChild(next);
    wrap.appendChild(
      el('p', {
        class: 'hint',
        style: 'margin-top:4px',
        text: t('onboard.name_hint'),
      }),
    );

    body.appendChild(wrap);
    globalThis.setTimeout(() => input.focus(), 260);
  };

  // ----------------------------------------------------------------- style
  const drawStyle = (): void => {
    const wrap = el('div', { class: 'onboard', style: 'justify-content:flex-start;padding-top:24px' });
    wrap.appendChild(
      el('h1', {
        style: 'font-family:var(--font-display);font-size:26px;margin:0',
        text: t('onboard.welcome', { name: name.toUpperCase() }),
      }),
    );
    wrap.appendChild(
      el('p', { class: 'hint', text: t('onboard.style_blurb') }),
    );

    const grid = el('div', { class: 'style-grid', style: 'margin-top:6px' });
    const cards: HTMLElement[] = [];
    for (const s of STYLE_LIST) {
      const card = el('button', { class: 'style-card', style: `--sc:${s.color}` }, [
        el('h4', { text: t(`style.${s.id}`) }),
        el('p', { text: t(`style.${s.id}.blurb`) }),
      ]);
      card.addEventListener('click', () => {
        audio.play('ui_tap');
        style = s.id;
        for (const c of cards) c.classList.remove('selected');
        card.classList.add('selected');
        nextBtn.disabled = false;
      });
      cards.push(card);
      grid.appendChild(card);
    }
    wrap.appendChild(grid);

    const nextBtn = el('button', { class: 'btn', style: 'margin-top:14px', disabled: true }, [
      document.createTextNode(t('onboard.next')),
    ]) as HTMLButtonElement;
    nextBtn.addEventListener('click', () => {
      audio.play('ui_confirm');
      step = 'club';
      draw();
    });
    wrap.appendChild(nextBtn);
    wrap.appendChild(
      el('button', {
        class: 'btn ghost',
        onclick: () => { audio.play('ui_back'); step = 'name'; draw(); },
      }, [document.createTextNode(t('onboard.back'))]),
    );
    body.appendChild(wrap);
  };

  // ------------------------------------------------------------------ club
  const drawClub = (): void => {
    const wrap = el('div', { class: 'onboard', style: 'justify-content:flex-start;padding-top:24px' });
    wrap.appendChild(
      el('h1', {
        style: 'font-family:var(--font-display);font-size:24px;margin:0',
        text: t('onboard.choose_club'),
      }),
    );
    wrap.appendChild(
      el('p', { class: 'hint', text: t('onboard.club_blurb') }),
    );

    const list = el('div', { style: 'text-align:start;margin-top:6px' });
    const cards: HTMLElement[] = [];
    for (const c of CLUBS) {
      const card = el('div', { class: 'card interactive', style: `--sc:${c.colors[0]}` }, [
        el('div', { class: 'card-accent', style: `background:${c.colors[0]}` }),
        el('div', { class: 'row between' }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'card-title', text: c.name_fa ?? c.name }),
            el('p', { class: 'card-sub', text: `${c.city_fa ?? c.city} · «${c.motto_fa ?? c.motto}»` }),
          ]),
          el('div', {
            class: 'style-pill',
            style: `color:${c.colors[0]}`,
            text: t(`style.${c.style}`),
          }),
        ]),
      ]);
      card.addEventListener('click', () => {
        audio.play('ui_tap');
        clubId = c.id;
        for (const x of cards) x.style.borderColor = '';
        card.style.borderColor = c.colors[0];
        startBtn.disabled = false;
      });
      cards.push(card);
      list.appendChild(card);
    }
    wrap.appendChild(list);

    const startBtn = el('button', { class: 'btn gold', disabled: true }, [
      document.createTextNode(t('onboard.start')),
    ]) as HTMLButtonElement;

    startBtn.addEventListener('click', async () => {
      audio.play('levelup');
      startBtn.disabled = true;
      startBtn.textContent = t('onboard.creating');
      const save = await app.createCareer(name);
      save.profile.style = style;
      save.profile.clubId = clubId;
      const bias: Record<FightingStyle, Partial<Record<string, number>>> = {
        power: { strength: 6, defense: 3, speed: -2 },
        technical: { technique: 6, defense: 2, strength: -2 },
        speed: { speed: 6, stamina: 3, strength: -3 },
        allround: { stamina: 2, technique: 2, strength: 1, speed: 1 },
      };
      for (const [k, v] of Object.entries(bias[style])) {
        const key = k as keyof typeof save.profile.attributes;
        save.profile.attributes[key] = Math.max(20, save.profile.attributes[key] + (v as number));
      }
      save.checkpoint.label = 'Career created';
      await app.commit('Career created');
      toast.show(t('match.welcome_toast', { name }), 'gold', 3200, '🤼');
      app.go('training', { firstTime: true });
    });

    wrap.appendChild(startBtn);
    wrap.appendChild(
      el('button', {
        class: 'btn ghost',
        onclick: () => { audio.play('ui_back'); step = 'style'; draw(); },
      }, [document.createTextNode(t('onboard.back'))]),
    );
    body.appendChild(wrap);
  };

  draw();
};
