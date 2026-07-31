import { audio } from '../../engine/audio';
import type { App } from '../../game/app';
import { QUALITY } from '../../engine/quality';
import type { ControlScheme, GraphicsPreset, ScreenId } from '../../game/save/schema';
import { el } from '../dom';
import { toast } from '../toast';

export const renderSettings = (app: App, params?: Record<string, unknown>): void => {
  const save = app.requireSave();
  const s = save.settings;
  const returnTo = (params?.returnTo as ScreenId) ?? 'hub';

  const screen = el('div', { class: 'screen overlay-bg' });
  screen.appendChild(
    el('div', { class: 'topbar' }, [
      el('button', { class: 'icon-btn', onclick: () => { audio.play('ui_back'); app.go(returnTo); } }, [
        document.createTextNode('‹'),
      ]),
      el('h1', {}, [
        document.createTextNode('SETTINGS'),
        el('span', { class: 'sub', text: `${app.caps.isMobile ? 'Mobile' : 'Desktop'} · GPU tier ${app.caps.gpuTier}` }),
      ]),
    ]),
  );

  const body = el('div', { class: 'screen-body' });
  const persist = (label: string): void => {
    app.queueSave(label);
  };

  // ------------------------------------------------------------- graphics
  body.appendChild(el('div', { class: 'section-label', text: 'Graphics' }));
  const gfxCard = el('div', { class: 'card' });

  gfxCard.appendChild(
    settingRow(
      'Quality preset',
      `Auto-detected: ${QUALITY[s.autoDetected].label}`,
      segmented(
        (['low', 'medium', 'high', 'ultra'] as GraphicsPreset[]).map((q) => ({
          id: q,
          label: QUALITY[q].label,
        })),
        s.graphics,
        (val) => {
          s.graphics = val as GraphicsPreset;
          s.manualGraphics = true;
          app.applyGraphicsSettings();
          audio.play('ui_tap');
          toast.show(`Graphics: ${QUALITY[s.graphics].label}`, 'blue', 1600);
          persist('Settings changed');
        },
      ),
    ),
  );

  gfxCard.appendChild(
    settingRow(
      'Frame rate target',
      'Lower target saves battery on long sessions.',
      segmented(
        [
          { id: '30', label: '30 FPS' },
          { id: '60', label: '60 FPS' },
        ],
        String(s.targetFps),
        (val) => {
          s.targetFps = Number(val) as 30 | 60;
          app.applyGraphicsSettings();
          audio.play('ui_tap');
          persist('Settings changed');
        },
      ),
    ),
  );

  gfxCard.appendChild(
    settingRow(
      'Dynamic resolution',
      'Automatically lowers render scale to hold your target frame rate.',
      toggle(s.dynamicResolution, (v) => {
        s.dynamicResolution = v;
        app.applyGraphicsSettings();
        persist('Settings changed');
      }),
    ),
  );

  gfxCard.appendChild(
    settingRow(
      'Camera shake',
      'Impact shake intensity.',
      slider(s.cameraShake, 0, 1.5, 0.1, (v) => {
        s.cameraShake = v;
        app.renderer.setCameraShake(v);
        persist('Settings changed');
      }),
    ),
  );

  gfxCard.appendChild(
    settingRow(
      'Damage numbers',
      'Show floating damage values during matches.',
      toggle(s.showDamageNumbers, (v) => {
        s.showDamageNumbers = v;
        persist('Settings changed');
      }),
    ),
  );

  gfxCard.appendChild(
    settingRow(
      'Performance overlay',
      'FPS, draw calls and render scale.',
      toggle(app.perfVisible, (v) => {
        app.togglePerfHud(v);
      }),
    ),
  );
  body.appendChild(gfxCard);

  // Quality detail readout.
  const q = QUALITY[s.graphics];
  body.appendChild(
    el('div', { class: 'card', style: 'padding:11px' }, [
      el('div', { class: 'tiny', style: 'line-height:1.7' }, [
        document.createTextNode(
          `Shadows ${q.shadows ? `${q.shadowMapSize}px${q.softShadows ? ' soft' : ''}` : 'off'} · Crowd ${q.crowdCount || 'off'} · Particles ${q.particles ? 'on' : 'off'} · Bloom ${q.bloom ? 'on' : 'off'} · Render scale ${q.renderScale} · Max DPR ${q.maxPixelRatio}`,
        ),
      ]),
    ]),
  );

  // ---------------------------------------------------------------- audio
  body.appendChild(el('div', { class: 'section-label', text: 'Audio' }));
  const audCard = el('div', { class: 'card' });
  audCard.appendChild(
    settingRow('Master volume', '', slider(s.masterVolume, 0, 1, 0.05, (v) => {
      s.masterVolume = v;
      app.applyAudioSettings();
      persist('Settings changed');
    })),
  );
  audCard.appendChild(
    settingRow('Music', '', slider(s.musicVolume, 0, 1, 0.05, (v) => {
      s.musicVolume = v;
      app.applyAudioSettings();
      persist('Settings changed');
    })),
  );
  audCard.appendChild(
    settingRow('Sound effects', '', slider(s.sfxVolume, 0, 1, 0.05, (v) => {
      s.sfxVolume = v;
      app.applyAudioSettings();
      audio.play('hit_medium', { volume: 0.6 });
      persist('Settings changed');
    })),
  );
  audCard.appendChild(
    settingRow('Crowd', '', slider(s.crowdVolume, 0, 1, 0.05, (v) => {
      s.crowdVolume = v;
      app.applyAudioSettings();
      audio.crowdPop(0.5);
      persist('Settings changed');
    })),
  );
  audCard.appendChild(
    settingRow(
      'Commentary',
      'Live play-by-play during matches.',
      toggle(s.commentary, (v) => {
        s.commentary = v;
        app.applyAudioSettings();
        if (v) audio.say('Commentary enabled. Let us get to work.', true);
        persist('Settings changed');
      }),
    ),
  );
  body.appendChild(audCard);

  // ------------------------------------------------------------- controls
  body.appendChild(el('div', { class: 'section-label', text: 'Controls' }));
  const ctrlCard = el('div', { class: 'card' });
  ctrlCard.appendChild(
    settingRow(
      'Control scheme',
      'Hybrid gives you both the stick/buttons and gestures.',
      segmented(
        [
          { id: 'buttons', label: 'Buttons' },
          { id: 'gestures', label: 'Gestures' },
          { id: 'hybrid', label: 'Hybrid' },
        ],
        s.controls,
        (val) => {
          s.controls = val as ControlScheme;
          app.applyInputSettings();
          audio.play('ui_tap');
          persist('Settings changed');
        },
      ),
    ),
  );
  ctrlCard.appendChild(
    settingRow(
      'Left-handed layout',
      'Mirrors the movement stick and action pad.',
      toggle(s.leftHanded, (v) => {
        s.leftHanded = v;
        app.applyInputSettings();
        persist('Settings changed');
      }),
    ),
  );
  ctrlCard.appendChild(
    settingRow(
      'Haptic feedback',
      'Vibration on impacts and counters.',
      toggle(s.haptics, (v) => {
        s.haptics = v;
        app.applyInputSettings();
        if (v) app.input.haptic([12, 30, 12]);
        persist('Settings changed');
      }),
    ),
  );
  body.appendChild(ctrlCard);

  body.appendChild(
    el('div', { class: 'card', style: 'padding:12px' }, [
      el('div', { class: 'section-label', style: 'margin:0 0 6px', text: 'Gesture reference' }),
      gestureRow('Tap', 'Quick strike / tie-up'),
      gestureRow('Swipe up', 'Throw or signature move'),
      gestureRow('Swipe down', 'Takedown or submission'),
      gestureRow('Swipe sideways (hard)', 'Grapple'),
      gestureRow('Swipe sideways (soft)', 'Escape / disengage'),
      gestureRow('Draw a circle', 'Reversal'),
      gestureRow('Double tap', 'Finisher (or taunt)'),
      gestureRow('Press and hold', 'Guard'),
    ]),
  );

  // ---------------------------------------------------------------- saving
  body.appendChild(el('div', { class: 'section-label', text: 'Save data' }));
  const saveCard = el('div', { class: 'card' });
  saveCard.appendChild(
    el('div', { class: 'tiny', style: 'margin-bottom:10px' }, [
      document.createTextNode(
        `Progress auto-saves after every match, unlock and milestone. Last save: ${save.checkpoint.label}.`,
      ),
    ]),
  );
  saveCard.appendChild(
    el('div', { class: 'btn-row' }, [
      el(
        'button',
        {
          class: 'btn secondary small',
          onclick: async () => {
            audio.play('ui_confirm');
            await app.saves.manualSave();
            toast.show('Manual save created', 'green', 2000, '💾');
          },
        },
        [document.createTextNode('Manual Save')],
      ),
      el(
        'button',
        {
          class: 'btn secondary small',
          onclick: async () => {
            const has = await app.saves.hasManual();
            if (!has) {
              audio.play('ui_error');
              toast.show('No manual save found', 'red');
              return;
            }
            confirmModal(
              app,
              'Load Manual Save?',
              'Your current unsaved progress will be replaced by the manual save slot.',
              async () => {
                const loaded = await app.saves.loadManual();
                if (loaded) {
                  app.save = loaded;
                  app.applyAudioSettings();
                  app.applyGraphicsSettings();
                  app.applyInputSettings();
                  toast.show('Manual save loaded', 'green', 2200);
                  app.go('hub');
                }
              },
            );
          },
        },
        [document.createTextNode('Load Manual')],
      ),
    ]),
  );

  saveCard.appendChild(
    el('div', { class: 'btn-row', style: 'margin-top:8px' }, [
      el(
        'button',
        {
          class: 'btn ghost',
          onclick: async () => {
            audio.play('ui_tap');
            const data = app.saves.exportString();
            try {
              await navigator.clipboard.writeText(data);
              toast.show('Save code copied to clipboard', 'green', 2600, '📋');
            } catch {
              showExportModal(app, data);
            }
          },
        },
        [document.createTextNode('Export')],
      ),
      el(
        'button',
        {
          class: 'btn ghost',
          onclick: () => {
            audio.play('ui_tap');
            showImportModal(app);
          },
        },
        [document.createTextNode('Import')],
      ),
    ]),
  );
  body.appendChild(saveCard);

  body.appendChild(
    el(
      'button',
      {
        class: 'btn danger',
        style: 'margin-top:14px',
        onclick: () => {
          audio.play('ui_error');
          confirmModal(
            app,
            'Delete Career?',
            'This permanently erases your wrestler, all titles, unlocks and match history. There is no way back.',
            async () => {
              await app.saves.wipe();
              app.save = null;
              app.go('onboarding');
            },
            'Delete Forever',
          );
        },
      },
      [document.createTextNode('Delete Career')],
    ),
  );

  body.appendChild(
    el('div', { class: 'tiny center', style: 'margin-top:18px;opacity:.45' }, [
      document.createTextNode(`KOSHTI v1.0.0 · ${app.caps.renderer.slice(0, 40)}`),
    ]),
  );

  screen.appendChild(body);
  app.mount(screen);
};

