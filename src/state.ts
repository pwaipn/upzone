import type { EditAction, Feature } from "./types";

export type Mode = "sandbox" | "project";
type Listener = () => void;

export interface PlaceInfo {
  slug: string;
  name: string;
  center: [number, number];
  zoom: number;
}

export class Store {
  place: PlaceInfo = { slug: "", name: "", center: [0, 0], zoom: 15 };
  base = new Map<string, Feature>();
  edits: EditAction[] = [];
  cursor = 0; // edits[0..cursor) are applied
  mode: Mode = "sandbox";
  budgetTotal = 0;
  baselineParkingM2 = 0;

  private derived: Map<string, Feature> | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private idCounter = 1;

  on(event: "change" | "place" | "selection" | "mode", fn: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
  }

  emit(event: string): void {
    for (const fn of this.listeners.get(event) ?? []) fn();
  }

  selectedId: string | null = null;
  select(id: string | null): void {
    this.selectedId = id;
    this.emit("selection");
  }

  loadPlace(info: PlaceInfo, features: Feature[]): void {
    this.place = info;
    this.base = new Map(features.map((f) => [f.properties.id, f]));
    this.edits = [];
    this.cursor = 0;
    this.derived = null;
    this.selectedId = null;
    this.mode = "sandbox";
    this.restore();
    this.baselineParkingM2 = 0;
    for (const f of this.base.values()) {
      if (f.properties.kind === "parking") this.baselineParkingM2 += f.properties.areaM2 ?? 0;
    }
    this.emit("place");
    this.emit("change");
  }

  newId(): string {
    return `new-${Date.now().toString(36)}-${this.idCounter++}`;
  }

  /** Current world: base plus applied edits. */
  current(): Map<string, Feature> {
    if (this.derived) return this.derived;
    const m = new Map(this.base);
    for (let i = 0; i < this.cursor; i++) {
      const a = this.edits[i];
      switch (a.type) {
        case "demolish":
          m.delete(a.id);
          break;
        case "remodel": {
          const f = m.get(a.id);
          if (f) {
            m.set(a.id, {
              ...f,
              properties: {
                ...f.properties,
                use: a.use,
                levels: a.levels,
                height: Math.round(a.levels * 3.2 * 10) / 10,
                isNew: true,
              },
            });
          }
          break;
        }
        case "add":
          for (const f of a.features) m.set(f.properties.id, f);
          break;
        case "restreet": {
          const f = m.get(a.id);
          if (f) {
            m.set(a.id, {
              ...f,
              properties: {
                ...f.properties,
                ...(a.streetscape ? { streetscape: a.streetscape } : {}),
                ...(a.treeLined !== undefined ? { treeLined: a.treeLined } : {}),
              },
            });
          }
          break;
        }
        case "replace":
          m.delete(a.removeId);
          for (const f of a.features) m.set(f.properties.id, f);
          break;
      }
    }
    this.derived = m;
    return m;
  }

  features(): Feature[] {
    return [...this.current().values()];
  }

  get(id: string): Feature | undefined {
    return this.current().get(id);
  }

  spent(): number {
    let s = 0;
    for (let i = 0; i < this.cursor; i++) {
      if (!this.edits[i].sandbox) s += this.edits[i].cost;
    }
    return s;
  }

  remaining(): number {
    return this.budgetTotal - this.spent();
  }

  /** Apply an action. In project mode, refuses if it would exceed the budget. */
  apply(a: EditAction): { ok: boolean; reason?: string } {
    if (this.mode === "project" && a.cost > this.remaining()) {
      return { ok: false, reason: "Not enough budget left for that." };
    }
    if (this.mode === "sandbox") a.sandbox = true;
    this.edits.length = this.cursor;
    this.edits.push(a);
    this.cursor++;
    this.derived = null;
    this.persist();
    this.emit("change");
    return { ok: true };
  }

  undo(): void {
    if (this.cursor === 0) return;
    this.cursor--;
    this.derived = null;
    this.persist();
    this.emit("change");
  }

  redo(): void {
    if (this.cursor >= this.edits.length) return;
    this.cursor++;
    this.derived = null;
    this.persist();
    this.emit("change");
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }
  canRedo(): boolean {
    return this.cursor < this.edits.length;
  }

  setMode(mode: Mode, budget = 0): void {
    this.mode = mode;
    this.budgetTotal = budget;
    this.persist();
    this.emit("mode");
    this.emit("change");
  }

  private storageKey(): string {
    return `upzone:${this.place.slug}`;
  }

  persist(): void {
    if (!this.place.slug) return;
    try {
      localStorage.setItem(
        this.storageKey(),
        JSON.stringify({
          edits: this.edits,
          cursor: this.cursor,
          mode: this.mode,
          budgetTotal: this.budgetTotal,
        }),
      );
    } catch {
      // storage full or unavailable; play on without saving
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.edits)) {
        this.edits = data.edits;
        this.cursor = Math.min(data.cursor ?? this.edits.length, this.edits.length);
        this.mode = data.mode === "project" ? "project" : "sandbox";
        this.budgetTotal = data.budgetTotal ?? 0;
      }
    } catch {
      // corrupted save; start fresh
    }
  }

  exportJSON(): string {
    return JSON.stringify(
      {
        place: this.place,
        edits: this.edits,
        cursor: this.cursor,
        mode: this.mode,
        budgetTotal: this.budgetTotal,
      },
      null,
      2,
    );
  }

  importJSON(text: string): boolean {
    try {
      const data = JSON.parse(text);
      if (data.place?.slug !== this.place.slug) return false;
      if (!Array.isArray(data.edits)) return false;
      this.edits = data.edits;
      this.cursor = Math.min(
        Math.max(0, data.cursor ?? this.edits.length),
        this.edits.length,
      );
      this.mode = data.mode === "project" ? "project" : "sandbox";
      this.budgetTotal = typeof data.budgetTotal === "number" ? data.budgetTotal : 0;
      this.derived = null;
      this.persist();
      this.emit("mode");
      this.emit("change");
      return true;
    } catch {
      return false;
    }
  }
}
