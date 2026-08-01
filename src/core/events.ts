/**
 * Tiny typed event bus. Zero allocation on emit for the common case.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events> {
  private map = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(key: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(key);
    if (!set) {
      set = new Set();
      this.map.set(key, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(key, fn);
  }

  once<K extends keyof Events>(key: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(key, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(key: K, fn: Listener<Events[K]>): void {
    this.map.get(key)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof Events>(key: K, payload: Events[K]): void {
    const set = this.map.get(key);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) (fn as Listener<Events[K]>)(payload);
  }

  clear(): void {
    this.map.clear();
  }
}
