// Plan-sheet UI: title-block panels, a toolbar of drafting tools, the
// inspector, and the district review stamp.
import type { Scores } from "./types";
import { fmtArea, fmtMoney } from "./types";
import type { Store } from "./state";
import type { Tools, ToolName } from "./tools";
import { BUILDING_PRESETS, convertParking, demolish, remodel, restreet } from "./edits";
import type { GoalResult, Scenario } from "./scenario";
import { grade } from "./score";
import type { GeocodeResult } from "./overpass";
import { geocode } from "./overpass";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const ICONS: Record<string, string> = {
  select: `<svg viewBox="0 0 18 18"><path d="M4 2l9 8-4 1 2.5 4.5-2 1L7 12l-3 3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  bulldoze: `<svg viewBox="0 0 18 18"><path d="M3 15h12M5 15V8h5v7M10 10h4v5M4 5l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 3.5l8 8" stroke="currentColor" stroke-width="1.4"/></svg>`,
  build: `<svg viewBox="0 0 18 18"><path d="M3 15V6h5v9M8 15V3h7v12M3 15h13" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 5.5h2M10.5 8h2M10.5 10.5h2" stroke="currentColor" stroke-width="1.2"/></svg>`,
  trace: `<svg viewBox="0 0 18 18"><path d="M4 6l6-3 5 4-2 8-8 1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="10" cy="3" r="1.5" fill="currentColor"/><circle cx="15" cy="7" r="1.5" fill="currentColor"/></svg>`,
  road: `<svg viewBox="0 0 18 18"><path d="M5 16C5 10 8 8 13 2M9 16c0-6 3-8 7-12" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  rail: `<svg viewBox="0 0 18 18"><path d="M3 14L14 3" stroke="currentColor" stroke-width="1.6"/><path d="M5 10l2 2M8 7l2 2M11 4l2 2" stroke="currentColor" stroke-width="1.2"/></svg>`,
  station: `<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="9" r="1.4" fill="currentColor"/></svg>`,
  lens: `<svg viewBox="0 0 18 18"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 12l4 4" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 8h5" stroke="currentColor" stroke-width="1.4"/></svg>`,
};

export interface UICallbacks {
  onSearchPick(r: GeocodeResult): void;
  onToggleLens(): boolean;
  onStartProject(): void;
  onEndProject(): void;
  onExportReport(): void;
}

export class UI {
  private rightRail!: HTMLElement;
  private inspector!: HTMLElement;
  private scoreBars!: HTMLElement;
  private stampWrap!: HTMLElement;
  private scenarioBox!: HTMLElement;
  private budgetLine!: HTMLElement;
  private placeNameEl!: HTMLElement;
  private toasts!: HTMLElement;
  private overlay!: HTMLElement;
  private overlayMsg!: HTMLElement;
  private toolButtons = new Map<ToolName, HTMLButtonElement>();
  private draftStats: HTMLElement | null = null;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private lensBtn!: HTMLButtonElement;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private tools: Tools,
    private cb: UICallbacks,
    private scenarioProvider: () => Scenario | null,
  ) {
    this.buildTopbar();
    this.rightRail = el("div", "rightrail");
    this.root.appendChild(this.rightRail);
    this.buildInspector();
    this.buildToolbar();
    this.buildScorePanel();
    this.toasts = el("div", "toasts");
    this.root.appendChild(this.toasts);
    this.overlay = el("div", "overlay hidden");
    const obox = el("div", "panel overlay-box");
    obox.appendChild(el("h2", "panel-title", "Field survey"));
    this.overlayMsg = el("p", "", "Loading…");
    obox.appendChild(this.overlayMsg);
    this.overlay.appendChild(obox);
    this.root.appendChild(this.overlay);

    store.on("selection", () => this.renderInspector());
    store.on("change", () => {
      this.undoBtn.disabled = !store.canUndo();
      this.redoBtn.disabled = !store.canRedo();
      this.renderBudget();
      this.renderInspector();
    });
    store.on("mode", () => this.renderBudget());
    store.on("place", () => {
      this.placeNameEl.textContent = store.place.name;
      this.renderBudget();
      this.renderInspector();
    });
    tools.onToolChange = () => this.syncToolButtons();
    tools.onDraftChange = (vertices, lengthM) => {
      if (!this.draftStats) return;
      if (vertices === 0) {
        this.draftStats.textContent = "";
        return;
      }
      const t = this.tools.active;
      let est = "";
      if (t === "rail") {
        est = fmtMoney((lengthM / 1000) * 90_000_000 + 2 * 45_000_000);
      } else if (t === "road") {
        est = fmtMoney((lengthM / 1000) * 7_000_000);
      }
      this.draftStats.textContent =
        `${vertices} ${vertices === 1 ? "point" : "points"} · ${(lengthM / 1000).toFixed(2)} km` +
        (est ? ` · about ${est}` : "");
    };
    tools.onActionResult = (msg, ok) => {
      if (msg) this.toast(msg, ok);
    };
  }

  // ---- top bar ----------------------------------------------------------
  private buildTopbar(): void {
    const bar = el("header", "topbar panel");
    const brand = el("div", "brand");
    brand.appendChild(el("span", "wordmark", "UPZONE"));
    this.placeNameEl = el("span", "place-name", "");
    brand.appendChild(this.placeNameEl);
    bar.appendChild(brand);

    const search = el("div", "search");
    const input = el("input") as HTMLInputElement;
    input.placeholder = "Survey another place…";
    input.setAttribute("aria-label", "Search for a place");
    const results = el("div", "search-results hidden");
    let searchGen = 0;
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      const gen = ++searchGen;
      results.textContent = "";
      results.classList.remove("hidden");
      results.appendChild(el("div", "search-hint", "Searching…"));
      try {
        const found = await geocode(input.value.trim());
        if (gen !== searchGen) return;
        results.textContent = "";
        if (!found.length) {
          results.appendChild(el("div", "search-hint", "Nothing found by that name."));
          return;
        }
        for (const r of found) {
          const b = el("button", "search-result", r.name);
          b.addEventListener("click", () => {
            results.classList.add("hidden");
            input.value = "";
            this.cb.onSearchPick(r);
          });
          results.appendChild(b);
        }
      } catch (err) {
        if (gen !== searchGen) return;
        results.textContent = "";
        results.appendChild(el("div", "search-hint", String((err as Error).message)));
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => results.classList.add("hidden"), 250);
    });
    search.appendChild(input);
    search.appendChild(results);
    bar.appendChild(search);

    const actions = el("div", "topbar-actions");
    this.undoBtn = el("button", "btn", "Undo");
    this.undoBtn.disabled = true;
    this.undoBtn.addEventListener("click", () => this.store.undo());
    this.redoBtn = el("button", "btn", "Redo");
    this.redoBtn.disabled = true;
    this.redoBtn.addEventListener("click", () => this.store.redo());
    const exportBtn = el("button", "btn", "Export");
    exportBtn.addEventListener("click", () => {
      const blob = new Blob([this.store.exportJSON()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `upzone-${this.store.place.slug}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    const reportBtn = el("button", "btn", "Report");
    reportBtn.title = "Export a before-and-after district review sheet as an image";
    reportBtn.addEventListener("click", () => this.cb.onExportReport());
    const importBtn = el("button", "btn", "Import");
    const file = el("input") as HTMLInputElement;
    file.type = "file";
    file.accept = "application/json";
    file.style.display = "none";
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      const ok = this.store.importJSON(await f.text());
      this.toast(ok ? "Plan imported." : "That file does not match this place.", ok);
      file.value = "";
    });
    importBtn.addEventListener("click", () => file.click());
    actions.appendChild(this.undoBtn);
    actions.appendChild(this.redoBtn);
    actions.appendChild(reportBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(importBtn);
    actions.appendChild(file);
    bar.appendChild(actions);
    this.root.appendChild(bar);
  }

  // ---- toolbar ----------------------------------------------------------
  private buildToolbar(): void {
    const bar = el("nav", "toolbar panel");
    const tools: { name: ToolName; label: string; hint: string }[] = [
      { name: "select", label: "Inspect", hint: "Click anything to read its file card" },
      { name: "bulldoze", label: "Bulldoze", hint: "Click a building or parking lot to clear it" },
      { name: "build", label: "Build", hint: "Click to place; footprints align to the nearest street" },
      { name: "trace", label: "Trace", hint: "Click the corners of a custom footprint, then finish" },
      { name: "road", label: "Street", hint: "Click corners, then press Enter or double-click to pave" },
      { name: "rail", label: "Light rail", hint: "Click the route, then Enter. Termini get stations" },
      { name: "station", label: "Station", hint: "Click along any rail line to add a stop" },
    ];
    for (const t of tools) {
      const b = el("button", "tool") as HTMLButtonElement;
      b.innerHTML = `${ICONS[t.name]}<span>${t.label}</span>`;
      b.title = t.hint;
      b.addEventListener("click", () => this.tools.setTool(t.name));
      this.toolButtons.set(t.name, b);
      bar.appendChild(b);
    }
    const sep = el("div", "tool-rule");
    bar.appendChild(sep);
    this.lensBtn = el("button", "tool") as HTMLButtonElement;
    this.lensBtn.innerHTML = `${ICONS.lens}<span>Walk lens</span>`;
    this.lensBtn.title = "Color every street by its walkability";
    this.lensBtn.addEventListener("click", () => {
      const on = this.cb.onToggleLens();
      this.lensBtn.classList.toggle("active", on);
    });
    bar.appendChild(this.lensBtn);
    this.root.appendChild(bar);
    this.syncToolButtons();
  }

  private syncToolButtons(): void {
    for (const [name, b] of this.toolButtons) {
      b.classList.toggle("active", name === this.tools.active);
    }
    this.renderInspector();
  }

  // ---- inspector --------------------------------------------------------
  private buildInspector(): void {
    this.inspector = el("aside", "inspector panel");
    this.rightRail.appendChild(this.inspector);
    this.renderInspector();
  }

  private actionButton(labelText: string, cost: number, run: () => void): HTMLElement {
    const b = el("button", "action");
    b.appendChild(el("span", "", labelText));
    b.appendChild(el("span", "cost", this.store.mode === "project" ? fmtMoney(cost) : "free"));
    b.addEventListener("click", run);
    return b;
  }

  renderInspector(): void {
    const box = this.inspector;
    box.textContent = "";
    const title = el("h2", "panel-title");
    box.appendChild(title);

    if (this.tools.active === "build" || this.tools.active === "trace") {
      title.textContent = this.tools.active === "build" ? "Building catalog" : "Trace a footprint";
      for (const p of BUILDING_PRESETS) {
        const b = el("button", "action preset");
        b.appendChild(el("span", "", p.name));
        b.appendChild(el("span", "cost", `${p.levels} floors · ${p.widthM}×${p.depthM} m`));
        b.classList.toggle("active", p.key === this.tools.preset.key);
        b.addEventListener("click", () => {
          this.tools.setPreset(p);
          this.renderInspector();
        });
        box.appendChild(b);
      }
      if (this.tools.active === "build") {
        box.appendChild(
          el("p", "hint", "Click the map to place it. The footprint turns itself to face the nearest street."),
        );
      } else {
        box.appendChild(
          el("p", "hint", "Click each corner of the footprint you want, in order. The chosen catalog entry sets the use and floors."),
        );
        const finish = el("button", "action", "Raise the building");
        finish.addEventListener("click", () => this.tools.finishDraft());
        box.appendChild(finish);
        const cancel = el("button", "action", "Scrap the draft");
        cancel.addEventListener("click", () => this.tools.cancelDraft());
        box.appendChild(cancel);
        this.draftStats = el("p", "meta draft-stats", "");
        box.appendChild(this.draftStats);
      }
      return;
    }
    if (this.tools.active === "road" || this.tools.active === "rail") {
      title.textContent = this.tools.active === "road" ? "New street" : "New light rail";
      box.appendChild(
        el("p", "hint",
          this.tools.active === "road"
            ? "Click each corner of the alignment. Corners snap to existing streets so the network stays connected."
            : "Click along the route you want the line to take. Both ends get a station, and the Station tool adds more along the way."),
      );
      const finish = el("button", "action", "Finish the line");
      finish.addEventListener("click", () => this.tools.finishDraft());
      box.appendChild(finish);
      const cancel = el("button", "action", "Scrap the draft");
      cancel.addEventListener("click", () => this.tools.cancelDraft());
      box.appendChild(cancel);
      this.draftStats = el("p", "meta draft-stats", "");
      box.appendChild(this.draftStats);
      box.appendChild(
        el("p", "hint", "Enter and double-click also finish. Escape scraps it."),
      );
      return;
    }
    if (this.tools.active === "bulldoze") {
      title.textContent = "Bulldozer";
      box.appendChild(
        el("p", "hint", "Click a building or a parking lot to clear it. Undo brings anything back."),
      );
      return;
    }
    if (this.tools.active === "station") {
      title.textContent = "New station";
      box.appendChild(el("p", "hint", "Click along any rail line to open a station there."));
      return;
    }

    const id = this.store.selectedId;
    const f = id ? this.store.get(id) : undefined;
    if (!f) {
      title.textContent = "Site survey";
      box.appendChild(
        el("p", "hint",
          "Click anything on the sheet to open its file card. Drag to pan, pinch to zoom, and hold Control while dragging to tilt the drawing."),
      );
      box.appendChild(
        el("p", "hint",
          "The district gets graded on the New Urbanist basics: walkable streets, transit within reach, real density, and green space winning against asphalt."),
      );
      return;
    }

    const p = f.properties;
    if (p.kind === "building") {
      title.textContent = p.name ?? "Building";
      const useNames: Record<string, string> = {
        retail: "Retail", mixeduse: "Mixed use", apartment: "Apartments",
        house: "House", office: "Offices", civic: "Civic", garage: "Parking garage",
        other: "Building",
      };
      box.appendChild(
        el("p", "meta", `${useNames[p.use ?? "other"]} · ${p.levels ?? 1} ${(p.levels ?? 1) === 1 ? "floor" : "floors"} · ${fmtArea(p.areaM2 ?? 0)}`),
      );
      const r1 = remodel(f, "mixeduse", 3);
      box.appendChild(this.actionButton("Redevelop: mixed use, 3 floors", r1.cost, () => this.apply(r1)));
      const r2 = remodel(f, "mixeduse", 5);
      box.appendChild(this.actionButton("Redevelop: mixed use, 5 floors", r2.cost, () => this.apply(r2)));
      const r3 = remodel(f, "apartment", 4);
      box.appendChild(this.actionButton("Redevelop: apartments, 4 floors", r3.cost, () => this.apply(r3)));
      const up = remodel(f, p.use ?? "other", (p.levels ?? 1) + 1);
      box.appendChild(this.actionButton("Add a floor", up.cost, () => this.apply(up)));
      const d = demolish(f);
      box.appendChild(this.actionButton("Bulldoze", d.cost, () => this.apply(d)));
      return;
    }
    if (p.kind === "parking") {
      title.textContent = p.name ?? "Surface parking";
      box.appendChild(el("p", "meta", `Surface lot · ${fmtArea(p.areaM2 ?? 0)} of asphalt`));
      const mk = (labelText: string, to: Parameters<typeof convertParking>[2]) => {
        const a = convertParking(this.store, f, to);
        if ("error" in a) return;
        box.appendChild(this.actionButton(labelText, a.cost, () => this.apply(a)));
      };
      mk("Building in front, parking behind", "behind");
      mk("Replace with mixed-use building", "building");
      mk("Replace with a park", "park");
      mk("Replace with a plaza", "plaza");
      const d = demolish(f);
      box.appendChild(this.actionButton("Bulldoze to bare ground", d.cost, () => this.apply(d)));
      return;
    }
    if (p.kind === "road") {
      title.textContent = p.name ?? "Street";
      const state =
        p.streetscape === "pedestrianized" ? " · pedestrianized"
        : p.streetscape === "dieted" ? " · road-dieted"
        : p.treeLined ? " · tree-lined"
        : "";
      box.appendChild(
        el("p", "meta", `Class: ${p.roadClass ?? "street"}${state}${p.isNew ? " · built by you" : ""}`),
      );
      const dietable = ["primary", "secondary", "tertiary", "residential"].includes(p.roadClass ?? "");
      if (dietable) {
        if (!p.treeLined) {
          const t = restreet(f, "trees");
          box.appendChild(this.actionButton("Plant street trees", t.cost, () => this.apply(t)));
        }
        if (p.streetscape !== "dieted" && p.streetscape !== "pedestrianized") {
          const d2 = restreet(f, "diet");
          box.appendChild(
            this.actionButton("Road diet: bike lanes and trees", d2.cost, () => this.apply(d2)),
          );
        }
        if (p.streetscape !== "pedestrianized" && p.roadClass !== "primary") {
          const pz = restreet(f, "pedestrianize");
          box.appendChild(
            this.actionButton("Pedestrianize the street", pz.cost, () => this.apply(pz)),
          );
        }
      }
      if (p.isNew) {
        const d = demolish(f);
        box.appendChild(this.actionButton("Tear out", d.cost, () => this.apply(d)));
      }
      return;
    }
    if (p.kind === "rail") {
      title.textContent = p.name ?? (p.railKind === "metro" ? "Heavy rail" : "Light rail");
      box.appendChild(el("p", "meta", p.railKind === "metro" ? "Existing heavy rail" : "Light rail"));
      if (p.isNew) {
        const d = demolish(f);
        box.appendChild(this.actionButton("Tear out", d.cost, () => this.apply(d)));
      }
      return;
    }
    if (p.kind === "station") {
      title.textContent = p.name ?? "Station";
      box.appendChild(el("p", "meta", p.railKind === "metro" ? "Metro station" : "Light rail station"));
      return;
    }
    title.textContent = p.name ?? p.kind;
    if (p.areaM2) box.appendChild(el("p", "meta", fmtArea(p.areaM2)));
  }

  private apply(action: Parameters<Store["apply"]>[0]): void {
    const res = this.store.apply(action);
    this.toast(res.ok ? action.label : res.reason ?? "", res.ok);
  }

  // ---- score panel ------------------------------------------------------
  private buildScorePanel(): void {
    const panel = el("section", "scorepanel panel");
    panel.appendChild(el("h2", "panel-title", "District review"));
    const row = el("div", "score-row");
    this.stampWrap = el("div", "stamp-wrap");
    row.appendChild(this.stampWrap);
    this.scoreBars = el("div", "score-bars");
    row.appendChild(this.scoreBars);
    panel.appendChild(row);
    this.budgetLine = el("div", "budget-line");
    panel.appendChild(this.budgetLine);
    this.scenarioBox = el("div", "scenario");
    panel.appendChild(this.scenarioBox);
    this.rightRail.appendChild(panel);
    this.renderBudget();
  }

  updateScores(s: Scores): void {
    const bars: [string, number][] = [
      ["Walkability", s.walk],
      ["Transit", s.transit],
      ["Density", s.density],
      ["Green vs. asphalt", s.green],
    ];
    this.scoreBars.textContent = "";
    for (const [name, v] of bars) {
      const rowEl = el("div", "bar-row");
      rowEl.appendChild(el("span", "bar-name", name));
      const track = el("div", "bar-track");
      const fill = el("div", "bar-fill");
      fill.style.width = `${Math.max(2, v)}%`;
      track.appendChild(fill);
      rowEl.appendChild(track);
      rowEl.appendChild(el("span", "bar-val", String(v)));
      this.scoreBars.appendChild(rowEl);
    }
    const g = grade(s.overall);
    this.stampWrap.innerHTML = `
      <svg class="stamp" viewBox="0 0 120 120" role="img" aria-label="District grade ${g}">
        <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="3"/>
        <circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" stroke-width="1.2"/>
        <text x="60" y="30" text-anchor="middle" class="stamp-small">DISTRICT</text>
        <text x="60" y="78" text-anchor="middle" class="stamp-grade">${g}</text>
        <text x="60" y="98" text-anchor="middle" class="stamp-small">SCORE ${s.overall}</text>
      </svg>`;
    const svg = this.stampWrap.querySelector(".stamp");
    if (svg) {
      svg.classList.add("thump");
      window.setTimeout(() => svg.classList.remove("thump"), 350);
    }
  }

  renderBudget(): void {
    const s = this.store;
    this.budgetLine.textContent = "";
    if (s.mode === "project") {
      const line = el("div", "budget-amounts");
      line.appendChild(el("span", "", "Budget"));
      const amt = el("span", "budget-num", `${fmtMoney(s.spent())} of ${fmtMoney(s.budgetTotal)}`);
      if (s.remaining() < s.budgetTotal * 0.1) amt.classList.add("low");
      line.appendChild(amt);
      this.budgetLine.appendChild(line);
      const end = el("button", "btn subtle", "Close the project");
      end.addEventListener("click", () => this.cb.onEndProject());
      this.budgetLine.appendChild(end);
    } else {
      const sc = this.scenarioProvider();
      if (sc) {
        const start = el("button", "btn primary", `Open project: ${sc.name}`);
        start.title = sc.brief;
        start.addEventListener("click", () => this.cb.onStartProject());
        this.budgetLine.appendChild(start);
      } else {
        this.budgetLine.appendChild(el("div", "budget-amounts", "Charrette mode, everything is free"));
      }
    }
  }

  updateScenario(goals: GoalResult[] | null, brief?: string): void {
    this.scenarioBox.textContent = "";
    if (!goals) return;
    if (brief) this.scenarioBox.appendChild(el("p", "hint", brief));
    for (const goalItem of goals) {
      const rowEl = el("div", `goal ${goalItem.done ? "done" : ""}`);
      rowEl.appendChild(el("span", "goal-check", goalItem.done ? "■" : "□"));
      const t = el("div", "goal-text");
      t.appendChild(el("div", "", goalItem.text));
      if (goalItem.detail) t.appendChild(el("div", "goal-detail", goalItem.detail));
      rowEl.appendChild(t);
      this.scenarioBox.appendChild(rowEl);
    }
  }

  toast(msg: string, ok: boolean): void {
    const t = el("div", `toast ${ok ? "" : "warn"}`, msg);
    this.toasts.appendChild(t);
    window.setTimeout(() => t.classList.add("show"), 10);
    window.setTimeout(() => {
      t.classList.remove("show");
      window.setTimeout(() => t.remove(), 400);
    }, 2600);
  }

  showOverlay(msg: string | null): void {
    if (msg === null) {
      this.overlay.classList.add("hidden");
    } else {
      this.overlay.classList.remove("hidden");
      this.overlayMsg.textContent = msg;
    }
  }
}