// ----------------------------------------------------------------- widgets

const settingRow = (name: string, desc: string, control: HTMLElement): HTMLElement =>
  el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-label' }, [
      el('div', { class: 'name', text: name }),
      desc ? el('div', { class: 'desc', text: desc }) : null,
    ]),
    control,
  ]);

const segmented = (
  options: Array<{ id: string; label: string }>,
  current: string,
  onChange: (id: string) => void,
): HTMLElement => {
  const wrap = el('div', { class: 'seg' });
  const buttons: HTMLElement[] = [];
  for (const o of options) {
    const btn = el('button', { class: o.id === current ? 'active' : '', text: o.label });
    btn.addEventListener('click', () => {
      for (const b of buttons) b.classList.remove('active');
      btn.classList.add('active');
      onChange(o.id);
    });
    buttons.push(btn);
    wrap.appendChild(btn);
  }
  return wrap;
};

const toggle = (value: boolean, onChange: (v: boolean) => void): HTMLElement => {
  const btn = el('button', { class: `switch ${value ? 'on' : ''}` });
  let v = value;
  btn.addEventListener('click', () => {
    v = !v;
    btn.classList.toggle('on', v);
    audio.play('ui_tap');
    onChange(v);
  });
  return btn;
};

const slider = (
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLElement => {
  const input = el('input', {
    class: 'slider',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  }) as HTMLInputElement;
  let raf = 0;
  input.addEventListener('input', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => onChange(Number(input.value)));
  });
  return input;
};

