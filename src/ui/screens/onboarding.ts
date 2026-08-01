import { audio } from '../../engine/audio';
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

      wrap.appendChild(el('div', { class: 'onboard-logo', text: 'KOSHTI' }));
      wrap.appendChild(el('div', { class: 'onboard-tag', text: 'Rise of a Champion' }));

      if (meta.exists) {
        wrap.appendChild(
          el('div', { class: 'card', style: 'text-align:left;margin-top:18px' }, [
            el('div', { class: 'section-label', text: 'Continue career' }),
            el('div', { class: 'row between' }, [
              el('div', { class: 'grow' }, [
                el('div', { class: 'card-title', text: meta.name ?? 'Wrestler' }),
                el('p', {
                  class: 'card-sub',
                  text: `Level ${meta.level ?? 1} · ${labelDivision(meta.division)} · saved ${formatRelative(meta.savedAt ?? Date.now())}`,
                }),
              ]),
            ]),
            el('div', { class: 'tiny', style: 'margin-top:8px;opacity:.7' }, [
              document.createTextNode(`Checkpoint: ${meta.label ?? 'Autosave'}`),
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
                  toast.show('Save could not be read', 'red');
                  return;
                }
                app.save = save;
                app.saves.attach(save);
                app.applyAudioSettings();
                app.applyInputSettings();
                app.applyGraphicsSettings();
                audio.playMusic('menu');
                // Resume exactly where they left off.
                const resume = save.checkpoint.screen;
                app.go(resume === 'match' || resume === 'results' ? 'hub' : resume);
              },
            },
            [document.createTextNode('▶  Continue')],
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
            [document.createTextNode('New Career')],
          ),
        );
      } else {
        wrap.appendChild(
          el('p', {
            class: 'hint',
            style: 'margin-top:14px',
            text: 'From an empty training hall to the world championship. Every takedown, every reversal, every title — earned.',
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
            [document.createTextNode('Begin Your Career')],
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
      el('h2', { text: 'Start Over?' }),
      el('p', {
        text: 'Starting a new career will permanently erase your current progress, titles and unlocks. This cannot be undone.',
      }),
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
          [document.createTextNode('Cancel')],
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
          [document.createTextNode('Erase & Start')],
        ),
      ]),
    ]);
    backdrop.appendChild(modal);
    app.mount(backdrop);
  };

  // ------------------------------------------------------------------ name
  const drawName = (): void => {
    const wrap = el('div', { class: 'onboard' });
    wrap.appendChild(el('div', { class: 'onboard-logo', text: 'KOSHTI' }));
    wrap.appendChild(
      el('p', {
        class: 'hint',
        text: 'Before you step on the mat — what should the arena announcer call you?',
      }),
    );

    const input = el('input', {
      class: 'name-input',
      type: 'text',
      placeholder: 'Enter your name',
      maxlength: 20,
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
    }) as HTMLInputElement;

    const next = el('button', { class: 'btn', disabled: true }, [
      document.createTextNode('Continue'),
    ]) as HTMLButtonElement;

    const validate = (): void => {
      name = input.value.trim();
      const ok = name.length >= 2 && name.length <= 20;
      next.disabled = !ok;
      err.textContent = name.length > 0 && name.length < 2 ? 'At least 2 characters' : '';
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
        text: 'Your profile, progress and titles are saved automatically under this name.',
      }),
    );

    body.appendChild(wrap);
    globalThis.setTimeout(() => input.focus(), 260);
  };

  // ----------------------------------------------------------------- style
  const drawStyle = (): void => {
    const wrap = el('div', { class: 'onboard', style: 'justify-content:flex-start;padding-top:24px' });
    wrap.appendChild(
      el('h1', { style: 'font-family:var(--font-display);font-size:26px;margin:0', text: `WELCOME, ${name.toUpperCase()}` }),
    );
    wrap.appendChild(
      el('p', { class: 'hint', text: 'Pick the style that suits you. It shapes your starting attributes — you can grow into anything later.' }),
    );

    const grid = el('div', { class: 'style-grid', style: 'margin-top:6px' });
    const cards: HTMLElement[] = [];
    for (const s of STYLE_LIST) {
      const card = el('button', { class: 'style-card', style: `--sc:${s.color}` }, [
        el('h4', { text: s.name }),
        el('p', { text: s.blurb }),
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
      document.createTextNode('Continue'),
    ]) as HTMLButtonElement;
    nextBtn.addEventListener('click', () => {
      audio.play('ui_confirm');
      step = 'club';
      draw();
    });
    wrap.appendChild(nextBtn);
    wrap.appendChild(
      el('button', { class: 'btn ghost', onclick: () => { audio.play('ui_back'); step = 'name'; draw(); } }, [
        document.createTextNode('Back'),
      ]),
    );
    body.appendChild(wrap);
  };

  // ------------------------------------------------------------------ club
  const drawClub = (): void => {
    const wrap = el('div', { class: 'onboard', style: 'justify-content:flex-start;padding-top:24px' });
    wrap.appendChild(
      el('h1', { style: 'font-family:var(--font-display);font-size:24px;margin:0', text: 'CHOOSE A CLUB' }),
    );
    wrap.appendChild(
      el('p', { class: 'hint', text: 'Your club backs you in league play and unlocks club championships. You can transfer later.' }),
    );

    const list = el('div', { style: 'text-align:left;margin-top:6px' });
    const cards: HTMLElement[] = [];
    for (const c of CLUBS) {
      const card = el('div', { class: 'card interactive', style: `--sc:${c.colors[0]}` }, [
        el('div', { class: 'card-accent', style: `background:${c.colors[0]}` }),
        el('div', { class: 'row between' }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'card-title', text: c.name }),
            el('p', { class: 'card-sub', text: `${c.city} · "${c.motto}"` }),
          ]),
          el('div', {
            class: 'style-pill',
            style: `color:${c.colors[0]}`,
            text: c.style,
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
      document.createTextNode('Start Career'),
    ]) as HTMLButtonElement;

    startBtn.addEventListener('click', async () => {
      audio.play('levelup');
      startBtn.disabled = true;
      startBtn.textContent = 'Creating profile…';
      const save = await app.createCareer(name);
      save.profile.style = style;
      save.profile.clubId = clubId;
      // Style choice biases the starting build.
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
      toast.show(`Welcome to Koshti, ${name}!`, 'gold', 3200, '🤼');
      app.go('training', { firstTime: true });
    });

    wrap.appendChild(startBtn);
    wrap.appendChild(
      el('button', { class: 'btn ghost', onclick: () => { audio.play('ui_back'); step = 'style'; draw(); } }, [
        document.createTextNode('Back'),
      ]),
    );
    body.appendChild(wrap);
  };

  draw();
};

const labelDivision = (id?: string): string => {
  const map: Record<string, string> = {
    amateur: 'Amateur Circuit',
    semipro: 'Semi-Pro League',
    professional: 'Professional Division',
    elite: 'Elite Series',
    champion: "Champion's Circle",
  };
  return map[id ?? ''] ?? 'Amateur Circuit';
};
