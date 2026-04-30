import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DATASET_COLORS,
  Dataset,
  ELLIPSE_ROT_DEG,
  ELLIPSE_RX,
  ELLIPSE_RY,
  IntersectionGroup,
  IntersectionRegion,
  clearIntersectionCache,
  computeIntersectionRegions,
  downloadIntersectionXlsx,
  extractValues,
  materializeGroup,
  parseFile,
  pointInEllipse,
  sharedValuesFor,
} from "@/lib/datasetUtils";
import { Button } from "@/components/ui/button";
import { Upload, Download, Trash2, FileSpreadsheet, X, Search, Pencil, Check, Lock, Unlock, ChevronDown, ChevronRight, GripHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const Index = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{ type: "group" | "dataset"; id: string } | null>(null);
  const [tab, setTab] = useState<"shared" | "matched" | "unique">("shared");
  const fileInput = useRef<HTMLInputElement>(null);
  const [jumpQuery, setJumpQuery] = useState("");
  const [jumpIndex, setJumpIndex] = useState(0);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [jumpExpanded, setJumpExpanded] = useState(true);
  const [jumpHeight, setJumpHeight] = useState(288); // px, default ~max-h-72
  const jumpResizing = useRef(false);
  const [asideWidth, setAsideWidth] = useState(380); // px, side panel width
  const asideResizing = useRef(false);
  // Canvas viewport — wheel on blank space zooms around cursor.
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  // Convert screen (canvas-relative) coords → world coords used by datasets.
  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({ x: (sx - viewPan.x) / viewZoom, y: (sy - viewPan.y) / viewZoom }),
    [viewPan.x, viewPan.y, viewZoom]
  );

  const intersections = useMemo(() => computeIntersectionRegions(datasets), [datasets]);

  type JumpItem =
    | { kind: "dataset"; id: string; label: string; sub: string; colorStyle: string }
    | { kind: "group"; id: string; label: string; sub: string; colorStyle: string };

  const jumpItems: JumpItem[] = useMemo(() => {
    const q = jumpQuery.trim().toLowerCase();
    const ds: JumpItem[] = datasets.map((d) => ({
      kind: "dataset",
      id: d.id,
      label: d.name,
      sub: `${d.rows.length} rows · ${d.headers.length} cols`,
      colorStyle: `hsl(var(${d.colorVar}))`,
    }));
    const gs: JumpItem[] = intersections.map((g) => ({
      kind: "group",
      id: g.id,
      label: g.label,
      sub: `∩ ${g.sharedCount} shared · ${g.datasetIds.length} sets`,
      colorStyle: `hsl(${g.hue} 85% 60%)`,
    }));
    const all = [...ds, ...gs];
    if (!q) return all;
    return all.filter(
      (it) => it.label.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q)
    );
  }, [datasets, intersections, jumpQuery]);

  useEffect(() => {
    setJumpIndex(0);
  }, [jumpQuery, datasets.length, intersections.length]);

  // Global Ctrl/Cmd+K to focus jump search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        jumpInputRef.current?.focus();
        jumpInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectJumpItem = (item: JumpItem) => {
    setSelected({ type: item.kind, id: item.id });
    if (item.kind === "group") setTab("shared");
  };

  const onJumpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setJumpIndex((i) => Math.min(i + 1, Math.max(jumpItems.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setJumpIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = jumpItems[jumpIndex];
      if (item) {
        selectJumpItem(item);
        jumpInputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (jumpQuery) setJumpQuery("");
      else jumpInputRef.current?.blur();
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const newOnes: Dataset[] = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      try {
        const { rows, headers, sourceSheet, sourceSheetName } = await parseFile(f);
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
          scale: 1,
          colorVar,
          sourceSheet,
          sourceSheetName,
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
    if (ds.locked) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    dragOffset.current = { x: w.x - ds.x, y: w.y - ds.y };
    setDragId(id);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const rafRef = useRef<number | null>(null);
  const pendingPos = useRef<{ x: number; y: number } | null>(null);

  // Pan state — click-and-drag empty canvas to translate the viewport.
  const panState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    // Only start pan when click is on the canvas itself (empty space).
    if (e.target !== canvasRef.current) return;
    if (e.button !== 0) return;
    panState.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: viewPan.x,
      panY: viewPan.y,
    };
    setIsPanning(true);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panState.current) {
      const ps = panState.current;
      setViewPan({ x: ps.panX + (e.clientX - ps.startX), y: ps.panY + (e.clientY - ps.startY) });
      return;
    }
    if (!dragId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    pendingPos.current = {
      x: w.x - dragOffset.current.x,
      y: w.y - dragOffset.current.y,
    };
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = pendingPos.current;
      if (!p || !dragId) return;
      setDatasets((arr) => arr.map((d) => (d.id === dragId ? { ...d, x: p.x, y: p.y } : d)));
    });
  };

  const endDrag = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setDragId(null);
    if (panState.current) {
      panState.current = null;
      setIsPanning(false);
    }
  };

  // Mouse-wheel resize: scroll over an oval to grow/shrink it.
  // Attached natively so we can preventDefault (passive: false).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // Hit-test in WORLD coords since datasets live in world space.
      const wp = { x: (px - viewPan.x) / viewZoom, y: (py - viewPan.y) / viewZoom };
      let hit: string | null = null;
      for (let i = datasets.length - 1; i >= 0; i--) {
        const d = datasets[i];
        if (pointInEllipse(wp.x, wp.y, d.x, d.y, d.scale ?? 1)) {
          hit = d.id;
          break;
        }
      }
      if (hit) {
        const hitDs = datasets.find((d) => d.id === hit);
        if (hitDs?.locked) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        setDatasets((arr) =>
          arr.map((d) =>
            d.id === hit ? { ...d, scale: Math.min(3, Math.max(0.3, d.scale * factor)) } : d
          )
        );
        return;
      }
      // Blank space → zoom the whole canvas around cursor (same wheel mechanic).
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nextZoom = Math.min(4, Math.max(0.2, viewZoom * factor));
      const k = nextZoom / viewZoom;
      // Keep cursor's world point fixed: newPan = p - k*(p - pan)
      setViewPan({ x: px - k * (px - viewPan.x), y: py - k * (py - viewPan.y) });
      setViewZoom(nextZoom);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [datasets, viewZoom, viewPan.x, viewPan.y]);

  const removeDataset = (id: string) => {
    clearIntersectionCache(id);
    setDatasets((d) => d.filter((x) => x.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const renameDataset = (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
  };

  const toggleLock = (id: string) => {
    setDatasets((arr) => arr.map((d) => (d.id === id ? { ...d, locked: !d.locked } : d)));
  };

  const clearAll = () => {
    clearIntersectionCache();
    setDatasets([]);
    setSelected(null);
  };

  const selectedRegion: IntersectionRegion | null =
    selected?.type === "group" ? intersections.find((g) => g.id === selected.id) ?? null : null;
  // Heavy materialization only for the currently selected region.
  const selectedGroup: IntersectionGroup | null = useMemo(
    () => (selectedRegion ? materializeGroup(datasets, selectedRegion) : null),
    [selectedRegion, datasets]
  );
  const selectedDataset: Dataset | null =
    selected?.type === "dataset" ? datasets.find((d) => d.id === selected.id) ?? null : null;

  // Highlight set for a dataset = union of shared values across its overlap regions.
  // Uses cached sharedValuesFor — no row materialization needed for highlights.
  const sharedSetForDataset = useCallback(
    (id: string) => {
      const s = new Set<string>();
      for (const g of intersections) {
        if (!g.datasetIds.includes(id)) continue;
        sharedValuesFor(datasets, g.datasetIds).forEach((v) => s.add(v));
      }
      return s;
    },
    [intersections, datasets]
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

          {/* Zoomable viewport — wheel on blank space pans/zooms world. */}
          <div
            className="absolute inset-0"
            style={{
              transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewZoom})`,
              transformOrigin: "0 0",
            }}
          >
          {/* Ellipses */}
          <svg
            className="absolute pointer-events-none"
            style={{ left: 0, top: 0, width: 100000, height: 100000, overflow: "visible" }}
          >
            <defs>
              {datasets.map((d) => (
                <radialGradient key={d.id} id={`grad-${d.id}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={`hsl(var(${d.colorVar}) / 0.40)`} />
                  <stop offset="100%" stopColor={`hsl(var(${d.colorVar}) / 0.18)`} />
                </radialGradient>
              ))}
              {/* Per-dataset clip used to intersect ovals into a filled overlap region */}
              {datasets.map((d) => (
                <clipPath key={`clip-${d.id}`} id={`clip-${d.id}`} clipPathUnits="userSpaceOnUse">
                  <ellipse
                    cx={d.x}
                    cy={d.y}
                    rx={ELLIPSE_RX * d.scale}
                    ry={ELLIPSE_RY * d.scale}
                    transform={`rotate(${ELLIPSE_ROT_DEG} ${d.x} ${d.y})`}
                  />
                </clipPath>
              ))}
            </defs>

            {/* Filled colored intersection regions: nest clipPaths so the fill
                is only visible inside ALL participating ovals. */}
            {intersections.map((g) => {
              const ds = g.datasetIds.map((id) => datasets.find((x) => x.id === id)!).filter(Boolean);
              if (ds.length < 2) return null;
              const isSel = selected?.type === "group" && selected.id === g.id;
              // Build nested <g clip-path> wrappers, innermost contains the fill rect
              let node: JSX.Element = (
                <rect
                  x={-100000}
                  y={-100000}
                  width={200000}
                  height={200000}
                  fill={`hsl(${g.hue} 90% 55%)`}
                  fillOpacity={isSel ? 0.55 : 0.38}
                />
              );
              for (const d of ds) {
                node = <g clipPath={`url(#clip-${d.id})`}>{node}</g>;
              }
              return <g key={`fill-${g.id}`}>{node}</g>;
            })}

            {datasets.map((d) => (
              <g
                key={d.id}
                transform={`translate(${d.x} ${d.y}) rotate(${ELLIPSE_ROT_DEG}) scale(${d.scale})`}
                style={{ pointerEvents: "auto", cursor: d.locked ? "not-allowed" : (dragId === d.id ? "grabbing" : "grab") }}
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
                  strokeWidth={(selectedDataset?.id === d.id ? 3 : 2) / d.scale}
                  strokeDasharray={d.locked ? `${6 / d.scale} ${4 / d.scale}` : undefined}
                />
                <text
                  x={0}
                  y={-ELLIPSE_RY + 24}
                  textAnchor="middle"
                  fill={`hsl(var(${d.colorVar}))`}
                  fontSize={14 / d.scale}
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
                  fontSize={11 / d.scale}
                  transform={`rotate(${-ELLIPSE_ROT_DEG})`}
                >
                  {d.rows.length} rows · {d.values.size} unique values
                </text>
                {/* Lock toggle button — pinned to top-right inside the circle */}
                <g
                  transform={`translate(${ELLIPSE_RX * 0.62} ${-ELLIPSE_RY * 0.62}) scale(${1 / d.scale})`}
                  style={{ cursor: "pointer" }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLock(d.id);
                  }}
                >
                  <title>{d.locked ? "Unlock circle" : "Lock circle in place"}</title>
                  <circle
                    r={14}
                    fill={d.locked ? `hsl(var(${d.colorVar}))` : "hsl(var(--background))"}
                    stroke={`hsl(var(${d.colorVar}))`}
                    strokeWidth={1.5}
                  />
                  <foreignObject x={-9} y={-9} width={18} height={18} style={{ pointerEvents: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, color: d.locked ? "hsl(var(--background))" : `hsl(var(${d.colorVar}))` }}>
                      {d.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </div>
                  </foreignObject>
                </g>
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
                onPointerEnter={() => {
                  if (dragId) return;
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
                title={`${g.label} — ${g.sharedCount} shared values (hover to preview)`}
              >
                {g.label} · ∩ {g.sharedCount}
              </button>
            );
          })}
          </div>

          {/* Zoom indicator / reset */}
          {(viewZoom !== 1 || viewPan.x !== 0 || viewPan.y !== 0) && (
            <button
              onClick={() => { setViewZoom(1); setViewPan({ x: 0, y: 0 }); }}
              className="absolute bottom-3 left-3 z-10 px-2.5 py-1 rounded-md text-xs font-medium bg-[hsl(var(--panel))]/90 border border-[hsl(var(--panel-border))] backdrop-blur hover:bg-[hsl(var(--panel))]"
              title="Reset zoom"
            >
              {Math.round(viewZoom * 100)}% · reset
            </button>
          )}
        </main>

        {/* Side panel */}
        {/* Vertical drag handle to resize the side panel */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(e) => {
            e.preventDefault();
            asideResizing.current = true;
            const startX = e.clientX;
            const startW = asideWidth;
            const onMove = (ev: PointerEvent) => {
              if (!asideResizing.current) return;
              // Dragging left increases width, right decreases.
              const next = Math.min(900, Math.max(260, startW - (ev.clientX - startX)));
              setAsideWidth(next);
            };
            const onUp = () => {
              asideResizing.current = false;
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          }}
          className="w-1.5 cursor-col-resize hover:bg-white/10 shrink-0"
          title="Drag to resize panel"
        />
        <aside
          style={{ width: asideWidth }}
          className="border-l border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] flex flex-col min-h-0 shrink-0"
        >
          <div className="px-4 py-3 border-b border-[hsl(var(--panel-border))] space-y-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setJumpExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                aria-expanded={jumpExpanded}
              >
                {jumpExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Jump to
                <span className="ml-1 text-[10px] normal-case tracking-normal text-muted-foreground/70">
                  ({jumpItems.length})
                </span>
              </button>
              <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-[hsl(var(--panel-border))] text-muted-foreground">
                ⌘K
              </kbd>
            </div>
            {jumpExpanded && (
              <>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    ref={jumpInputRef}
                    value={jumpQuery}
                    onChange={(e) => setJumpQuery(e.target.value)}
                    onKeyDown={onJumpKeyDown}
                    placeholder="Search datasets or intersections…"
                    className="h-8 pl-7 pr-7 text-xs bg-background/50"
                  />
                  {jumpQuery && (
                    <button
                      onClick={() => setJumpQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  ↑ ↓ navigate · Enter select · Esc clear
                </p>
              </>
            )}
          </div>
          {jumpExpanded && (
          <>
          <div
            className="overflow-y-auto border-b border-[hsl(var(--panel-border))]"
            style={{ height: jumpHeight }}
          >
            {datasets.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No files yet.</p>
            ) : jumpItems.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No matches.</p>
            ) : (
              jumpItems.map((item, i) => {
                const isActive = i === jumpIndex;
                const isSelected =
                  (item.kind === "dataset" && selectedDataset?.id === item.id) ||
                  (item.kind === "group" && selectedGroup?.id === item.id);
                return (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className={`flex items-center gap-3 px-4 py-2 cursor-pointer border-l-2 ${
                      isActive
                        ? "bg-white/10 border-foreground"
                        : isSelected
                        ? "bg-white/5 border-transparent"
                        : "hover:bg-white/5 border-transparent"
                    }`}
                    onMouseEnter={() => setJumpIndex(i)}
                    onClick={() => selectJumpItem(item)}
                  >
                    <span
                      className={`h-3 w-3 shrink-0 ${
                        item.kind === "group" ? "rotate-45" : "rounded-full"
                      }`}
                      style={{ background: item.colorStyle }}
                    />
                    <div className="flex-1 min-w-0">
                      {item.kind === "dataset" && renamingId === item.id ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              renameDataset(item.id, renameDraft);
                              setRenamingId(null);
                            } else if (e.key === "Escape") {
                              setRenamingId(null);
                            }
                          }}
                          onBlur={() => {
                            renameDataset(item.id, renameDraft);
                            setRenamingId(null);
                          }}
                          className="w-full h-7 px-1.5 text-sm rounded bg-background/70 border border-foreground/40 focus:outline-none"
                        />
                      ) : (
                        <p className="text-sm truncate flex items-center gap-1.5">
                          <span className="truncate">{item.label}</span>
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground truncate">
                        <span className="uppercase tracking-wider mr-1">
                          {item.kind === "group" ? "intersection" : "dataset"}
                        </span>
                        · {item.sub}
                      </p>
                    </div>
                    {item.kind === "dataset" && renamingId !== item.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const ds = datasets.find((d) => d.id === item.id);
                          setRenameDraft(ds?.name ?? "");
                          setRenamingId(item.id);
                        }}
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="Rename dataset"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {item.kind === "dataset" && renamingId === item.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          renameDataset(item.id, renameDraft);
                          setRenamingId(null);
                        }}
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="Save name"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {item.kind === "dataset" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDataset(item.id);
                        }}
                        className="text-muted-foreground hover:text-destructive p-1"
                        title="Remove dataset"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {/* Drag handle to resize the Jump-to list */}
          <div
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={(e) => {
              e.preventDefault();
              jumpResizing.current = true;
              const startY = e.clientY;
              const startH = jumpHeight;
              const onMove = (ev: PointerEvent) => {
                if (!jumpResizing.current) return;
                const next = Math.min(800, Math.max(80, startH + (ev.clientY - startY)));
                setJumpHeight(next);
              };
              const onUp = () => {
                jumpResizing.current = false;
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
            className="h-2 cursor-row-resize flex items-center justify-center border-b border-[hsl(var(--panel-border))] hover:bg-white/5"
            title="Drag to resize"
          >
            <GripHorizontal className="h-3 w-3 text-muted-foreground/60" />
          </div>
          </>
          )}

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
              <DatasetPanel
                dataset={selectedDataset}
                sharedSet={sharedSetForDataset(selectedDataset.id)}
                onRename={(name) => renameDataset(selectedDataset.id, name)}
              />
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
  tab: "shared" | "matched" | "unique";
  setTab: (t: "shared" | "matched" | "unique") => void;
}) => {
  const [sharedQuery, setSharedQuery] = useState("");
  // Per-dataset selected columns for export. Empty/undefined ⇒ export ALL columns.
  // Toggled by double-clicking a header in the Matched rows view.
  const [selectionByDs, setSelectionByDs] = useState<Record<string, Set<string>>>({});
  // Reset selections when switching to a different intersection.
  useEffect(() => {
    setSelectionByDs({});
  }, [group.id]);

  const toggleColumn = (dsId: string, col: string) => {
    setSelectionByDs((s) => {
      const cur = new Set(s[dsId] ?? []);
      if (cur.has(col)) cur.delete(col);
      else cur.add(col);
      return { ...s, [dsId]: cur };
    });
  };

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
  const sq = sharedQuery.trim().toLowerCase();
  const filteredShared = sq
    ? group.sharedValues.filter((v) => v.toLowerCase().includes(sq))
    : group.sharedValues;

  const totalSelected = Object.values(selectionByDs).reduce((n, s) => n + s.size, 0);
  const exportColumnsArg = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(selectionByDs)) {
      if (v.size > 0) out[k] = Array.from(v);
    }
    return out;
  }, [selectionByDs]);

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

      <Button
        onClick={() => downloadIntersectionXlsx(group, datasets, exportColumnsArg)}
        className="w-full gap-2"
      >
        <Download className="h-4 w-4" />
        {totalSelected > 0
          ? `Download .xlsx (${totalSelected} selected col${totalSelected === 1 ? "" : "s"})`
          : "Download intersection .xlsx"}
      </Button>
      {totalSelected > 0 && (
        <button
          onClick={() => setSelectionByDs({})}
          className="text-[10px] text-muted-foreground hover:text-foreground underline -mt-2"
        >
          Clear column selection
        </button>
      )}

      <div className="flex gap-1 border-b border-[hsl(var(--panel-border))]">
        {(["shared", "matched", "unique"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${
              tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            {t === "shared"
              ? `Shared (${group.sharedValues.length})`
              : t === "matched"
              ? `Matched rows`
              : `Unique`}
          </button>
        ))}
      </div>

      {tab === "shared" ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={sharedQuery}
              onChange={(e) => setSharedQuery(e.target.value)}
              placeholder="Search shared values…"
              className="h-8 pl-7 text-xs bg-background/50"
            />
          </div>
          <p className="text-[10px] text-muted-foreground px-0.5">
            {filteredShared.length} of {group.sharedValues.length}
          </p>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {filteredShared.slice(0, 500).map((v) => (
              <div key={v} className="text-xs px-2 py-1 rounded bg-white/5 font-mono truncate">
                {v}
              </div>
            ))}
            {filteredShared.length > 500 && (
              <p className="text-xs text-muted-foreground">+{filteredShared.length - 500} more…</p>
            )}
            {filteredShared.length === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center">No matching values.</p>
            )}
          </div>
        </div>
      ) : tab === "matched" ? (
        <div className="space-y-3">
          <p className="text-[10px] text-muted-foreground -mb-1">
            Double-click a column header to include / exclude it from the export.
          </p>
          {groupDatasets.map((ds) => {
            const anchor = group.anchorColumnByDataset[ds.id] ?? ds.headers[0];
            const rows = group.rowsByDataset[ds.id] ?? [];
            const selected = selectionByDs[ds.id];
            const selCount = selected?.size ?? 0;
            return (
              <div key={ds.id}>
                <p className="text-xs font-semibold mb-1 flex items-center gap-2 flex-wrap" style={{ color: `hsl(var(${ds.colorVar}))` }}>
                  <span className="truncate">{ds.name}</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {rows.length} rows · anchor: <span className="font-mono">{anchor}</span>
                    {selCount > 0 && <> · {selCount} col{selCount === 1 ? "" : "s"} selected</>}
                  </span>
                </p>
                <RowsPreview
                  rows={rows}
                  highlight={sharedSet}
                  anchorColumn={anchor}
                  selectedColumns={selected}
                  onToggleColumn={(col) => toggleColumn(ds.id, col)}
                />
              </div>
            );
          })}
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

const DatasetPanel = ({
  dataset,
  sharedSet,
  onRename,
}: {
  dataset: Dataset;
  sharedSet: Set<string>;
  onRename: (name: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(dataset.name);
  // Keep draft in sync when switching dataset.
  useEffect(() => {
    setDraft(dataset.name);
    setEditing(false);
  }, [dataset.id, dataset.name]);

  return (
    <div className="p-4 space-y-3">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Dataset</p>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(draft);
                  setEditing(false);
                } else if (e.key === "Escape") {
                  setDraft(dataset.name);
                  setEditing(false);
                }
              }}
              onBlur={() => {
                onRename(draft);
                setEditing(false);
              }}
              className="flex-1 h-7 px-1.5 text-sm rounded bg-background/70 border border-foreground/40 focus:outline-none"
            />
            <button
              onClick={() => {
                onRename(draft);
                setEditing(false);
              }}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Save"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate flex-1" title={dataset.name}>
              {dataset.name}
            </p>
            <button
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Rename dataset"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {dataset.rows.length} rows · {dataset.headers.length} columns
        </p>
      </div>
      <RowsPreview rows={dataset.rows} highlight={sharedSet} />
    </div>
  );
};

const RowsPreview = ({
  rows,
  highlight,
  anchorColumn,
  selectedColumns,
  onToggleColumn,
}: {
  rows: Record<string, unknown>[];
  highlight?: Set<string>;
  /** When set, this column is pinned as the first column so common values stay aligned. */
  anchorColumn?: string;
  /**
   * If provided, double-clicking a header toggles inclusion in this set.
   * An empty / undefined set is treated as "all columns" by the export.
   */
  selectedColumns?: Set<string>;
  onToggleColumn?: (col: string) => void;
}) => {
  const [query, setQuery] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No rows.</p>;
  const rawHeaders = Object.keys(rows[0]);
  const headers =
    anchorColumn && rawHeaders.includes(anchorColumn)
      ? [anchorColumn, ...rawHeaders.filter((h) => h !== anchorColumn)]
      : rawHeaders;

  const q = query.trim().toLowerCase();
  const activeColFilters = Object.entries(colFilters).filter(([, v]) => v.trim() !== "");

  const filtered = rows.filter((r) => {
    if (q) {
      const hit = Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q));
      if (!hit) return false;
    }
    for (const [col, val] of activeColFilters) {
      const cv = String(r[col] ?? "").toLowerCase();
      if (!cv.includes(val.trim().toLowerCase())) return false;
    }
    return true;
  });

  const clearFilters = () => {
    setQuery("");
    setColFilters({});
  };
  const hasFilter = q !== "" || activeColFilters.length > 0;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all cells…"
          className="h-8 pl-7 pr-7 text-xs bg-background/50"
        />
        {hasFilter && (
          <button
            onClick={clearFilters}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title="Clear filters"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5">
        <span>
          {filtered.length} of {rows.length} rows
        </span>
        {hasFilter && <span>filters active</span>}
      </div>
      <div className="border border-[hsl(var(--panel-border))] rounded overflow-auto max-h-80">
        <table className="text-xs w-full">
          <thead className="bg-white/5 sticky top-0 z-10">
            <tr>
              {headers.map((h) => {
                const isAnchor = h === anchorColumn;
                const selectable = !!onToggleColumn;
                const anySelected = (selectedColumns?.size ?? 0) > 0;
                const isSelected = selectedColumns?.has(h) ?? false;
                // Visual state: when nothing is selected → all columns are "in" (no dim).
                // When some selected → unselected columns are dimmed.
                const dimmed = selectable && anySelected && !isSelected;
                return (
                  <th
                    key={h}
                    onDoubleClick={selectable ? () => onToggleColumn!(h) : undefined}
                    className={`text-left px-2 py-1 font-medium whitespace-nowrap select-none ${
                      isAnchor ? "text-foreground" : ""
                    } ${selectable ? "cursor-pointer" : ""} ${dimmed ? "opacity-40 line-through" : ""}`}
                    style={
                      isSelected
                        ? { background: "hsl(var(--intersection) / 0.30)", boxShadow: "inset 0 -2px 0 hsl(var(--intersection))" }
                        : isAnchor
                        ? { background: "hsl(var(--intersection) / 0.15)" }
                        : undefined
                    }
                    title={
                      selectable
                        ? isSelected
                          ? "Selected for export — double-click to exclude"
                          : anySelected
                          ? "Excluded from export — double-click to include"
                          : "Double-click to include only specific columns"
                        : isAnchor
                        ? "Anchor column (most common matches)"
                        : undefined
                    }
                  >
                    {h}
                    {isAnchor ? " ★" : ""}
                    {isSelected ? " ✓" : ""}
                  </th>
                );
              })}
            </tr>
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-1 py-1 bg-white/[0.02]">
                  <input
                    value={colFilters[h] ?? ""}
                    onChange={(e) =>
                      setColFilters((s) => ({ ...s, [h]: e.target.value }))
                    }
                    placeholder="filter…"
                    className="w-full min-w-[80px] h-6 px-1.5 text-[10px] rounded bg-background/60 border border-[hsl(var(--panel-border))] focus:outline-none focus:border-foreground/40"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((r, i) => (
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="px-2 py-3 text-center text-muted-foreground">
                  No matching rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <p className="text-xs text-muted-foreground p-2">+{filtered.length - 200} more rows…</p>
        )}
      </div>
    </div>
  );
};

export default Index;
