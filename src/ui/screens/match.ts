import { audio } from '../../engine/audio';
import type { App } from '../../game/app';
import { getMove, type MoveDef } from '../../game/data/moves';
import { ARENAS, type ArenaId } from '../../game/data/leagues';
import { MatchController } from '../../game/match/controller';
import type { MatchConfig, MatchResult, SimEvent } from '../../game/sim/types';
import { clear, el, formatTime } from '../dom';

export interface MatchScreenParams {
  config: MatchConfig;
  arena: ArenaId;
  /** Where to go and what to do when the match ends. */
  onComplete: (result: MatchResult) => void;
  /** Optional training-mode hooks. */
  onSimEvent?: (e: SimEvent) => void;
  onTick?: (dt: number) => void;
  /** Extra UI mounted above the controls (tutorial cards). */
  overlayHost?: (host: HTMLElement) => void;
  showIntro?: boolean;
}

/**
 * The in-match screen: 3D view + HUD + touch controls.
 * The HUD is updated imperatively each frame (no re-render churn).
 */
export const renderMatch = (app: App, params?: Record<string, unknown>): void => {
  const p = params as unknown as MatchScreenParams;
  const save = app.requireSave();

  app.renderer.clearFighters();
  app.renderer.loadArena(p.arena);
  app.renderer.spawnFighter('player', {
    tint: p.config.player.tint,
    trunks: p.config.player.trunks,
    height: 1.0,
    bulk: 0.95 + (p.config.player.attributes.strength / 99) * 0.22,
  });
  app.renderer.spawnFighter('opponent', {
    tint: p.config.opponent.tint,
    trunks: p.config.opponent.trunks,
    height: 0.97 + (p.config.opponent.attributes.strength / 99) * 0.08,
    bulk: 0.95 + (p.config.opponent.attributes.strength / 99) * 0.22,
  });

  const hud = el('div', { id: 'hud' });
  const controlsHost = el('div', { class: 'controls' });

  // ------------------------------------------------------------------- HUD
  const pName = el('div', { class: 'fighter-name', text: p.config.player.name });
  const pHp = el('i', { style: 'width:100%' });
  const pSt = el('i', { style: 'width:100%' });
  const pMo = el('i', { style: 'width:0%' });
  const pMoBar = el('div', { class: 'hud-bar momo' }, [pMo]);

  const oName = el('div', { class: 'fighter-name', text: p.config.opponent.name });
  const oHp = el('i', { style: 'width:100%' });
  const oSt = el('i', { style: 'width:100%' });
  const oMo = el('i', { style: 'width:0%' });

  const timerNode = el('div', { class: 'hud-timer', text: '2:00' });
  const roundNode = el('div', { class: 'hud-round', text: 'Round 1' });
  const scoreP = el('span', { class: 'p', text: '0' });
  const scoreO = el('span', { class: 'o', text: '0' });

  hud.appendChild(
    el('div', { class: 'hud-top' }, [
      el('div', { class: 'fighter-hud' }, [
        pName,
        el('div', { class: 'hud-bars' }, [
          el('div', { class: 'hud-bar hp' }, [pHp]),
          el('div', { class: 'hud-bar stam' }, [pSt]),
          pMoBar,
        ]),
      ]),
      el('div', { class: 'hud-center' }, [
        timerNode,
        roundNode,
        el('div', { class: 'hud-score' }, [scoreP, el('span', { class: 'sep', text: '–' }), scoreO]),
      ]),
      el('div', { class: 'fighter-hud right' }, [
        oName,
        el('div', { class: 'hud-bars' }, [
          el('div', { class: 'hud-bar hp right' }, [oHp]),
          el('div', { class: 'hud-bar stam right' }, [oSt]),
          el('div', { class: 'hud-bar momo right' }, [oMo]),
        ]),
      ]),
    ]),
  );

  const stanceNode = el('div', { class: 'hud-stance', text: 'STANDING' });
  hud.appendChild(stanceNode);

  const comboNode = el('div', { class: 'combo-display' });
  hud.appendChild(comboNode);

  // Pause button.
  hud.appendChild(
    el(
      'button',
      {
        class: 'icon-btn',
        'data-ui-button': '1',
        style: 'position:absolute;top:calc(var(--safe-t) + 78px);left:calc(var(--safe-l) + 10px);width:34px;height:34px;font-size:14px;pointer-events:auto',
        onclick: () => showPause(),
      },
      [document.createTextNode('❚❚')],
    ),
  );

  // ---------------------------------------------------------------- stick
  const stickBase = el('div', { class: 'stick-base' });
  const stickKnob = el('div', { class: 'stick-knob' });
  const stickZone = el('div', { class: 'stick-zone' }, [stickBase, stickKnob]);

  // -------------------------------------------------------------- buttons
  const btnGuard = actionButton('🛡', 'Guard', 'act-btn');
  const btnReverse = actionButton('↺', 'Reverse', 'act-btn counter');
  const btnEscape = actionButton('⤴', 'Escape', 'act-btn');
  const btnPin = actionButton('⬇', 'Pin', 'act-btn primary');

  const actionPad = el('div', { class: 'action-pad' }, [btnReverse, btnGuard, btnEscape, btnPin]);

  const leftHanded = save.settings.leftHanded;
  controlsHost.appendChild(leftHanded ? actionPad : stickZone);
  controlsHost.appendChild(leftHanded ? stickZone : actionPad);

  // Move strip — contextual to the current stance.
  const moveStrip = el('div', { class: 'move-strip' });
  hud.appendChild(moveStrip);
  hud.appendChild(controlsHost);

  const overlayHost = el('div');
  hud.appendChild(overlayHost);
  p.overlayHost?.(overlayHost);

  app.mount(hud);

  // --------------------------------------------------------------- control
  const controller = new MatchController(p.config, app.renderer, app.input, {
    onEvent: (e) => {
      handleUiEvent(e);
      p.onSimEvent?.(e);
    },
    onEnd: (result) => {
      finished = true;
      app.input.disable();
      globalThis.setTimeout(() => {
        controller.dispose();
        app.activeMatch = null;
        p.onComplete(result);
      }, 2600);
    },
  });

  let finished = false;
  const sim = controller.sim;
  app.activeMatch = controller;

  // Wire on-screen buttons to the controller.
  bindHold(btnGuard, () => controller.action('guard_on'), () => controller.action('guard_off'));
  bindTap(btnReverse, () => controller.action('reverse'));
  bindTap(btnEscape, () => controller.action('escape'));
  bindTap(btnPin, () => controller.action('pin'));

  // -------------------------------------------------------- move strip sync
  let lastStance = '';
  let lastMoveCount = 0;
  const rebuildMoveStrip = (): void => {
    clear(moveStrip);
    const available = sim.player.cfg.moves
      .map((id) => getMove(id))
      .filter((m) => m.range === sim.stance)
      .sort((a, b) => catOrder(a) - catOrder(b) || a.damage - b.damage);

    for (const m of available) {
      const btn = el(
        'button',
        {
          class: `move-btn ${m.category === 'finisher' ? 'fin' : m.category === 'signature' ? 'sig' : ''}`,
          'data-ui-button': '1',
          'data-move': m.id,
        },
        [
          document.createTextNode(m.name),
          el('span', { class: 'cost', text: `${m.staminaCost} ST · ${Math.round(m.damage)} DMG` }),
        ],
      );
      bindTap(btn, () => controller.action(`move:${m.id}`));
      moveStrip.appendChild(btn);
    }
    lastMoveCount = available.length;
  };
  rebuildMoveStrip();

  // ------------------------------------------------------------ HUD update
  let comboTimer = 0;
  const pMax = sim.player.maxHealth;
  const oMax = sim.opponent.maxHealth;

  const tick = (dt: number): void => {
    controller.update(dt);
    p.onTick?.(dt);

    const pl = sim.player;
    const op = sim.opponent;

    pHp.style.width = `${(pl.health / pMax) * 100}%`;
    pSt.style.width = `${(pl.stamina / pl.maxStamina) * 100}%`;
    pMo.style.width = `${(pl.momentum / pl.maxMomentum) * 100}%`;
    oHp.style.width = `${(op.health / oMax) * 100}%`;
    oSt.style.width = `${(op.stamina / op.maxStamina) * 100}%`;
    oMo.style.width = `${(op.momentum / op.maxMomentum) * 100}%`;

    const momoFull = pl.momentum >= pl.maxMomentum * 0.999;
    pMoBar.classList.toggle('full', momoFull);

    // Timer.
    const t = Math.max(0, sim.roundTime);
    timerNode.textContent = formatTime(t);
    timerNode.classList.toggle('urgent', t < 15 && t > 0);
    roundNode.textContent =
      sim.intermission > 0 ? 'Break' : `Round ${sim.round} / ${p.config.rounds}`;
    scoreP.textContent = String(pl.score);
    scoreO.textContent = String(op.score);

    // Stance.
    if (sim.stance !== lastStance) {
      lastStance = sim.stance;
      stanceNode.textContent = sim.stance.toUpperCase();
      rebuildMoveStrip();
    }

    // Counter window arming.
    const armed = pl.counterWindow > 0;
    btnReverse.classList.toggle('armed', armed);

    // Contextual button enable states.
    (btnPin as HTMLButtonElement).disabled = sim.stance !== 'ground';
    btnPin.classList.toggle(
      'ready',
      sim.stance === 'ground' && (op.downedTimer > 0 || op.health < op.maxHealth * 0.55),
    );
    (btnEscape as HTMLButtonElement).disabled =
      sim.stance === 'standing' && !sim.pinning && !sim.submitting;

    // Move availability.
    for (const node of Array.from(moveStrip.children) as HTMLButtonElement[]) {
      const id = node.getAttribute('data-move');
      if (!id) continue;
      const ok = sim.canStart('player', id).ok;
      node.disabled = !ok;
      if (getMove(id).category === 'finisher') node.classList.toggle('ready', momoFull);
    }

    // Stick visuals.
    const sv = app.input.stickVisual;
    stickBase.classList.toggle('visible', sv.visible);
    stickKnob.classList.toggle('visible', sv.visible);
    if (sv.visible) {
      const rect = stickZone.getBoundingClientRect();
      stickBase.style.left = `${sv.originX - rect.left - 62}px`;
      stickBase.style.top = `${sv.originY - rect.top - 62}px`;
      stickKnob.style.left = `${sv.knobX - rect.left - 27}px`;
      stickKnob.style.top = `${sv.knobY - rect.top - 27}px`;
    }

    // Combo display.
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) comboNode.classList.remove('show');
    }

    // Keep move strip fresh if unlocks change mid-match (training rewards).
    if (pl.cfg.moves.filter((m) => getMove(m).range === sim.stance).length !== lastMoveCount) {
      rebuildMoveStrip();
    }
  };

  const handleUiEvent = (e: SimEvent): void => {
    if (e.t === 'move_hit' && e.side === 'player' && e.combo >= 2) {
      comboNode.textContent = `${e.combo}x COMBO`;
      comboNode.classList.remove('show');
      void comboNode.offsetWidth; // restart the animation
      comboNode.classList.add('show');
      comboTimer = 1.6;
    }
    if (e.t === 'round_start' && e.round > 1) {
      stanceNode.textContent = 'STANDING';
    }
  };

  // ------------------------------------------------------------------ pause
  const showPause = (): void => {
    if (finished) return;
    audio.play('ui_tap');
    sim.paused = true;
    app.input.disable();
    const backdrop = el('div', { class: 'modal-backdrop' });
    const resume = (): void => {
      backdrop.remove();
      sim.paused = false;
      app.input.enable();
    };
    backdrop.appendChild(
      el('div', { class: 'modal' }, [
        el('h2', { text: 'Paused' }),
        el('p', { text: `${p.config.title ?? 'Match'} · Round ${sim.round}` }),
        el('div', { class: 'btn-row mb' }, [
          el('button', { class: 'btn', onclick: () => { audio.play('ui_confirm'); resume(); } }, [
            document.createTextNode('Resume'),
          ]),
        ]),
        el(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              audio.play('ui_back');
              resume();
              app.go('settings', { returnTo: 'hub' });
            },
          },
          [document.createTextNode('Settings')],
        ),
        el(
          'button',
          {
            class: 'btn danger',
            style: 'margin-top:8px',
            onclick: () => {
              audio.play('ui_error');
              backdrop.remove();
              sim.paused = false;
              controller.retire();
            },
          },
          [document.createTextNode('Forfeit Match')],
        ),
      ]),
    );
    app.mount(backdrop);
  };

  app.setBackHandler(() => {
    if (!finished) {
      showPause();
      return true;
    }
    return false;
  });

  // ------------------------------------------------------------------- go
  app.setFrameCallback(tick);

  if (p.showIntro !== false) {
    showIntroCinematic(app, p.config, ARENAS[p.arena].name, () => {
      /* intro visual only; controller handles the timing */
    });
    controller.startIntro(3.4);
  } else {
    controller.startIntro(0.8);
  }
};

