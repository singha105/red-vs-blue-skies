// Research: one unlock tree per era. Tiers unlock in order with RP (200 × tier, tier 1 free), each behind a
// confirmation. Opens over whatever screen is showing (title, solo setup, the room between rounds).
import type { EraId, GameData, Plane } from '../data/types';
import { unlockCost } from '../game/unlocks';
import type { ProfileStore } from '../profile/store';
import type { Silhouettes } from '../render/silhouettes';
import { escapeHtml as esc } from './hud';

const rp = (n: number): string => `${n.toLocaleString('en')} RP`;

export function openResearch(
  parent: HTMLElement,
  deps: { data: GameData; store: ProfileStore; silhouettes: Silhouettes; era?: EraId; onClose?(): void; onUnlocked?(): void },
): { dispose(): void } {
  const { data, store } = deps;
  let era: EraId = deps.era ?? data.eras[0]!.id;
  let confirm: Plane | null = null;
  let busy = false;
  let message = '';
  const el = document.createElement('section');
  el.className = 'setup research';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Research');
  parent.appendChild(el);

  const statusLine = (): string => {
    if (store.status === 'off') return 'Progress is saved on this device.';
    if (store.status === 'connecting') return 'Connecting…';
    if (store.status === 'offline') return "You're offline: unlocking needs a connection. Matches still count and sync later.";
    return '';
  };

  const card = (p: Plane): string => {
    const owned = store.unlocks() === 'all' || p.tier <= store.profile.unlocked[p.era];
    const check = store.canUnlock(p.era, p.tier);
    const cost = unlockCost(p.tier);
    let action: string;
    if (owned) action = `<span class="tier__state tier__state--owned">${p.tier === 1 ? 'Free' : 'Unlocked'}</span>`;
    else if (check === 'ok') action = `<button type="button" class="btn btn--primary btn--small tier__buy" data-buy="${p.id}">Unlock · ${rp(cost)}</button>`;
    else if (check === 'rp') action = `<span class="tier__state">Need ${rp(cost)}</span>`;
    else action = `<span class="tier__state tier__state--later">${rp(cost)} · after tier ${p.tier - 1}</span>`;
    return `<li class="tier${owned ? ' tier--owned' : check === 'ok' ? ' tier--next' : ''}">
      <img class="tier__img" alt="" src="${deps.silhouettes.get(p.id)}" width="56" height="56" />
      <span class="tier__num">Tier ${p.tier} · BR ${p.br.toFixed(1)}</span>
      <span class="tier__name">${esc(p.name)}</span>
      ${action}
    </li>`;
  };

  const render = (): void => {
    const planes = data.planes.filter((p) => p.era === era).sort((a, b) => a.tier - b.tier);
    const pending = store.pendingRp;
    const p = store.profile;
    el.innerHTML = `
      <header class="setup__head">
        <button type="button" class="btn btn--secondary btn--small" data-act="close">Back</button>
        <h2>Research</h2>
        <p class="research__rp"><b data-testid="rp-balance">${rp(p.rp)}</b>${pending > 0 ? ` <small>+${pending.toLocaleString('en')} syncing</small>` : ''}<span class="research__status">${esc(message || statusLine())}</span></p>
      </header>
      <div class="setup__eras" role="radiogroup" aria-label="Era">
        ${data.eras
          .map((e) => `<button type="button" role="radio" class="chip" aria-checked="${e.id === era}" data-era="${e.id}">${esc(e.name)}<small>tier ${store.unlocks() === 'all' ? 10 : p.unlocked[e.id]} / 10</small></button>`)
          .join('')}
      </div>
      <ol class="research__tree" aria-label="${esc(data.eras.find((e) => e.id === era)?.name ?? '')} unlock tree">${planes.map(card).join('')}</ol>
      ${
        confirm
          ? `<div class="modal research__confirm" role="alertdialog" aria-label="Confirm unlock"><div class="modal__card">
              <h2>Unlock the ${esc(confirm.name)}?</h2>
              <p>Tier ${confirm.tier} costs <b>${rp(unlockCost(confirm.tier))}</b>. You'll have ${rp(p.rp - unlockCost(confirm.tier))} left.</p>
              <div class="research__confirm-go">
                <button type="button" class="btn btn--primary" data-act="confirm" ${busy ? 'disabled' : ''}>${busy ? 'Unlocking…' : 'Unlock'}</button>
                <button type="button" class="btn btn--secondary" data-act="cancel" ${busy ? 'disabled' : ''}>Cancel</button>
              </div>
            </div></div>`
          : ''
      }`;
  };

  const close = (): void => {
    dispose();
    deps.onClose?.();
  };

  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('button') : null;
    if (!t || t.hasAttribute('disabled')) return;
    const act = t.dataset['act'];
    if (act === 'close') return close();
    if (act === 'cancel') {
      confirm = null;
      return render();
    }
    if (act === 'confirm' && confirm) {
      const plane = confirm;
      busy = true;
      render();
      void store.buy(plane.era, plane.tier).then((res) => {
        busy = false;
        confirm = null;
        message =
          res === 'ok'
            ? `${plane.name} unlocked.`
            : res === 'offline'
              ? "Couldn't reach the server. Try again when you're online."
              : 'Not enough RP on your account (it may have been spent on another device).';
        if (res === 'ok') deps.onUnlocked?.();
        render();
      });
      return;
    }
    if (t.dataset['buy']) {
      confirm = data.planes.find((p) => p.id === t.dataset['buy']) ?? null;
      message = '';
      return render();
    }
    if (t.dataset['era']) {
      era = t.dataset['era'] as EraId;
      message = '';
      render();
    }
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (confirm && !busy) {
        confirm = null;
        render();
      } else if (!busy) close();
    }
  };
  window.addEventListener('keydown', onKey);
  const off = store.onChange(() => {
    if (!busy) render();
  });
  function dispose(): void {
    off();
    window.removeEventListener('keydown', onKey);
    el.remove();
  }

  render();
  return { dispose };
}
