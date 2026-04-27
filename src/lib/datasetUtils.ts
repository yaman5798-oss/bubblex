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
  datasetIds: string[];
  sharedValues: string[];
  rowsByDataset: Record<string, Record<string, unknown>[]>;
}

export const computeIntersections = (datasets: Dataset[]): IntersectionGroup[] => {
  const groups: IntersectionGroup[] = [];
  // pairwise only (clearer UX); could extend to N-way
  for (let i = 0; i < datasets.length; i++) {
    for (let j = i + 1; j < datasets.length; j++) {
      const a = datasets[i];
      const b = datasets[j];
      if (!ellipsesOverlap(a, b)) continue;
      const shared: string[] = [];
      for (const v of a.values) if (b.values.has(v)) shared.push(v);
      if (shared.length === 0) continue;
      const sharedSet = new Set(shared);
      const rowsA = a.rows.filter((r) => Object.values(r).some((v) => sharedSet.has(normalizeValue(v))));
      const rowsB = b.rows.filter((r) => Object.values(r).some((v) => sharedSet.has(normalizeValue(v))));
      groups.push({
        datasetIds: [a.id, b.id],
        sharedValues: shared,
        rowsByDataset: { [a.id]: rowsA, [b.id]: rowsB },
      });
    }
  }
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
