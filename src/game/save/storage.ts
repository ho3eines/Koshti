import { migrate, newSave, SAVE_VERSION, type SaveGame } from './schema';

const KEY = 'koshti.save.v1';
const BACKUP_KEY = 'koshti.save.backup';
const SLOT_MANUAL = 'koshti.save.manual';

/**
 * Storage adapter. Uses Capacitor Preferences on device (survives app data
 * clears better than WebView localStorage and works with cloud backup), and
 * falls back to localStorage / memory in the browser and in tests.
 */
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

class MemoryAdapter implements StorageAdapter {
  private m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.m.set(k, v);
  }
  async remove(k: string) {
    this.m.delete(k);
  }
}

class LocalStorageAdapter implements StorageAdapter {
  async get(k: string) {
    try {
      return globalThis.localStorage.getItem(k);
    } catch {
      return null;
    }
  }
  async set(k: string, v: string) {
    try {
      globalThis.localStorage.setItem(k, v);
    } catch {
      /* quota — ignore, memory copy still valid */
    }
  }
  async remove(k: string) {
    try {
      globalThis.localStorage.removeItem(k);
    } catch {
      /* noop */
    }
  }
}

class CapacitorAdapter implements StorageAdapter {
  constructor(private prefs: { get: (o: { key: string }) => Promise<{ value: string | null }>; set: (o: { key: string; value: string }) => Promise<void>; remove: (o: { key: string }) => Promise<void> }) {}
  async get(k: string) {
    return (await this.prefs.get({ key: k })).value;
  }
  async set(k: string, v: string) {
    await this.prefs.set({ key: k, value: v });
  }
  async remove(k: string) {
    await this.prefs.remove({ key: k });
  }
}

const pickAdapter = async (): Promise<StorageAdapter> => {
  try {
    const cap = (globalThis as Record<string, unknown>)['Capacitor'] as
      | { isNativePlatform?: () => boolean }
      | undefined;
    if (cap?.isNativePlatform?.()) {
      const mod = await import('@capacitor/preferences');
      return new CapacitorAdapter(mod.Preferences);
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem('__koshti_probe', '1');
      globalThis.localStorage.removeItem('__koshti_probe');
      return new LocalStorageAdapter();
    }
  } catch {
    /* fall through */
  }
  return new MemoryAdapter();
};

export interface SaveMeta {
  exists: boolean;
  name?: string;
  level?: number;
  division?: string;
  savedAt?: number;
  label?: string;
}

/**
 * SaveManager — write-behind autosave with debounce so we never block a frame,
 * plus a rotating backup so a corrupt write can't destroy a career.
 */
export class SaveManager {
  private adapter: StorageAdapter | null = null;
  private ready: Promise<void>;
  private dirty = false;
  private writing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: SaveGame | null = null;
  private lastWrite = 0;

  /** Autosave debounce in ms. */
  debounceMs = 900;

  onSaved?: (label: string) => void;

  constructor(adapter?: StorageAdapter) {
    this.ready = adapter
      ? ((this.adapter = adapter), Promise.resolve())
      : pickAdapter().then((a) => {
          this.adapter = a;
        });
  }

  async init(): Promise<void> {
    await this.ready;
  }

  async peek(): Promise<SaveMeta> {
    await this.ready;
    const raw = await this.adapter!.get(KEY);
    if (!raw) return { exists: false };
    try {
      const parsed = JSON.parse(raw) as SaveGame;
      return {
        exists: true,
        name: parsed.profile?.name,
        level: parsed.profile?.level,
        division: parsed.league?.division,
        savedAt: parsed.checkpoint?.savedAt,
        label: parsed.checkpoint?.label,
      };
    } catch {
      return { exists: false };
    }
  }

  async load(): Promise<SaveGame | null> {
    await this.ready;
    for (const key of [KEY, BACKUP_KEY]) {
      const raw = await this.adapter!.get(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const save = migrate(parsed);
        if (save) {
          this.current = save;
          return save;
        }
      } catch {
        /* try the backup next */
      }
    }
    return null;
  }

  async create(name: string): Promise<SaveGame> {
    await this.ready;
    const save = newSave(name.trim().slice(0, 20) || 'Rookie');
    this.current = save;
    await this.flush('New career created');
    return save;
  }

  attach(save: SaveGame): void {
    this.current = save;
  }

  /** Mark dirty; a write is scheduled on the debounce. */
  queue(label = 'Autosave'): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(label), this.debounceMs);
  }

  /** Immediate write — used after matches, purchases and milestones. */
  async flush(label = 'Autosave'): Promise<void> {
    await this.ready;
    if (!this.current || this.writing) return;
    this.writing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      this.current.version = SAVE_VERSION;
      this.current.checkpoint.savedAt = Date.now();
      this.current.checkpoint.label = label;
      const json = JSON.stringify(this.current);
      // Rotate previous good save into the backup slot first.
      const prev = await this.adapter!.get(KEY);
      if (prev && Date.now() - this.lastWrite > 15000) {
        await this.adapter!.set(BACKUP_KEY, prev);
      }
      await this.adapter!.set(KEY, json);
      this.lastWrite = Date.now();
      this.dirty = false;
      this.onSaved?.(label);
    } finally {
      this.writing = false;
    }
  }

  async manualSave(): Promise<void> {
    await this.flush('Manual save');
    if (!this.current) return;
    await this.adapter!.set(SLOT_MANUAL, JSON.stringify(this.current));
  }

  async loadManual(): Promise<SaveGame | null> {
    await this.ready;
    const raw = await this.adapter!.get(SLOT_MANUAL);
    if (!raw) return null;
    try {
      const save = migrate(JSON.parse(raw));
      if (save) this.current = save;
      return save;
    } catch {
      return null;
    }
  }

  async hasManual(): Promise<boolean> {
    await this.ready;
    return (await this.adapter!.get(SLOT_MANUAL)) !== null;
  }

  async wipe(): Promise<void> {
    await this.ready;
    await this.adapter!.remove(KEY);
    await this.adapter!.remove(BACKUP_KEY);
    await this.adapter!.remove(SLOT_MANUAL);
    this.current = null;
  }

  /** Export/import for cloud sync or manual transfer. */
  exportString(): string {
    if (!this.current) throw new Error('No save loaded');
    return btoa(encodeURIComponent(JSON.stringify(this.current)));
  }

  async importString(data: string): Promise<SaveGame | null> {
    try {
      const save = migrate(JSON.parse(decodeURIComponent(atob(data))));
      if (!save) return null;
      this.current = save;
      await this.flush('Imported save');
      return save;
    } catch {
      return null;
    }
  }

  get isDirty(): boolean {
    return this.dirty;
  }
}
