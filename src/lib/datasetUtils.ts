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
  /**
   * Original parsed worksheet (preserves cell formatting, number formats,
   * merges, column widths). Re-embedded into exports so users keep the look
   * of their source file. Optional for backwards compatibility.
   */
  sourceSheet?: XLSX.WorkSheet;
  /** Original sheet name from the source workbook. */
  sourceSheetName?: string;
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

export const parseFile = async (
  file: File
): Promise<{
  rows: Record<string, unknown>[];
  headers: string[];
  sourceSheet: XLSX.WorkSheet;
  sourceSheetName: string;
}> => {
  const buf = await file.arrayBuffer();
  // cellStyles+cellDates keep formatting and date types intact.
  const wb = XLSX.read(buf, { type: "array", cellStyles: true, cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, headers, sourceSheet: sheet, sourceSheetName: sheetName };
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
  const anchorColumnByDataset: Record<string, string> = {};
  const matchedValueByDataset: Record<string, string[]> = {};

  for (const id of region.datasetIds) {
    const ds = datasets.find((d) => d.id === id)!;
    // For each row: find the FIRST column whose value matches a shared value.
    // Tally column hits to choose the dataset's anchor column.
    const colHits = new Map<string, number>();
    type Hit = { row: Record<string, unknown>; col: string; matched: string };
    const hits: Hit[] = [];
    for (const row of ds.rows) {
      let chosenCol: string | null = null;
      let chosenMatch: string | null = null;
      for (const col of ds.headers) {
        const n = normalizeValue(row[col]);
        if (n !== "" && sharedSet.has(n)) {
          chosenCol = col;
          chosenMatch = n;
          break;
        }
      }
      if (chosenCol && chosenMatch) {
        colHits.set(chosenCol, (colHits.get(chosenCol) ?? 0) + 1);
        hits.push({ row, col: chosenCol, matched: chosenMatch });
      }
    }
    // Anchor column = the column most often containing the shared values.
    let anchor = ds.headers[0] ?? "";
    let max = -1;
    for (const [col, n] of colHits) {
      if (n > max) { max = n; anchor = col; }
    }
    anchorColumnByDataset[id] = anchor;

    // Sort rows by anchor column value so common data lines up consistently.
    hits.sort((a, b) => {
      // Rows whose match IS in the anchor column come first, then by matched value.
      const aAnchor = a.col === anchor ? 0 : 1;
      const bAnchor = b.col === anchor ? 0 : 1;
      if (aAnchor !== bAnchor) return aAnchor - bAnchor;
      return a.matched.localeCompare(b.matched);
    });

    rowsByDataset[id] = hits.map((h) => h.row);
    matchedValueByDataset[id] = hits.map((h) => h.matched);
  }

  return {
    id: region.id,
    datasetIds: region.datasetIds,
    sharedValues: shared,
    rowsByDataset,
    anchorColumnByDataset,
    matchedValueByDataset,
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
  datasets: Dataset[],
  /**
   * Optional per-dataset column whitelist. If provided for a dataset id,
   * the `_match` sheet for that dataset only exports those columns
   * (anchor column is always kept first if it is included).
   */
  selectedColumnsByDataset?: Record<string, string[]>
) => {
  const wb = XLSX.utils.book_new();

  // Helper: sanitize sheet names (Excel forbids \ / ? * [ ] :, max 31 chars).
  const safe = (n: string, max = 28) =>
    n.replace(/\.[^.]+$/, "").replace(/[\\/?*[\]:]/g, "_").slice(0, max);

  // Ensure unique sheet name (Excel forbids duplicates).
  const uniqueName = (desired: string) => {
    let name = desired.slice(0, 31);
    if (!wb.SheetNames.includes(name)) return name;
    let i = 2;
    while (true) {
      const suffix = `_${i++}`;
      const candidate = desired.slice(0, 31 - suffix.length) + suffix;
      if (!wb.SheetNames.includes(candidate)) return candidate;
    }
  };

  // 1) Embed each dataset's ORIGINAL sheet first so formatting is preserved
  //    AND so the shared-values sheet can hyperlink into it. Track the sheet
  //    name we used per dataset (Excel may force-truncate to 31 chars).
  const sourceSheetNameByDs: Record<string, string> = {};
  for (const id of group.datasetIds) {
    const ds = datasets.find((d) => d.id === id);
    if (!ds || !ds.sourceSheet) continue;
    const name = uniqueName(`${safe(ds.name, 22)}_source`);
    // Clone the worksheet so we don't mutate the in-memory dataset.
    const cloned: XLSX.WorkSheet = JSON.parse(JSON.stringify(ds.sourceSheet));
    XLSX.utils.book_append_sheet(wb, cloned, name);
    sourceSheetNameByDs[id] = name;
  }

  // 2) Build the Shared Values sheet with hyperlinks → first occurrence
  //    of each value in each dataset's source sheet.
  const sharedHeader = ["shared_value", ...group.datasetIds.map((id) => {
    const ds = datasets.find((d) => d.id === id);
    return ds ? safe(ds.name, 26) : id;
  })];

  // Pre-index every source sheet: normalized cell value → A1 address (first hit).
  const indexByDs: Record<string, Map<string, string>> = {};
  for (const id of group.datasetIds) {
    const ds = datasets.find((d) => d.id === id);
    const sheetName = sourceSheetNameByDs[id];
    if (!ds || !sheetName) continue;
    const sheet = wb.Sheets[sheetName];
    const ref = sheet["!ref"];
    const map = new Map<string, string>();
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = sheet[addr];
          if (!cell) continue;
          const norm = normalizeValue(cell.v);
          if (norm !== "" && !map.has(norm)) map.set(norm, addr);
        }
      }
    }
    indexByDs[id] = map;
  }

  const sharedAoa: (string | null)[][] = [sharedHeader];
  for (const v of group.sharedValues) {
    const row: (string | null)[] = [v];
    for (const id of group.datasetIds) row.push(indexByDs[id]?.get(v) ?? null);
    sharedAoa.push(row);
  }
  const sharedSheet = XLSX.utils.aoa_to_sheet(sharedAoa);

  // Attach hyperlinks. Column 0 = shared_value (link to first dataset that has it).
  // Columns 1..N = per-dataset cell address links.
  for (let r = 1; r < sharedAoa.length; r++) {
    const value = group.sharedValues[r - 1];
    // Per-dataset address columns
    for (let c = 0; c < group.datasetIds.length; c++) {
      const id = group.datasetIds[c];
      const sheetName = sourceSheetNameByDs[id];
      const addr = indexByDs[id]?.get(value);
      if (!sheetName || !addr) continue;
      const cellAddr = XLSX.utils.encode_cell({ r, c: c + 1 });
      const cell = sharedSheet[cellAddr];
      if (cell) {
        // Excel intra-workbook link: #'Sheet'!A1
        cell.l = { Target: `#'${sheetName}'!${addr}`, Tooltip: `Open ${sheetName}!${addr}` };
      }
    }
    // Make the shared_value text itself a link to the FIRST dataset that has it.
    for (const id of group.datasetIds) {
      const sheetName = sourceSheetNameByDs[id];
      const addr = indexByDs[id]?.get(value);
      if (sheetName && addr) {
        const valueAddr = XLSX.utils.encode_cell({ r, c: 0 });
        const valueCell = sharedSheet[valueAddr];
        if (valueCell) {
          valueCell.l = { Target: `#'${sheetName}'!${addr}`, Tooltip: `Open in ${sheetName}` };
        }
        break;
      }
    }
  }
  // Column widths for readability.
  sharedSheet["!cols"] = [{ wch: 28 }, ...group.datasetIds.map(() => ({ wch: 18 }))];
  XLSX.utils.book_append_sheet(wb, sharedSheet, uniqueName("Shared Values"));

  // 3) Per-dataset organized sheets (anchor column first, plus __match__).
  for (const id of group.datasetIds) {
    const ds = datasets.find((d) => d.id === id);
    if (!ds) continue;
    const rows = group.rowsByDataset[id] ?? [];
    const matched = group.matchedValueByDataset[id] ?? [];
    const anchor = group.anchorColumnByDataset[id] ?? ds.headers[0] ?? "";

    // Apply per-dataset column whitelist if provided. Empty/missing → all columns.
    const sel = selectedColumnsByDataset?.[id];
    const allowed =
      sel && sel.length > 0 ? new Set(sel) : new Set(ds.headers);
    // Always keep anchor first if it's allowed; otherwise just use the allowed set order.
    const filteredHeaders = ds.headers.filter((h) => allowed.has(h));
    const orderedHeaders = allowed.has(anchor)
      ? [anchor, ...filteredHeaders.filter((h) => h !== anchor)]
      : filteredHeaders;

    const shaped = rows.length
      ? rows.map((r, i) => {
          const out: Record<string, unknown> = { __match__: matched[i] ?? "" };
          for (const h of orderedHeaders) out[h] = r[h];
          return out;
        })
      : [{ info: "no rows" }];

    const sheet = XLSX.utils.json_to_sheet(shaped, {
      header: rows.length ? ["__match__", ...orderedHeaders] : undefined,
    });
    XLSX.utils.book_append_sheet(wb, sheet, uniqueName(`${safe(ds.name)}_match`));

    const sharedSet = new Set(group.sharedValues);
    const onlyRows = ds.rows.filter(
      (r) => !Object.values(r).some((v) => sharedSet.has(normalizeValue(v)))
    );
    const onlySheet = XLSX.utils.json_to_sheet(
      onlyRows.length ? onlyRows : [{ info: "no unique rows" }]
    );
    XLSX.utils.book_append_sheet(wb, onlySheet, uniqueName(`${safe(ds.name)}_only`));
  }

  const names = group.datasetIds
    .map((id) => datasets.find((d) => d.id === id)?.name ?? "set")
    .map((n) => n.replace(/\.[^.]+$/, ""))
    .join("__");
  XLSX.writeFile(wb, `intersection__${names}.xlsx`, { cellStyles: true });
};
