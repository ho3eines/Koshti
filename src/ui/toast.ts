import { el } from './dom';

export type ToastKind = 'default' | 'gold' | 'green' | 'red' | 'blue';

class ToastLayer {
  private root: HTMLElement | null = null;
  private queue: HTMLElement[] = [];

  private ensure(): HTMLElement {
    if (this.root && this.root.isConnected) return this.root;
    this.root = el('div', { id: 'toast-layer' });
    document.getElementById('ui-root')?.appendChild(this.root);
    return this.root;
  }

  show(message: string, kind: ToastKind = 'default', duration = 2400, icon?: string): void {
    const root = this.ensure();
    const node = el('div', { class: `toast ${kind === 'default' ? '' : kind}` }, [
      icon ? el('span', { text: icon }) : null,
      el('span', { text: message }),
    ]);
    root.appendChild(node);
    this.queue.push(node);

    // Cap concurrent toasts so the screen never floods during a match.
    while (this.queue.length > 4) {
      const old = this.queue.shift();
      old?.remove();
    }

    globalThis.setTimeout(() => {
      node.classList.add('leaving');
      globalThis.setTimeout(() => {
        node.remove();
        this.queue = this.queue.filter((n) => n !== node);
      }, 250);
    }, duration);
  }

  clear(): void {
    this.root?.replaceChildren();
    this.queue = [];
  }
}

export const toast = new ToastLayer();
