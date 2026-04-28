import * as XLSX from "xlsx";

export interface Dataset {
  id: string;
  name: string;
  rows: Record<string, unknown>[];
  headers: string[];
  values: Set<string>; // normalized cell values for intersection
  x: number;
  y: number;
  /** Size multiplier for the oval (1 = default). Adjust via mouse wheel. */
  scale: number;
  colorVar: string; // e.g. "--dataset-1"
}

export const DATASET_COLORS = [
  "--dataset-1",
  "--dataset-2",
  "--dataset-3",
  "--dataset-4",
  "--dataset-5",
  "--dataset-6",
];

export const normalizeValue = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  return String(v).trim().toLowerCase();
};

export const extractValues = (rows: Record<string, unknown>[]): Set<string> => {
  const set = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      const n = normalizeValue(row[k]);
      if (n !== "") set.add(n);
    }
  }
  return set;
};

export const parseFile = async (file: File): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> => {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, headers };
};

// Geometry: tilted ellipses (45 deg). Use rotated-frame coordinates for hit-test.
export const ELLIPSE_RX = 220; // along tilted axis
export const ELLIPSE_RY = 130; // perpendicular
export const ELLIPSE_ROT_DEG = -25;

const rotatePoint = (px: number, py: number, cx: number, cy: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const dx = px - cx;
  const dy = py - cy;
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
};

export const pointInEllipse = (px: number, py: number, cx: number, cy: number, scale = 1) => {
  const { x, y } = rotatePoint(px, py, cx, cy, ELLIPSE_ROT_DEG);
  const rx = ELLIPSE_RX * scale;
  const ry = ELLIPSE_RY * scale;
  return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
};

export const ellipsesOverlap = (a: Dataset, b: Dataset) => {
  // sample boundary of A; if any sample is inside B, overlap
  const steps = 36;
  const rad = (ELLIPSE_ROT_DEG * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const lx = ELLIPSE_RX * Math.cos(t);
    const ly = ELLIPSE_RY * Math.sin(t);
    const wx = a.x + lx * cos - ly * sin;
    const wy = a.y + lx * sin + ly * cos;
    if (pointInEllipse(wx, wy, b.x, b.y)) return true;
  }
  // also test centers (one inside the other)
  if (pointInEllipse(a.x, a.y, b.x, b.y)) return true;
  if (pointInEllipse(b.x, b.y, a.x, a.y)) return true;
  return false;
};

export interface IntersectionGroup {
  id: string;
  datasetIds: string[];
  /** Shared cell values (lowercased, trimmed). */
  sharedValues: string[];
  /** Rows per dataset that contain a shared value. Materialized on demand. */
  rowsByDataset: Record<string, Record<string, unknown>[]>;
  /**
   * Per dataset: the column that holds the matched value most often.
   * Rows in `rowsByDataset` are sorted by this column so common values line up.
   */
  anchorColumnByDataset: Record<string, string>;
  /** Per dataset row → normalized matched value (same order as rowsByDataset). */
  matchedValueByDataset: Record<string, string[]>;
  centerX: number;
  centerY: number;
  /** HSL hue assigned for this group's color */
  hue: number;
  /** Display name, e.g. "A ∩ B ∩ C" */
  label: string;
}

/**
 * Lightweight per-frame info: which subsets overlap, how many shared values,
 * where to draw the chip. Skips per-row materialization (the slow part).
 */
export interface IntersectionRegion {
  id: string;
  datasetIds: string[];
  sharedCount: number;
  centerX: number;
  centerY: number;
  hue: number;
  label: string;
}

// Cache pairwise shared-value lists. Datasets are immutable once loaded
// (rows/values never change), so caching by id pair is safe.
const pairCache = new Map<string, string[]>();
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const sharedValuesFor = (datasets: Dataset[], ids: string[]): string[] => {
  if (ids.length < 2) return [];
  const sorted = ids.slice().sort();
  if (sorted.length === 2) {
    const k = pairKey(sorted[0], sorted[1]);
    const cached = pairCache.get(k);
    if (cached) return cached;
    const a = datasets.find((d) => d.id === sorted[0])!;
    const b = datasets.find((d) => d.id === sorted[1])!;
    const [small, big] = a.values.size <= b.values.size ? [a.values, b.values] : [b.values, a.values];
    const out: string[] = [];
    for (const v of small) if (big.has(v)) out.push(v);
    pairCache.set(k, out);
    return out;
  }
  // For N>2: start with the cached pair, then prune against the rest.
  let working = sharedValuesFor(datasets, [sorted[0], sorted[1]]);
  for (let i = 2; i < sorted.length && working.length; i++) {
    const s = datasets.find((d) => d.id === sorted[i])!.values;
    working = working.filter((v) => s.has(v));
  }
  return working;
};

const labelFor = (datasets: Dataset[], ids: string[]) =>
  ids
    .map((id) => {
      const n = datasets.find((d) => d.id === id)!.name.replace(/\.[^.]+$/, "");
      return n.length > 14 ? n.slice(0, 12) + "…" : n;
    })
    .join(" ∩ ");

const hueFor = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
};

/**
 * Coarse grid scan. For each grid cell we record EVERY ≥2 subset of ovals
 * that contains the point — this guarantees pair/triple overlaps are detected
 * even when a deeper N-way overlap exists in the same area, and even when the
 * deeper subset has no shared values.
 */
