"use client";

import type { WorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";

export default function BackgroundMacroInspector({
  snapshot,
  selectedEntityId,
  onSelect,
  fullscreen = false,
}: {
  snapshot: WorldEntityMapSnapshot;
  selectedEntityId: string | null;
  onSelect: (entityId: string | null) => void;
  fullscreen?: boolean;
}) {
  const countries = [
    ...new Map(
      Object.values(snapshot.byEntityId ?? snapshot.byFeatureId)
        .filter(
          (item) =>
            item.status === "sovereign" &&
            item.simulationTier === "background-macro" &&
            item.macroSummary
        )
        .map((item) => [item.entityId, item])
    ).values(),
  ].sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (!countries.length) return null;
  const selected = countries.find((item) => item.entityId === selectedEntityId);
  const summary = selected?.macroSummary;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <div
      className={
        fullscreen
          ? "fixed bottom-4 left-4 right-4 z-[70] max-h-[45vh] overflow-y-auto rounded-xl border border-card-border bg-card/95 p-4"
          : "relative z-10 rounded-xl border border-card-border bg-card p-4"
      }
      style={{ cursor: "auto", touchAction: "pan-y" }}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <label className="block text-sm font-medium">
        Inspect a background country
        <select
          className="mt-2 w-full rounded-lg border border-card-border bg-background p-2 text-sm"
          value={selected?.entityId ?? ""}
          onChange={(event) => onSelect(event.target.value || null)}
        >
          <option value="">Choose a country</option>
          {countries.map((item) => (
            <option key={item.entityId} value={item.entityId}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      {selected && summary && (
        <aside
          aria-label={`${selected.displayName} macro summary`}
          className="mt-4 space-y-3 text-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-base">{selected.displayName}</h3>
            <button
              type="button"
              className="rounded border border-card-border px-3 py-2"
              onClick={() => onSelect(null)}
              aria-label="Close macro summary"
            >
              Close
            </button>
          </div>
          <p className="font-medium">Background macro simulation</p>
          <p className="text-muted-foreground">
            Aggregate economy only. Political play is unavailable.
          </p>
          {summary.provenance === "estimated-background" && (
            <p className="text-muted-foreground">
              Coarse simulation estimates, not historical statistics.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt>Population estimate</dt>
            <dd>{summary.population.toLocaleString("en-US")}</dd>
            <dt>Economic system</dt>
            <dd>{summary.economicSystem === "planned" ? "Planned" : "Market"}</dd>
            <dt>Stability</dt>
            <dd>{percent(summary.stability)}</dd>
            <dt>Trade exposure</dt>
            <dd>{percent(summary.tradeExposure)}</dd>
            <dt>Contribution turn</dt>
            <dd>{summary.contributionComputedOnTurn}</dd>
            <dt>Last macro tick</dt>
            <dd>{summary.lastMacroTickTurn ?? "Not yet processed"}</dd>
          </dl>
        </aside>
      )}
    </div>
  );
}