// --------------------------------------------------------------- helpers

const catOrder = (m: MoveDef): number => {
  const order: Record<string, number> = {
    strike: 0,
    grapple: 1,
    takedown: 2,
    throw: 3,
    submission: 4,
    signature: 5,
    finisher: 6,
    defense: 7,
  };
  return order[m.category] ?? 9;
};

const actionButton = (glyph: string, label: string, cls: string): HTMLElement =>
  el('button', { class: cls, 'data-ui-button': '1' }, [
    el('span', { class: 'glyph', text: glyph }),
    el('span', { text: label }),
  ]);

const bindTap = (node: HTMLElement, fn: () => void): void => {
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if ((node as HTMLButtonElement).disabled) return;
    fn();
  });
};

const bindHold = (node: HTMLElement, down: () => void, up: () => void): void => {
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    down();
    node.classList.add('held');
  });
  const release = (e: Event) => {
    e.preventDefault();
    up();
    node.classList.remove('held');
  };
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('pointerleave', release);
};

/** Broadcast-style intro: black bars, fighter cards, arena name. */
export const showIntroCinematic = (
  app: App,
  cfg: MatchConfig,
  arenaName: string,
  onDone: () => void,
): void => {
  const layer = el('div', { class: 'cinematic cine-bars' }, [
    el('div', { class: 'cine-text' }, [
      el('div', { class: 'cine-sub', text: arenaName }),
      el('div', { class: 'cine-title', text: cfg.title ?? 'MAIN EVENT' }),
      el('div', { class: 'cine-vs' }, [
        el('div', { class: 'cine-fighter' }, [
          el('div', { class: 'nm', text: cfg.player.shortName.toUpperCase() }),
          el('div', { class: 'rt', text: cfg.player.style }),
        ]),
        el('div', { class: 'x', text: 'VS' }),
        el('div', { class: 'cine-fighter' }, [
          el('div', { class: 'nm', text: cfg.opponent.shortName.toUpperCase() }),
          el('div', { class: 'rt', text: cfg.opponent.style }),
        ]),
      ]),
      cfg.subtitle ? el('div', { class: 'cine-sub', style: 'margin-top:14px', text: cfg.subtitle }) : null,
    ]),
  ]);
  app.mount(layer);
  globalThis.setTimeout(() => {
    layer.style.transition = 'opacity .5s ease';
    layer.style.opacity = '0';
    globalThis.setTimeout(() => {
      layer.remove();
      onDone();
    }, 520);
  }, 2800);
};
