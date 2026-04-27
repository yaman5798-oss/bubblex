import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DATASET_COLORS,
  Dataset,
  ELLIPSE_ROT_DEG,
  ELLIPSE_RX,
  ELLIPSE_RY,
  IntersectionGroup,
  computeIntersections,
  downloadIntersectionXlsx,
  extractValues,
  parseFile,
} from "@/lib/datasetUtils";
import { Button } from "@/components/ui/button";
import { Upload, Download, Trash2, FileSpreadsheet, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const Index = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{ type: "group" | "dataset"; id: string } | null>(null);
  const [tab, setTab] = useState<"shared" | "unique">("shared");
  const fileInput = useRef<HTMLInputElement>(null);

  const intersections = useMemo(() => computeIntersections(datasets), [datasets]);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const newOnes: Dataset[] = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      try {
        const { rows, headers } = await parseFile(f);
        const id = crypto.randomUUID();
        const colorVar = DATASET_COLORS[(datasets.length + i) % DATASET_COLORS.length];
        const cw = canvasRef.current?.clientWidth ?? 1000;
        const ch = canvasRef.current?.clientHeight ?? 600;
        newOnes.push({
          id,
          name: f.name,
          rows,
          headers,
          values: extractValues(rows),
          x: 200 + ((datasets.length + i) % 4) * 180,
          y: ch / 2 + (((datasets.length + i) % 2) - 0.5) * 120,
          colorVar,
        });
      } catch (e) {
        toast.error(`Failed to parse ${f.name}`);
      }
    }
    if (newOnes.length) {
      setDatasets((d) => [...d, ...newOnes]);
      toast.success(`Loaded ${newOnes.length} file(s)`);
    }
  };

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    const ds = datasets.find((d) => d.id === id);
    if (!ds || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left - ds.x, y: e.clientY - rect.top - ds.y };
    setDragId(id);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - dragOffset.current.x;
    const y = e.clientY - rect.top - dragOffset.current.y;
    setDatasets((arr) => arr.map((d) => (d.id === dragId ? { ...d, x, y } : d)));
  };

  const endDrag = () => setDragId(null);

  const removeDataset = (id: string) => {
    setDatasets((d) => d.filter((x) => x.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const clearAll = () => {
    setDatasets([]);
    setSelected(null);
  };

  const selectedGroup: IntersectionGroup | null =
    selected?.type === "group" ? intersections.find((g) => g.id === selected.id) ?? null : null;
  const selectedDataset: Dataset | null =
    selected?.type === "dataset" ? datasets.find((d) => d.id === selected.id) ?? null : null;

  const sharedSetForDataset = useCallback(
    (id: string) => {
      const s = new Set<string>();
      for (const g of intersections) {
        if (g.datasetIds.includes(id)) g.sharedValues.forEach((v) => s.add(v));
      }
      return s;
    },
    [intersections]
  );

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Venn Canvas — Excel Intersection Studio</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload .xlsx / .xls / .xml · drag the diagonal ovals to overlap and find shared cell values
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.xml,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/xml,application/xml"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileInput.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" /> Upload files
          </Button>
          {datasets.length > 0 && (
            <Button variant="outline" onClick={clearAll} className="gap-2">
              <Trash2 className="h-4 w-4" /> Clear
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Canvas */}
        <main
          ref={canvasRef}
          className="flex-1 relative overflow-hidden"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, hsl(var(--canvas-bg)) 0%, hsl(var(--background)) 100%)",
            backgroundImage:
              "linear-gradient(hsl(var(--canvas-grid)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--canvas-grid)) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onClick={(e) => {
            if (e.target === canvasRef.current) setSelected(null);
          }}
        >
          {datasets.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground/40" />
                <p className="mt-3 text-muted-foreground">Upload Excel or XML files to begin</p>
              </div>
            </div>
          )}

          {/* Ellipses */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              {datasets.map((d) => (
                <radialGradient key={d.id} id={`grad-${d.id}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={`hsl(var(${d.colorVar}) / 0.45)`} />
                  <stop offset="100%" stopColor={`hsl(var(${d.colorVar}) / 0.22)`} />
                </radialGradient>
              ))}
            </defs>
            {datasets.map((d) => (
              <g
                key={d.id}
                transform={`translate(${d.x} ${d.y}) rotate(${ELLIPSE_ROT_DEG})`}
                style={{ pointerEvents: "auto", cursor: dragId === d.id ? "grabbing" : "grab" }}
                onPointerDown={(e) => onPointerDown(e, d.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected({ type: "dataset", id: d.id });
                }}
              >
                <ellipse
                  rx={ELLIPSE_RX}
                  ry={ELLIPSE_RY}
                  fill={`url(#grad-${d.id})`}
                  stroke={`hsl(var(${d.colorVar}))`}
                  strokeWidth={selectedDataset?.id === d.id ? 3 : 2}
                  style={{ mixBlendMode: "screen" }}
                />
                <text
                  x={0}
                  y={-ELLIPSE_RY + 24}
                  textAnchor="middle"
                  fill={`hsl(var(${d.colorVar}))`}
                  fontSize={14}
                  fontWeight={600}
                  transform={`rotate(${-ELLIPSE_ROT_DEG})`}
                >
                  {d.name.length > 28 ? d.name.slice(0, 26) + "…" : d.name}
                </text>
                <text
                  x={0}
                  y={-ELLIPSE_RY + 42}
                  textAnchor="middle"
                  fill="hsl(var(--muted-foreground))"
                  fontSize={11}
                  transform={`rotate(${-ELLIPSE_ROT_DEG})`}
                >
                  {d.rows.length} rows · {d.values.size} unique values
                </text>
              </g>
            ))}
          </svg>

          {/* Intersection chips overlay (supports any N-way overlap) */}
          {intersections.map((g) => {
            const isSel = selected?.type === "group" && selected.id === g.id;
            const bg = `hsl(${g.hue} 85% 60% / 0.85)`;
            const border = `hsl(${g.hue} 90% 70%)`;
            return (
              <button
                key={g.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected({ type: "group", id: g.id });
                  setTab("shared");
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md transition-all hover:scale-105 whitespace-nowrap"
                style={{
                  left: g.centerX,
                  top: g.centerY,
                  background: bg,
                  color: "hsl(220 26% 8%)",
                  borderColor: border,
                  boxShadow: isSel
                    ? `0 0 0 3px hsl(${g.hue} 90% 70% / 0.45), 0 6px 24px hsl(${g.hue} 80% 30% / 0.5)`
                    : `0 4px 18px hsl(${g.hue} 80% 20% / 0.5)`,
                }}
                title={`${g.label} — ${g.sharedValues.length} shared values`}
              >
                {g.label} · ∩ {g.sharedValues.length}
              </button>
            );
          })}
        </main>

        {/* Side panel */}
        <aside className="w-[380px] border-l border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-[hsl(var(--panel-border))]">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Datasets</h2>
          </div>
          <div className="overflow-y-auto max-h-64 border-b border-[hsl(var(--panel-border))]">
            {datasets.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No files yet.</p>
            ) : (
              datasets.map((d) => (
                <div
                  key={d.id}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 cursor-pointer ${
                    selectedDataset?.id === d.id ? "bg-white/5" : ""
                  }`}
                  onClick={() => setSelected({ type: "dataset", id: d.id })}
                >
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ background: `hsl(var(${d.colorVar}))` }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.rows.length} rows</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDataset(d.id);
                    }}
                    className="text-muted-foreground hover:text-destructive p-1"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {!selected && (
              <div className="p-4 text-sm text-muted-foreground">
                Drag ovals to overlap them. Click an ∩ chip to view shared data, or click a dataset to inspect it.
              </div>
            )}

            {selectedGroup && (
              <GroupPanel group={selectedGroup} datasets={datasets} tab={tab} setTab={setTab} />
            )}

            {selectedDataset && !selectedGroup && (
              <DatasetPanel dataset={selectedDataset} sharedSet={sharedSetForDataset(selectedDataset.id)} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

const GroupPanel = ({
  group,
  datasets,
  tab,
  setTab,
}: {
  group: IntersectionGroup;
  datasets: Dataset[];
  tab: "shared" | "unique";
  setTab: (t: "shared" | "unique") => void;
}) => {
  const groupDatasets = group.datasetIds
    .map((id) => datasets.find((d) => d.id === id))
    .filter((d): d is Dataset => !!d);
  const sharedSet = useMemo(() => new Set(group.sharedValues), [group]);
  const uniqueByDs = groupDatasets.map((ds) => ({
    ds,
    rows: ds.rows.filter(
      (r) => !Object.values(r).some((v) => sharedSet.has(String(v ?? "").trim().toLowerCase()))
    ),
  }));

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Intersection</p>
        <div
          className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold mb-2"
          style={{
            background: `hsl(${group.hue} 85% 60% / 0.2)`,
            color: `hsl(${group.hue} 90% 75%)`,
            border: `1px solid hsl(${group.hue} 85% 60% / 0.5)`,
          }}
        >
          {group.label}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {groupDatasets.map((d, i) => (
            <span key={d.id} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground">∩</span>}
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: `hsl(var(${d.colorVar}))` }}
              />
              <span className="truncate max-w-[140px]">{d.name}</span>
            </span>
          ))}
        </div>
      </div>

      <Button onClick={() => downloadIntersectionXlsx(group, datasets)} className="w-full gap-2">
        <Download className="h-4 w-4" /> Download intersection .xlsx
      </Button>

      <div className="flex gap-1 border-b border-[hsl(var(--panel-border))]">
        {(["shared", "unique"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${
              tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            {t === "shared" ? `Shared (${group.sharedValues.length})` : `Unique`}
          </button>
        ))}
      </div>

      {tab === "shared" ? (
        <div className="space-y-1">
          {group.sharedValues.slice(0, 500).map((v) => (
            <div key={v} className="text-xs px-2 py-1 rounded bg-white/5 font-mono truncate">
              {v}
            </div>
          ))}
          {group.sharedValues.length > 500 && (
            <p className="text-xs text-muted-foreground">+{group.sharedValues.length - 500} more…</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {uniqueByDs.map(({ ds, rows }) => (
            <div key={ds.id}>
              <p className="text-xs font-semibold mb-1" style={{ color: `hsl(var(${ds.colorVar}))` }}>
                Only in {ds.name} ({rows.length})
              </p>
              <RowsPreview rows={rows} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const DatasetPanel = ({ dataset, sharedSet }: { dataset: Dataset; sharedSet: Set<string> }) => {
  return (
    <div className="p-4 space-y-3">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Dataset</p>
        <p className="text-sm font-medium truncate">{dataset.name}</p>
        <p className="text-xs text-muted-foreground">
          {dataset.rows.length} rows · {dataset.headers.length} columns
        </p>
      </div>
      <RowsPreview rows={dataset.rows} highlight={sharedSet} />
    </div>
  );
};

const RowsPreview = ({ rows, highlight }: { rows: Record<string, unknown>[]; highlight?: Set<string> }) => {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No rows.</p>;
  const headers = Object.keys(rows[0]);
  return (
    <div className="border border-[hsl(var(--panel-border))] rounded overflow-auto max-h-80">
      <table className="text-xs w-full">
        <thead className="bg-white/5 sticky top-0">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-2 py-1 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i} className="border-t border-[hsl(var(--panel-border))]">
              {headers.map((h) => {
                const v = r[h];
                const norm = String(v ?? "").trim().toLowerCase();
                const isHL = highlight?.has(norm) && norm !== "";
                return (
                  <td
                    key={h}
                    className="px-2 py-1 whitespace-nowrap"
                    style={isHL ? { background: "hsl(var(--intersection) / 0.18)", color: "hsl(var(--intersection))" } : undefined}
                  >
                    {String(v ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 && (
        <p className="text-xs text-muted-foreground p-2">+{rows.length - 200} more rows…</p>
      )}
    </div>
  );
};

export default Index;
