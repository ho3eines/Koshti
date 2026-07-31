/** Minimal DOM helpers — no framework, no virtual DOM, no bundle bloat. */

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k === 'style') node.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};

export const frag = (children: Array<Node | null | undefined>): DocumentFragment => {
  const f = document.createDocumentFragment();
  for (const c of children) if (c) f.appendChild(c);
  return f;
};

export const clear = (node: HTMLElement): void => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

export const qs = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);

/** Animated number counter for reward reveals. */
export const countUp = (node: HTMLElement, to: number, duration = 700, prefix = ''): void => {
  const start = performance.now();
  const from = 0;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = prefix + Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

export const formatTime = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

export const formatRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export const stars = (n: number, max = 3): string => {
  let out = '';
  for (let i = 0; i < max; i++) out += i < n ? '★' : '<span class="off">★</span>';
  return out;
};

export const bar = (value: number, max: number, cls = ''): HTMLElement =>
  el('div', { class: `bar ${cls}` }, [
    el('i', { style: `width:${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%` }),
  ]);
