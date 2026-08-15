// Streaming survey: as the camera roams at game zoom, fetch ~2 km Overpass
// tiles around the viewport, categorize them, and merge them into the world.
// Tiles far from the camera are evicted (unless the player edited something
// in them) so memory stays bounded no matter how much of the map is roamed.
import type { Store } from "./state";
import type { MapView } from "./mapview";
import { fetchBBox } from "./overpass";
import { categorize } from "./categorize";

const TILE_DLAT = 0.018; // ~2.0 km
const TILE_DLON = 0.023; // ~2.0 km at DMV latitudes
const MIN_ZOOM = 13.6;
const PAD = 0.25; // viewport padding fraction
const EVICT_M = 9000;
const MAX_FEATURES = 240_000;
const MAX_ATTEMPTS = 3;

export class TileManager {
  onStatus: ((inflight: number, queued: number) => void) | null = null;
  onLimit: (() => void) | null = null;

  private loaded = new Set<string>();
  private inflight = new Set<string>();
  private queue: string[] = [];
  private attempts = new Map<string, number>();
  private tileIds = new Map<string, string[]>();
  private limitWarned = false;

  constructor(
    private store: Store,
    private view: MapView,
  ) {
    view.map.on("moveend", () => this.update());
    store.on("place", () => this.seedFromBase());
  }

  /** Mark tiles covered by the bundled snapshot as already loaded. */
  private seedFromBase(): void {
    this.loaded.clear();
    this.tileIds.clear();
    this.attempts.clear();
    this.queue = [];
    const perTile = new Map<string, string[]>();
    for (const f of this.store.base.values()) {
      const c = firstCoord(f.geometry);
      if (!c) continue;
      const key = this.keyFor(c[1], c[0]);
      let arr = perTile.get(key);
      if (!arr) {
        arr = [];
        perTile.set(key, arr);
      }
      arr.push(f.properties.id);
    }
    // Only tiles with a meaningful feature count are considered surveyed;
    // fringe tiles clipped by the snapshot boundary should refetch fully.
    for (const [key, ids] of perTile) {
      if (ids.length >= 40) {
        this.loaded.add(key);
        this.tileIds.set(key, ids);
      }
    }
  }

  private keyFor(lat: number, lon: number): string {
    return `${Math.floor(lat / TILE_DLAT)}:${Math.floor(lon / TILE_DLON)}`;
  }

  private bboxFor(key: string): [number, number, number, number] {
    const [ty, tx] = key.split(":").map(Number);
    return [ty * TILE_DLAT, tx * TILE_DLON, (ty + 1) * TILE_DLAT, (tx + 1) * TILE_DLON];
  }

  update(): void {
    const map = this.view.map;
    if (map.getZoom() < MIN_ZOOM) return;
    const b = map.getBounds();
    const padLat = (b.getNorth() - b.getSouth()) * PAD;
    const padLon = (b.getEast() - b.getWest()) * PAD;
    const s = b.getSouth() - padLat;
    const n = b.getNorth() + padLat;
    const w = b.getWest() - padLon;
    const e = b.getEast() + padLon;

    const wanted: string[] = [];
    for (let ty = Math.floor(s / TILE_DLAT); ty <= Math.floor(n / TILE_DLAT); ty++) {
      for (let tx = Math.floor(w / TILE_DLON); tx <= Math.floor(e / TILE_DLON); tx++) {
        const key = `${ty}:${tx}`;
        if (
          !this.loaded.has(key) &&
          !this.inflight.has(key) &&
          (this.attempts.get(key) ?? 0) < MAX_ATTEMPTS
        ) {
          wanted.push(key);
        }
      }
    }
    // Fetch center-out, and drop stale queue entries that scrolled away.
    const cLat = (s + n) / 2;
    const cLon = (w + e) / 2;
    wanted.sort((a, b2) => this.distTo(a, cLat, cLon) - this.distTo(b2, cLat, cLon));
    this.queue = wanted;
    this.evict();
    this.pump();
  }

  private distTo(key: string, lat: number, lon: number): number {
    const [s, w, n, e] = this.bboxFor(key);
    const dy = (s + n) / 2 - lat;
    const dx = ((w + e) / 2 - lon) * Math.cos((lat * Math.PI) / 180);
    return dy * dy + dx * dx;
  }

  private pump(): void {
    while (this.inflight.size < 2 && this.queue.length) {
      if (this.store.base.size > MAX_FEATURES) {
        if (!this.limitWarned) {
          this.limitWarned = true;
          this.onLimit?.();
        }
        break;
      }
      const key = this.queue.shift()!;
      if (this.loaded.has(key) || this.inflight.has(key)) continue;
      this.inflight.add(key);
      this.report();
      void this.fetchTile(key).finally(() => {
        this.inflight.delete(key);
        this.report();
        this.pump();
      });
    }
  }

  private report(): void {
    this.onStatus?.(this.inflight.size, this.queue.length);
  }

  private async fetchTile(key: string): Promise<void> {
    this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
    try {
      const [s, w, n, e] = this.bboxFor(key);
      const raw = await fetchBBox(s, w, n, e);
      const features = categorize({ features: raw });
      const added = this.store.mergeBase(features);
      this.tileIds.set(key, added);
      this.loaded.add(key);
    } catch {
      // Overpass hiccup or rate limit; the tile stays eligible for a retry
      // on a later camera move, up to MAX_ATTEMPTS.
    }
  }

  private evict(): void {
    if (this.store.base.size < MAX_FEATURES * 0.8) return;
    const center = this.view.map.getCenter();
    const keep = this.store.referencedIds();
    for (const [key, ids] of this.tileIds) {
      const [s, w, n, e] = this.bboxFor(key);
      const dLat = ((s + n) / 2 - center.lat) * 110540;
      const dLon =
        ((w + e) / 2 - center.lng) * 111320 * Math.cos((center.lat * Math.PI) / 180);
      if (Math.sqrt(dLat * dLat + dLon * dLon) < EVICT_M) continue;
      const evictable = ids.filter((id) => !keep.has(id));
      if (evictable.length !== ids.length) continue; // player touched this tile
      this.store.evictBase(evictable);
      this.tileIds.delete(key);
      this.loaded.delete(key);
      this.limitWarned = false;
    }
  }
}

function firstCoord(g: GeoJSON.Geometry): [number, number] | null {
  switch (g.type) {
    case "Point":
      return g.coordinates as [number, number];
    case "LineString":
      return g.coordinates[0] as [number, number];
    case "Polygon":
      return g.coordinates[0]?.[0] as [number, number];
    case "MultiPolygon":
      return g.coordinates[0]?.[0]?.[0] as [number, number];
    case "MultiLineString":
      return g.coordinates[0]?.[0] as [number, number];
    default:
      return null;
  }
}
