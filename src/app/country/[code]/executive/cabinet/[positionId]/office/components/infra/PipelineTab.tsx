"use client";

import { useState } from "react";
import type { ProjectView } from "../../useCabinetOffice";
import { AggTile, fmtMoneyM } from "./infraUi";
import { ProjectCard } from "./ProjectCard";
import { StartProjectPanel } from "./StartProjectPanel";

export function PipelineTab({
  countryCode,
  positionId,
  projects,
  canAct,
  currencySymbol,
  regions,
  siteName,
  committedSpend,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  projects: ProjectView[];
  canAct: boolean;
  currencySymbol: string;
  regions: Array<{ id: string; name: string }>;
  siteName: Record<string, string>;
  committedSpend: number;
  onUpdate: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const basePath = `/api/country/${countryCode}/executive/cabinet/${positionId}/infra`;

  async function act(method: "POST" | "DELETE", path: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) onUpdate();
    } finally {
      setBusy(false);
    }
  }

  const building = projects
    .filter((p) => p.status === "construction")
    .sort((a, b) => a.turnsRemaining - b.turnsRemaining);
  const operational = projects.filter((p) => p.status === "operational");

  const card = (p: ProjectView) => (
    <ProjectCard
      key={p._id}
      project={p}
      basePath={basePath}
      canAct={canAct}
      currencySymbol={currencySymbol}
      regionName={siteName[p.regionId] ?? p.regionId}
      busy={busy}
      onAction={act}
    />
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <AggTile label="Under construction" value={building.length} tone="gov" />
        <AggTile label="Operational" value={operational.length} />
        <AggTile label="Committed / turn" value={fmtMoneyM(currencySymbol, committedSpend)} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Project pipeline</h2>
        <button
          onClick={() => setStarting(true)}
          disabled={!canAct || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)] px-3 py-1.5 text-[12px] font-semibold text-gov-soft hover:bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start project
        </button>
      </div>

      {starting && (
        <StartProjectPanel
          regions={regions}
          currencySymbol={currencySymbol}
          busy={busy}
          onCancel={() => setStarting(false)}
          onStart={(archetypeId, regionId, name) => {
            setStarting(false);
            act("POST", `${basePath}/start`, { archetypeId, regionId, name });
          }}
        />
      )}

      <div>
        <div className="dossier-label mb-2 text-muted">Under construction</div>
        <div className="space-y-2.5">
          {building.length === 0 && (
            <div className="rounded-xl border border-card-border bg-card p-6 text-center text-[13px] text-muted">
              No projects under construction. Start one to begin.
            </div>
          )}
          {building.map(card)}
        </div>
      </div>

      <div>
        <div className="dossier-label mb-2 text-muted">Operational</div>
        <div className="space-y-2.5">
          {operational.length === 0 && (
            <div className="rounded-xl border border-card-border bg-card p-6 text-center text-[13px] text-muted">
              No operational infrastructure yet.
            </div>
          )}
          {operational.map(card)}
        </div>
      </div>
    </div>
  );
}