export const computeIntersectionRegions = (datasets: Dataset[]): IntersectionRegion[] => {
  if (datasets.length < 2) return [];

  const maxScale = datasets.reduce((m, d) => Math.max(m, d.scale ?? 1), 1);
  const pad = Math.max(ELLIPSE_RX, ELLIPSE_RY) * maxScale + 20;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of datasets) {
    if (d.x - pad < minX) minX = d.x - pad;
    if (d.y - pad < minY) minY = d.y - pad;
    if (d.x + pad > maxX) maxX = d.x + pad;
    if (d.y + pad > maxY) maxY = d.y + pad;
  }
  const step = 28;
  const buckets = new Map<string, { ids: string[]; sx: number; sy: number; n: number }>();

  // Cap subset enumeration depth to keep scan O(2^k) per cell bounded.
  // 6 → 63 subsets per cell max; matches our 6 dataset colors comfortably.
  const MAX_SUBSET = 6;

  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      const inside: string[] = [];
      for (const d of datasets) {
        if (pointInEllipse(x, y, d.x, d.y, d.scale ?? 1)) inside.push(d.id);
      }
      if (inside.length < 2) continue;
      inside.sort();

      const limit = Math.min(inside.length, MAX_SUBSET);
      // Enumerate all non-empty subsets of size ≥ 2 up to `limit`.
      const n = inside.length;
      const total = 1 << Math.min(n, MAX_SUBSET);
      const slice = inside.slice(0, limit);
      for (let mask = 3; mask < total; mask++) {
        // need at least 2 bits set
        if ((mask & (mask - 1)) === 0) continue;
        const ids: string[] = [];
        for (let i = 0; i < limit; i++) if (mask & (1 << i)) ids.push(slice[i]);
        if (ids.length < 2) continue;
        const key = ids.join("|");
        let b = buckets.get(key);
        if (!b) {
          b = { ids, sx: 0, sy: 0, n: 0 };
          buckets.set(key, b);
        }
        b.sx += x;
        b.sy += y;
        b.n += 1;
      }
    }
  }

  const regions: IntersectionRegion[] = [];
  for (const [key, b] of buckets) {
    const shared = sharedValuesFor(datasets, b.ids);
    if (shared.length === 0) continue;
    regions.push({
      id: `g-${key}`,
      datasetIds: b.ids,
      sharedCount: shared.length,
      centerX: b.sx / b.n,
      centerY: b.sy / b.n,
      hue: hueFor(key),
      label: labelFor(datasets, b.ids),
    });
  }
  regions.sort((a, c) => (a.id < c.id ? -1 : 1));
  return regions;
};

/**
 * Materialize per-row matches for a single region. Only call when the user
 * actually inspects/exports — this is the heavy part.
 */
export const materializeGroup = (
  datasets: Dataset[],
  region: IntersectionRegion
): IntersectionGroup => {
  const shared = sharedValuesFor(datasets, region.datasetIds);
  const sharedSet = new Set(shared);
  const rowsByDataset: Record<string, Record<string, unknown>[]> = {};
  for (const id of region.datasetIds) {
    const ds = datasets.find((d) => d.id === id)!;
    rowsByDataset[id] = ds.rows.filter((r) =>
      Object.values(r).some((v) => sharedSet.has(normalizeValue(v)))
    );
  }
  return {
    id: region.id,
    datasetIds: region.datasetIds,
    sharedValues: shared,
    rowsByDataset,
    centerX: region.centerX,
    centerY: region.centerY,
    hue: region.hue,
    label: region.label,
  };
};

/** Backwards-compatible: full materialization of every region. */
export const computeIntersections = (datasets: Dataset[]): IntersectionGroup[] =>
  computeIntersectionRegions(datasets).map((r) => materializeGroup(datasets, r));

/** Clear cached pair intersections (call when a dataset is removed). */
export const clearIntersectionCache = (removedId?: string) => {
  if (!removedId) {
    pairCache.clear();
    return;
  }
  for (const k of Array.from(pairCache.keys())) {
    if (k.includes(removedId)) pairCache.delete(k);
  }
};

export const downloadIntersectionXlsx = (
  group: IntersectionGroup,
  datasets: Dataset[]
) => {
  const wb = XLSX.utils.book_new();
  const summary = group.sharedValues.map((v) => ({ shared_value: v }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Shared Values");

  for (const id of group.datasetIds) {
    const ds = datasets.find((d) => d.id === id);
    if (!ds) continue;
    const rows = group.rowsByDataset[id] ?? [];
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ info: "no rows" }]);
    const safeName = ds.name.replace(/[\\/?*[\]:]/g, "_").slice(0, 28);
    XLSX.utils.book_append_sheet(wb, sheet, `${safeName}_match`);

    const sharedSet = new Set(group.sharedValues);
    const onlyRows = ds.rows.filter(
      (r) => !Object.values(r).some((v) => sharedSet.has(normalizeValue(v)))
    );
    const onlySheet = XLSX.utils.json_to_sheet(onlyRows.length ? onlyRows : [{ info: "no unique rows" }]);
    XLSX.utils.book_append_sheet(wb, onlySheet, `${safeName}_only`);
  }

  const names = group.datasetIds
    .map((id) => datasets.find((d) => d.id === id)?.name ?? "set")
    .map((n) => n.replace(/\.[^.]+$/, ""))
    .join("__");
  XLSX.writeFile(wb, `intersection__${names}.xlsx`);
};
