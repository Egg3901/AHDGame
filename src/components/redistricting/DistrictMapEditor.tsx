"use client";

import { useEffect, useMemo, useState } from "react";
import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { Pool } from "@/lib/redistricting/pools";
import type { RedistrictCaps } from "@/lib/redistricting/caps";
import {
  buildSquareCells,
  categorizeDistrict,
  LEAN_CATEGORY_META,
  netLeanIndicator,
  POOL_COLORS,
} from "@/lib/redistricting/cardView";
import { cyclePool, gridToSquares, remainingBudget } from "@/lib/redistricting/editorState";
import { validateRedistrictMap } from "@/lib/redistricting/legality";
import { autoMapAll, AUTO_MAP_STRATEGIES, type AutoMapStrategy } from "@/lib/redistricting/autoMap";
import { DistrictCompositionSummary } from "./DistrictCompositionSummary";

const COLORS = POOL_COLORS;

const POOL_LABELS: Record<Pool, string> = { left: "Left", grey: "Swing", right: "Right" };

/** Editor paint tool: a specific pool, or cycle through pools per click. */
type Tool = Pool | "cycle";

function seatProjection(squares: DistrictSquares[]): { left: number; right: number; even: number } {
  let left = 0;
  let right = 0;
  let even = 0;
  for (const d of squares) {
    const lean = d.right - d.left;
    if (lean < 0) left++;
    else if (lean > 0) right++;
    else even++;
  }
  return { left, right, even };
}

function projectionText(p: { left: number; right: number; even: number }): string {
  const parts = [`${p.left} Left`, `${p.right} Right`];
  if (p.even > 0) parts.push(`${p.even} even`);
  return parts.join(" · ");
}