const gestureRow = (gesture: string, action: string): HTMLElement =>
  el('div', { class: 'row between', style: 'padding:4px 0' }, [
    el('span', { style: 'font-size:11.5px;font-weight:700', text: gesture }),
    el('span', { class: 'tiny', text: action }),
  ]);

const confirmModal = (
  app: App,
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  confirmLabel = 'Confirm',
): void => {
  const backdrop = el('div', { class: 'modal-backdrop' });
  backdrop.appendChild(
    el('div', { class: 'modal' }, [
      el('h2', { text: title }),
      el('p', { text: message }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn secondary', onclick: () => { audio.play('ui_back'); backdrop.remove(); } }, [
          document.createTextNode('Cancel'),
        ]),
        el(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              audio.play('ui_confirm');
              backdrop.remove();
              await onConfirm();
            },
          },
          [document.createTextNode(confirmLabel)],
        ),
      ]),
    ]),
  );
  app.mount(backdrop);
};

const showExportModal = (app: App, data: string): void => {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const ta = el('textarea', {
    style: 'width:100%;height:130px;background:rgba(0,0,0,.4);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:10px;font-family:monospace;resize:none',
    readonly: true,
  }) as HTMLTextAreaElement;
  ta.value = data;
  backdrop.appendChild(
    el('div', { class: 'modal' }, [
      el('h2', { text: 'Export Save' }),
      el('p', { text: 'Copy this code and keep it somewhere safe. Import it on another device to continue your career.' }),
      ta,
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => backdrop.remove() }, [
        document.createTextNode('Done'),
      ]),
    ]),
  );
  app.mount(backdrop);
  ta.select();
};

const showImportModal = (app: App): void => {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const ta = el('textarea', {
    placeholder: 'Paste your save code here…',
    style: 'width:100%;height:130px;background:rgba(0,0,0,.4);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:10px;font-family:monospace;resize:none',
  }) as HTMLTextAreaElement;
  backdrop.appendChild(
    el('div', { class: 'modal' }, [
      el('h2', { text: 'Import Save' }),
      el('p', { text: 'Importing replaces your current career completely.' }),
      ta,
      el('div', { class: 'btn-row', style: 'margin-top:12px' }, [
        el('button', { class: 'btn secondary', onclick: () => backdrop.remove() }, [
          document.createTextNode('Cancel'),
        ]),
        el(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const loaded = await app.saves.importString(ta.value.trim());
              if (!loaded) {
                audio.play('ui_error');
                toast.show('Invalid save code', 'red');
                return;
              }
              app.save = loaded;
              app.applyAudioSettings();
              app.applyGraphicsSettings();
              app.applyInputSettings();
              backdrop.remove();
              toast.show('Save imported', 'green', 2400);
              app.go('hub');
            },
          },
          [document.createTextNode('Import')],
        ),
      ]),
    ]),
  );
  app.mount(backdrop);
};
