"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Modal, Toast } from "@/components/ui";
import type { ToastVariant } from "@/components/ui/Toast";
import { usePositionEditorState } from "./usePositionEditorState";
import { Layer1Tab } from "./tabs/Layer1Tab";
import { CompositionTab } from "./tabs/CompositionTab";
import { FinalCompositionTab } from "./tabs/FinalCompositionTab";
import { LivePreviewPanel } from "./LivePreviewPanel";
import {
  computeDerivedComposition,
  editorPositionsTable,
  editorTurnoutTable,
  editorCompositionTable,
} from "@/lib/positionEditor/derive";
import { loadOverride, clearOverride } from "@/lib/positionEditor/storage";
import { stateConfigToCsv, downloadCsv } from "@/lib/positionEditor/csv";
import type { EraId, EditorStateConfig } from "@/lib/positionEditor/types";

const TABS = ["Layer 1 Demographics", "Archetype Composition Rates", "Final Composition"] as const;

/** Returns a list of dimension names whose shares don't sum to 100 (±0.5). */
function getInvalidDims(cfg: EditorStateConfig): Array<{ dim: string; sum: number }> {
  const invalid: Array<{ dim: string; sum: number }> = [];
  for (const dim of cfg.dims) {
    const sum = Object.values(cfg.layer1[dim] ?? {}).reduce((a, e) => a + e.share, 0);
    if (Math.abs(sum - 100) > 0.5) invalid.push({ dim, sum: Math.round(sum * 10) / 10 });
  }
  return invalid;
}

export function StateEditor({
  country,
  state,
  era,
}: {
  country: string;
  state: string;
  era: EraId;
}) {
  const { state: ed, dispatch, load } = usePositionEditorState();
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const [notFound, setNotFound] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);

  /** Fetch the global preset config for this state and load it into the editor. */
  const loadPreset = useCallback(() => {
    fetch(`/api/admin/position-editor/preset?era=${era}&country=${country}`)
      .then((r) => r.json())
      .then((d) => {
        const found = (d.states ?? []).find(
          (s: { stateId: string; config: EditorStateConfig }) => s.stateId === state
        );
        if (found) {
          load(found.config);
          setNotFound(false);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true));
  }, [era, country, state, load]);

  useEffect(() => {
    const override = loadOverride(era, country, state);
    if (override) {
      load(override);
      return;
    }
    loadPreset();
  }, [era, country, state, load, loadPreset]);

  const derived = useMemo(
    () => (ed.config ? computeDerivedComposition(ed.config) : null),
    [ed.config]
  );

  if (notFound && !ed.config)
    return (
      <p className="p-6 text-sm text-muted">
        No Layer-1 model for {country} {era}
      </p>
    );

  if (!ed.config || !derived) return <p className="p-6 text-sm text-muted">Loading {state}…</p>;
  const cfg = ed.config;

  const invalidDims = getInvalidDims(cfg);
  const sharesValid = invalidDims.length === 0;

  function resetToPreset() {
    clearOverride(era, country, state);
    setNotFound(false);
    loadPreset();
    setToast({ message: "Reset to preset defaults.", variant: "info" });
  }

  async function applyToSeed() {
    setApplying(true);
    try {
      const res = await fetch("/api/admin/position-editor/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: cfg.countryId,
          era,
          positions: editorPositionsTable(cfg),
          turnout: editorTurnoutTable(cfg),
          composition: editorCompositionTable(cfg),
        }),
      });
      const data = await res.json();
      setToast(
        res.ok
          ? { message: data.note ?? "Saved as global seed defaults.", variant: "success" }
          : { message: data.error ?? "Failed to save.", variant: "error" }
      );
    } catch {
      setToast({ message: "Failed to save.", variant: "error" });
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-card-border bg-card/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Link
          href="/admin/position-editor"
          className="text-sm text-muted transition-colors hover:text-foreground"
        >
          ← Map
        </Link>
        <h1 className="font-serif text-xl text-foreground">
          {state} · {era}
        </h1>
        <span className={`text-xs ${ed.dirty ? "text-warning" : "text-success"}`}>
          {ed.dirty ? "Saving…" : "Saved"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={resetToPreset}>
            Reset to preset
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!sharesValid}
            onClick={() =>
              downloadCsv(
                `positions-full-${era}-${country}-${state}.csv`,
                stateConfigToCsv(cfg, derived)
              )
            }
          >
            ↓ Export CSV
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!sharesValid}
            onClick={() => setConfirmOpen(true)}
          >
            Apply to seed
          </Button>
        </div>
      </div>

      {!sharesValid && (
        <div className="mt-3 rounded-lg border border-error/40 bg-error/10 px-4 py-2 text-sm text-error">
          Dimension shares must each sum to 100 before saving or exporting.{" "}
          {invalidDims.map(({ dim, sum }) => `${dim} Σ ${sum}`).join(" · ")}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-4 flex gap-1 border-b border-card-border">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-sm transition-colors ${
                  tab === t
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === TABS[0] && (
            <Layer1Tab
              config={cfg}
              onChange={(dim, key, field, value) =>
                dispatch({ type: "SET_LAYER1", dim, key, field, value })
              }
              onNormalize={(dim) => {
                const entries = Object.entries(cfg.layer1[dim]);
                const sum = entries.reduce((s, [, e]) => s + e.share, 0);
                if (sum === 0) return;
                entries.forEach(([key, e]) => {
                  const normalized = Math.round((e.share / sum) * 1000) / 10;
                  dispatch({ type: "SET_LAYER1", dim, key, field: "share", value: normalized });
                });
              }}
            />
          )}
          {tab === TABS[1] && (
            <CompositionTab
              config={cfg}
              onWeight={(archetypeId, index, value) =>
                dispatch({ type: "SET_WEIGHT", archetypeId, index, value })
              }
              onAdd={(archetypeId, dim, key) =>
                dispatch({ type: "ADD_WEIGHT", archetypeId, dim, key })
              }
              onRemove={(archetypeId, index) =>
                dispatch({ type: "REMOVE_WEIGHT", archetypeId, index })
              }
              onCivic={(archetypeId, value) => dispatch({ type: "SET_CIVIC", archetypeId, value })}
            />
          )}
          {tab === TABS[2] && <FinalCompositionTab derived={derived} />}
        </div>
        <LivePreviewPanel derived={derived} />
      </div>

      <Modal
        open={confirmOpen}
        title="Apply to global seed defaults?"
        onClose={() => setConfirmOpen(false)}
      >
        <p className="text-sm text-muted">
          Apply these positions, turnout rates, and archetype composition as the global{" "}
          <span className="font-semibold text-foreground">{era}</span> seed defaults? This affects
          every state when the world is reseeded with the flag on. (Per-state Layer-1 shares stay
          census-driven and are not saved.)
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" isLoading={applying} onClick={applyToSeed}>
            Apply to seed
          </Button>
        </div>
      </Modal>

      {toast && (
        <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