export function DistrictMapEditor({
  countryId,
  stateId,
  districts,
  budget,
  caps,
}: {
  countryId: string;
  stateId: string;
  districts: { index: number; squares: DistrictSquares }[];
  budget: DistrictSquares;
  caps: RedistrictCaps;
}) {
  const initialGrid = useMemo(() => districts.map((d) => buildSquareCells(d.squares)), [districts]);
  const initialSquares = useMemo(() => districts.map((d) => d.squares), [districts]);

  const [grid, setGrid] = useState<Pool[][]>(initialGrid);
  const [history, setHistory] = useState<Pool[][][]>([]);
  const [tool, setTool] = useState<Tool>("cycle");
  const [painting, setPainting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);

  // End a drag-paint stroke wherever the pointer is released.
  useEffect(() => {
    if (!painting) return;
    const stop = () => setPainting(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [painting]);

  const squares = useMemo(() => gridToSquares(grid), [grid]);
  const remaining = useMemo(() => remainingBudget(budget, grid), [grid, budget]);
  const conserved = remaining.left === 0 && remaining.right === 0 && remaining.grey === 0;
  const legality = useMemo(
    () => validateRedistrictMap(squares, budget, caps),
    [squares, budget, caps]
  );
  const dirty = useMemo(
    () => JSON.stringify(squares) !== JSON.stringify(initialSquares),
    [squares, initialSquares]
  );
  const canSubmit = conserved && legality.legal && dirty && !submitting;

  const projection = seatProjection(squares);
  const beforeProjection = useMemo(() => seatProjection(initialSquares), [initialSquares]);

  /** Push the current grid onto the undo stack, then apply `next`. */
  function commit(next: Pool[][]) {
    setHistory((h) => [...h, grid]);
    setGrid(next);
  }

  function paintCell(di: number, ci: number, fromDrag: boolean) {
    setAutoNote(null);
    setResult(null);
    setGrid((g) => {
      const cell = g[di][ci];
      // Cycle only advances on discrete clicks — dragging across blocks in
      // cycle mode would re-cycle every block the pointer crosses.
      const next = tool === "cycle" ? (fromDrag ? cell : cyclePool(cell)) : tool;
      if (next === cell) return g;
      return g.map((cells, i) => (i === di ? cells.map((c, j) => (j === ci ? next : c)) : cells));
    });
  }

  /** One history entry per stroke: a drag paints many blocks, undo removes them all. */
  function startStroke(di: number, ci: number) {
    setHistory((h) => [...h, grid]);
    setPainting(true);
    paintCell(di, ci, false);
  }

  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      setGrid(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }

  function resetToCurrent() {
    setAutoNote(null);
    commit(initialGrid.map((cells) => [...cells]));
  }

  // All six strategies against this state's budget and map laws, computed once.
  const autoOptions = useMemo(() => autoMapAll(budget, caps), [budget, caps]);

  function applyStrategy(strategy: AutoMapStrategy) {
    const option = autoOptions.find((o) => o.strategy === strategy);
    if (!option) return;
    const { map, adjusted } = option;
    if (map.length !== districts.length) {
      setAutoNote("Could not generate a map for this state.");
      return;
    }
    commit(map.map((sq) => buildSquareCells(sq)));
    setResult(null);
    const label = AUTO_MAP_STRATEGIES.find((s) => s.id === strategy)?.label ?? strategy;
    const p = seatProjection(map);
    setAutoNote(
      `${label}: projects ${projectionText(p)} (current map: ${projectionText(beforeProjection)}).` +
        (adjusted ? " The ideal layout was pulled back to meet this state's map laws." : "")
    );
  }

  async function submit() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/redistrict`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ districts: squares }),
        }
      );
      const data = await res.json();
      setResult(
        res.ok
          ? { ok: true, text: "Map redrawn. It takes effect at the next House election." }
          : { ok: false, text: data.violations?.join(" ") ?? data.error ?? "Failed." }
      );
    } catch {
      setResult({ ok: false, text: "Network error." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* How it works */}
      <details className="rounded-lg border border-card-border bg-card px-4 py-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
          How redistricting works
        </summary>
        <div className="mt-2 space-y-2 text-xs text-muted">
          <p>
            Each district holds 16 voter blocks: <span style={{ color: COLORS.left }}>Left</span>,{" "}
            <span style={{ color: COLORS.right }}>Right</span>, and{" "}
            <span className="text-foreground">Swing</span> (uncommitted). You decide which blocks go
            in which district — the state&apos;s voters are fixed, so every block you add somewhere
            must be removed somewhere else.
          </p>
          <p>
            A district&apos;s lean is its Right minus Left blocks. At the next House election each
            district goes to the party its lean favors, so packing your opponent&apos;s voters into
            a few lopsided districts and spreading your own thinly is how a gerrymander wins extra
            seats.
          </p>
          <p>
            State map laws limit how far you can go: districts can&apos;t stray too far from the
            state average (compactness), only so many may be extremely packed, and the statewide
            efficiency gap — a measure of wasted votes — is capped (fairness). The map check at the
            bottom lists exactly what a proposed map violates.
          </p>
        </div>
      </details>

      {/* Statewide composition: current map vs the proposed edit */}
      <DistrictCompositionSummary
        districts={squares}
        before={initialSquares}
        caps={caps}
        title="Composition"
      />

      {/* Auto-Map toolbar */}
      <div className="rounded-lg border border-card-border bg-card px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Auto-Map presets
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={history.length === 0}
              className="rounded-md border border-card-border px-2.5 py-1 text-xs hover:border-primary disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={resetToCurrent}
              className="rounded-md border border-card-border px-2.5 py-1 text-xs hover:border-primary"
            >
              Reset to current map
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {AUTO_MAP_STRATEGIES.map((s) => {
            const option = autoOptions.find((o) => o.strategy === s.id);
            const blocked = option !== undefined && !option.distinct;
            const sameAsLabel = blocked
              ? (AUTO_MAP_STRATEGIES.find((w) => w.id === option.sameAs)?.label ?? "a weaker map")
              : null;
            return (
              <button
                key={s.id}
                type="button"
                disabled={blocked}
                title={
                  blocked
                    ? `This state's map laws don't allow a ${s.label} gerrymander — the best legal map is identical to ${sameAsLabel}. Loosen the compactness or fairness laws to unlock it.`
                    : s.hint
                }
                onClick={() => applyStrategy(s.id)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  blocked
                    ? "cursor-not-allowed border-card-border/60 bg-card-muted/10 text-muted opacity-60"
                    : "border-card-border bg-card-muted/30 hover:border-primary"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {autoNote && <p className="text-xs text-foreground">{autoNote}</p>}
      </div>

      {/* Paint tool + budget meter */}
      <div className="rounded-lg border border-card-border bg-card px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Paint</span>
          {(["left", "grey", "right"] as Pool[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setTool(p)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
                tool === p ? "border-primary bg-card-muted/40" : "border-card-border"
              }`}
            >
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: COLORS[p] }}
              />
              {POOL_LABELS[p]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTool("cycle")}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              tool === "cycle" ? "border-primary bg-card-muted/40" : "border-card-border"
            }`}
          >
            Cycle
          </button>
          <span className="text-[11px] text-muted">
            {tool === "cycle"
              ? "Click a block to cycle Left → Right → Swing."
              : "Click or drag across blocks to paint them."}
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {(["left", "right", "grey"] as Pool[]).map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: COLORS[p] }}
              />
              <span
                className={
                  remaining[p] === 0
                    ? "text-muted"
                    : remaining[p] < 0
                      ? "text-error"
                      : "text-foreground"
                }
              >
                {POOL_LABELS[p]}: {budget[p] - remaining[p]}/{budget[p]} placed
                {remaining[p] > 0 && ` — ${remaining[p]} still to place`}
                {remaining[p] < 0 && ` — ${-remaining[p]} too many`}
              </span>
            </span>
          ))}
          <span className="ml-auto text-muted">
            Projected seats: <span className="text-foreground">{projectionText(projection)}</span>
          </span>
        </div>
      </div>

      {/* Paint grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {grid.map((cells, di) => {
          const sq = squares[di];
          const lean = sq.right - sq.left;
          const indicator = netLeanIndicator(lean);
          const category = LEAN_CATEGORY_META[categorizeDistrict(lean)];
          return (
            <div
              key={districts[di].index}
              className="rounded-lg border border-card-border bg-card overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-card-border/60 bg-card-muted/30 text-xs font-semibold">
                <span>District {districts[di].index}</span>
                <span className="flex items-center gap-1.5 font-medium">
                  <span style={{ color: indicator.color }}>{indicator.text}</span>
                  <span
                    className="rounded-sm px-1.5 py-0.5 text-[10px] text-white"
                    style={{ backgroundColor: category.color }}
                  >
                    {category.label}
                  </span>
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 px-3 py-3" style={{ touchAction: "none" }}>
                {cells.map((cell, ci) => (
                  <button
                    key={ci}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startStroke(di, ci);
                    }}
                    onPointerEnter={() => {
                      if (painting) paintCell(di, ci, true);
                    }}
                    className="aspect-square rounded-sm transition-transform hover:scale-95"
                    style={{ backgroundColor: COLORS[cell] }}
                    aria-label={`District ${districts[di].index} block ${ci + 1}: ${POOL_LABELS[cell]}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legality panel + submit */}
      <div className="rounded-lg border border-card-border bg-card px-4 py-3 space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Map check</span>
        {!conserved && (
          <p className="text-xs text-error">
            • Every voter block must be placed — see the &quot;still to place&quot; counts above.
          </p>
        )}
        {legality.violations.map((v, i) => (
          <p key={i} className="text-xs text-error">
            • {v}
          </p>
        ))}
        {conserved && legality.legal && (
          <p className="text-xs text-success">
            This map is legal{dirty ? " and ready to submit" : " (no changes yet)"}.
          </p>
        )}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {submitting ? "Submitting…" : "Submit map"}
          </button>
          {result && (
            <span className={`text-xs ${result.ok ? "text-success" : "text-error"}`}>
              {result.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
