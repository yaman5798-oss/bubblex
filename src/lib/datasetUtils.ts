import * as XLSX from "xlsx";

export interface Dataset {
  id: string;
  name: string;
  rows: Record<string, unknown>[];
  headers: string[];
  values: Set<string>; // normalized cell values for intersection
  x: number;
  y: number;
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

export const pointInEllipse = (px: number, py: number, cx: number, cy: number) => {
  const { x, y } = rotatePoint(px, py, cx, cy, ELLIPSE_ROT_DEG);
  return (x * x) / (ELLIPSE_RX * ELLIPSE_RX) + (y * y) / (ELLIPSE_RY * ELLIPSE_RY) <= 1;
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
  sharedValues: string[];
  rowsByDataset: Record<string, Record<string, unknown>[]>;
  centerX: number;
  centerY: number;
  /** HSL hue assigned for this group's color */
  hue: number;
  /** Display name, e.g. "A ∩ B ∩ C" */
  label: string;
}

// Sample a grid of points; each point is "in" a set of datasets. Cells with >=2 datasets
// constitute an intersection region. Group cells by the same dataset-subset to find
// each distinct overlap region (handles any N-way overlap).
export const computeIntersections = (datasets: Dataset[]): IntersectionGroup[] => {
  if (datasets.length < 2) return [];

  // Bounding box of all ovals (with padding)
  const pad = Math.max(ELLIPSE_RX, ELLIPSE_RY) + 20;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of datasets) {
    minX = Math.min(minX, d.x - pad);
    minY = Math.min(minY, d.y - pad);
    maxX = Math.max(maxX, d.x + pad);
    maxY = Math.max(maxY, d.y + pad);
  }
  const step = 14;
  const buckets = new Map<string, { ids: string[]; xs: number[]; ys: number[] }>();
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      const inside: string[] = [];
      for (const d of datasets) if (pointInEllipse(x, y, d.x, d.y)) inside.push(d.id);
      if (inside.length < 2) continue;
      const key = inside.slice().sort().join("|");
      let b = buckets.get(key);
      if (!b) {
        b = { ids: inside.slice().sort(), xs: [], ys: [] };
        buckets.set(key, b);
      }
      b.xs.push(x);
      b.ys.push(y);
    }
  }

  // Order buckets deterministically so colors stay stable as ovals move.
  const keys = Array.from(buckets.keys()).sort();
  const groups: IntersectionGroup[] = [];
  keys.forEach((key, idx) => {
    const b = buckets.get(key)!;
    const ids = b.ids;
    // Compute shared values: intersection of all datasets' value sets
    const sets = ids.map((id) => datasets.find((d) => d.id === id)!.values);
    const smallest = sets.reduce((a, c) => (a.size <= c.size ? a : c));
    const shared: string[] = [];
    for (const v of smallest) {
      let all = true;
      for (const s of sets) if (!s.has(v)) { all = false; break; }
      if (all) shared.push(v);
    }
    if (shared.length === 0) return;
    const sharedSet = new Set(shared);
    const rowsByDataset: Record<string, Record<string, unknown>[]> = {};
    for (const id of ids) {
      const ds = datasets.find((d) => d.id === id)!;
      rowsByDataset[id] = ds.rows.filter((r) =>
        Object.values(r).some((v) => sharedSet.has(normalizeValue(v)))
      );
    }
    const cx = b.xs.reduce((a, c) => a + c, 0) / b.xs.length;
    const cy = b.ys.reduce((a, c) => a + c, 0) / b.ys.length;
    // Stable hue from the dataset-subset key
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    const label = ids
      .map((id) => {
        const n = datasets.find((d) => d.id === id)!.name.replace(/\.[^.]+$/, "");
        return n.length > 14 ? n.slice(0, 12) + "…" : n;
      })
      .join(" ∩ ");
    groups.push({
      id: `g-${key}`,
      datasetIds: ids,
      sharedValues: shared,
      rowsByDataset,
      centerX: cx,
      centerY: cy,
      hue,
      label,
    });
  });
  return groups;
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
