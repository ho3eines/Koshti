import { audio } from '../../engine/audio';
import { t, faNum } from '../../core/i18n';
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
        document.createTextNode('›'),
      ]),
      el('h1', {}, [
        document.createTextNode(t('settings.title')),
        el('span', {
          class: 'sub',
          text: `${app.caps.isMobile ? t('settings.mobile') : t('settings.desktop')} · GPU tier ${faNum(app.caps.gpuTier)}`,
        }),
      ]),
    ]),
  );

  const body = el('div', { class: 'screen-body' });
  const persist = (_label: string): void => {
    app.queueSave('Settings changed');
  };

  // ------------------------------------------------------------- graphics
  body.appendChild(el('div', { class: 'section-label', text: t('settings.graphics') }));
  const gfxCard = el('div', { class: 'card' });

  const presets: GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
  gfxCard.appendChild(
    settingRow(
      t('settings.quality'),
      t('settings.auto', { q: t(`settings.gfx_${s.autoDetected}`) }),
      segmented(
        presets.map((q) => ({ id: q, label: t(`settings.gfx_${q}`) })),
        s.graphics,
        (val) => {
          s.graphics = val as GraphicsPreset;
          s.manualGraphics = true;
          app.applyGraphicsSettings();
          audio.play('ui_tap');
          toast.show(`${t('settings.quality')}: ${t(`settings.gfx_${s.graphics}`)}`, 'blue', 1600);
          persist('Settings changed');
        },
      ),
    ),
  );

  gfxCard.appendChild(
    settingRow(
      t('settings.fps'),
      t('settings.dynres_desc'),
      segmented(
        [
          { id: '30', label: '۳۰ FPS' },
          { id: '60', label: '۶۰ FPS' },
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
    settingRow(t('settings.dynres'), t('settings.dynres_desc'), toggle(s.dynamicResolution, (v) => {
      s.dynamicResolution = v;
      app.applyGraphicsSettings();
      persist('Settings changed');
    })),
  );

  gfxCard.appendChild(
    settingRow(t('settings.shake'), t('settings.shake_desc'), slider(s.cameraShake, 0, 1.5, 0.1, (v) => {
      s.cameraShake = v;
      app.renderer.setCameraShake(v);
      persist('Settings changed');
    })),
  );

  gfxCard.appendChild(
    settingRow(t('settings.dmg_numbers'), t('settings.dmg_numbers_desc'), toggle(s.showDamageNumbers, (v) => {
      s.showDamageNumbers = v;
      persist('Settings changed');
    })),
  );

  gfxCard.appendChild(
    settingRow(t('settings.perf'), t('settings.perf_desc'), toggle(app.perfVisible, (v) => {
      app.togglePerfHud(v);
    })),
  );
  body.appendChild(gfxCard);

  const q = QUALITY[s.graphics];
  body.appendChild(
    el('div', { class: 'card', style: 'padding:11px' }, [
      el('div', { class: 'tiny', style: 'line-height:1.7' }, [
        document.createTextNode(
          `${t('settings.shadows', {}, 'Shadows')}: ${q.shadows ? faNum(q.shadowMapSize) + 'px' + (q.softShadows ? ' ' + t('settings.soft', {}, 'soft') : '') : t('settings.off')} · ${t('settings.crowd', {}, 'Crowd')}: ${faNum(q.crowdCount) || t('settings.off')} · ${t('settings.particles', {}, 'Particles')}: ${q.particles ? t('settings.on') : t('settings.off')} · ${t('bloom', {}, 'Bloom')}: ${q.bloom ? t('settings.on') : t('settings.off')} · Scale ${faNum(q.renderScale)} · DPR ${faNum(q.maxPixelRatio)}`,
        ),
      ]),
    ]),
  );

  // ---------------------------------------------------------------- audio
  body.appendChild(el('div', { class: 'section-label', text: t('settings.audio') }));
  const audCard = el('div', { class: 'card' });
  audCard.appendChild(
    settingRow(t('settings.master'), '', slider(s.masterVolume, 0, 1, 0.05, (v) => {
      s.masterVolume = v;
      app.applyAudioSettings();
      persist('Settings changed');
    })),
  );
  audCard.appendChild(
    settingRow(t('settings.music'), '', slider(s.musicVolume, 0, 1, 0.05, (v) => {
      s.musicVolume = v;
      app.applyAudioSettings();
      persist('Settings changed');
    })),
  );
  audCard.appendChild(
    settingRow(t('settings.sfx'), '', slider(s.sfxVolume, 0, 1, 0.05, (v) => {
      s.sfxVolume = v;
      app.applyAudioSettings();
      audio.play('hit_medium', { volume: 0.6 });
      persist('Settings changed');
    })),
  );
  audCard.appendChild(
    settingRow(t('settings.crowd'), '', slider(s.crowdVolume, 0, 1, 0.05, (v) => {
      s.crowdVolume = v;
      app.applyAudioSettings();
      audio.crowdPop(0.5);
      persist('Settings changed');
    })),
  );
  audCard.appendChild(
    settingRow(t('settings.commentary'), t('settings.commentary_desc'), toggle(s.commentary, (v) => {
      s.commentary = v;
      app.applyAudioSettings();
      if (v) audio.say('گزارش‌گر فعال شد. بزن بریم!', true);
      persist('Settings changed');
    })),
  );
  body.appendChild(audCard);

  // ------------------------------------------------------------- controls
  body.appendChild(el('div', { class: 'section-label', text: t('settings.controls') }));
  const ctrlCard = el('div', { class: 'card' });
  ctrlCard.appendChild(
    settingRow(
      t('settings.scheme'),
      t('settings.scheme_desc'),
      segmented(
        [
          { id: 'buttons', label: t('settings.buttons') },
          { id: 'gestures', label: t('settings.gestures') },
          { id: 'hybrid', label: t('settings.hybrid') },
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
    settingRow(t('settings.lefthand'), t('settings.lefthand_desc'), toggle(s.leftHanded, (v) => {
      s.leftHanded = v;
      app.applyInputSettings();
      persist('Settings changed');
    })),
  );
  ctrlCard.appendChild(
    settingRow(t('settings.haptics'), t('settings.haptics_desc'), toggle(s.haptics, (v) => {
      s.haptics = v;
      app.applyInputSettings();
      if (v) app.input.haptic([12, 30, 12]);
      persist('Settings changed');
    })),
  );
  body.appendChild(ctrlCard);

  body.appendChild(
    el('div', { class: 'card', style: 'padding:12px' }, [
      el('div', { class: 'section-label', style: 'margin:0 0 6px', text: t('settings.gesture_ref') }),
      gestureRow(t('g.tap'), t('g.tap_desc')),
      gestureRow(t('g.up'), t('g.up_desc')),
      gestureRow(t('g.down'), t('g.down_desc')),
      gestureRow(t('g.side_strong'), t('g.side_strong_desc')),
      gestureRow(t('g.side_soft'), t('g.side_soft_desc')),
      gestureRow(t('g.circle'), t('g.circle_desc')),
      gestureRow(t('g.double'), t('g.double_desc')),
      gestureRow(t('g.hold'), t('g.hold_desc')),
    ]),
  );

  // ---------------------------------------------------------------- saving
  body.appendChild(el('div', { class: 'section-label', text: t('settings.data') }));
  const saveCard = el('div', { class: 'card' });
  saveCard.appendChild(
    el('div', { class: 'tiny', style: 'margin-bottom:10px' }, [
      document.createTextNode(t('settings.save_line', { label: save.checkpoint.label })),
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
            toast.show(t('settings.manual_saved'), 'green', 2000, '💾');
          },
        },
        [document.createTextNode(t('settings.manual_save'))],
      ),
      el(
        'button',
        {
          class: 'btn secondary small',
          onclick: async () => {
            const has = await app.saves.hasManual();
            if (!has) {
              audio.play('ui_error');
              toast.show(t('settings.no_manual'), 'red');
              return;
            }
            confirmModal(
              app,
              t('settings.load_title'),
              t('settings.load_body'),
              async () => {
                const loaded = await app.saves.loadManual();
                if (loaded) {
                  app.save = loaded;
                  app.applyAudioSettings();
                  app.applyGraphicsSettings();
                  app.applyInputSettings();
                  toast.show(t('settings.manual_loaded'), 'green', 2200);
                  app.go('hub');
                }
              },
            );
          },
        },
        [document.createTextNode(t('settings.load_manual'))],
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
              toast.show(t('settings.copied'), 'green', 2600, '📋');
            } catch {
              showExportModal(app, data);
            }
          },
        },
        [document.createTextNode(t('settings.export'))],
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
        [document.createTextNode(t('settings.import'))],
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
            t('settings.delete_title'),
            t('settings.delete_body'),
            async () => {
              await app.saves.wipe();
              app.save = null;
              app.go('onboarding');
            },
            t('settings.delete_forever'),
          );
        },
      },
      [document.createTextNode(t('settings.delete_career'))],
    ),
  );

  body.appendChild(
    el('div', { class: 'tiny center', style: 'margin-top:18px;opacity:.45' }, [
      document.createTextNode(`کُشتی نسخه ۱.۰`),
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
  confirmLabel = t('confirm'),
): void => {
  const backdrop = el('div', { class: 'modal-backdrop' });
  backdrop.appendChild(
    el('div', { class: 'modal' }, [
      el('h2', { text: title }),
      el('p', { text: message }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn secondary', onclick: () => { audio.play('ui_back'); backdrop.remove(); } }, [
          document.createTextNode(t('cancel')),
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
      el('h2', { text: t('settings.export_title') }),
      el('p', { text: t('settings.export_body') }),
      ta,
      el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => backdrop.remove() }, [
        document.createTextNode(t('done')),
      ]),
    ]),
  );
  app.mount(backdrop);
  ta.select();
};

const showImportModal = (app: App): void => {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const ta = el('textarea', {
    placeholder: 'کد ذخیره را اینجا بچسبان…',
    style: 'width:100%;height:130px;background:rgba(0,0,0,.4);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:10px;font-family:monospace;resize:none',
  }) as HTMLTextAreaElement;
  backdrop.appendChild(
    el('div', { class: 'modal' }, [
      el('h2', { text: t('settings.import_title') }),
      el('p', { text: t('settings.import_body') }),
      ta,
      el('div', { class: 'btn-row', style: 'margin-top:12px' }, [
        el('button', { class: 'btn secondary', onclick: () => backdrop.remove() }, [
          document.createTextNode(t('cancel')),
        ]),
        el(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const loaded = await app.saves.importString(ta.value.trim());
              if (!loaded) {
                audio.play('ui_error');
                toast.show(t('settings.invalid'), 'red');
                return;
              }
              app.save = loaded;
              app.applyAudioSettings();
              app.applyGraphicsSettings();
              app.applyInputSettings();
              backdrop.remove();
              toast.show(t('settings.imported'), 'green', 2400);
              app.go('hub');
            },
          },
          [document.createTextNode(t('settings.import'))],
        ),
      ]),
    ]),
  );
  app.mount(backdrop);
};
