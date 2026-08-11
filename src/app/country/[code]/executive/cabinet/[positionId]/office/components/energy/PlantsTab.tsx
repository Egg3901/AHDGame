"use client";

import { useMemo, useState } from "react";
import type { PlantView } from "../../useCabinetOffice";
import { ENERGY_SOURCES } from "@/lib/constants/cabinetEnergy";
import { AggTile, EnergyIcon, fmtMoneyM, fmtCapacity } from "./energyUi";
import { PlantCard } from "./PlantCard";
import { BuildPlantPanel } from "./BuildPlantPanel";

export function PlantsTab({
  countryCode,
  positionId,
  plants,
  canAct,
  currencySymbol,
  regions,
  siteName,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  plants: PlantView[];
  canAct: boolean;
  currencySymbol: string;
  regions: Array<{ id: string; name: string }>;
  siteName: Record<string, string>;
  onUpdate: () => void;
}) {
  const [source, setSource] = useState(ENERGY_SOURCES[0].id);
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState(false);
  const basePath = `/api/country/${countryCode}/executive/cabinet/${positionId}/energy`;

  const groupPlants = useMemo(() => plants.filter((p) => p.source === source), [plants, source]);

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

  const gCapacity = groupPlants.reduce((s, p) => s + p.effectiveCapacity, 0);
  const gUpkeep = groupPlants.reduce((s, p) => s + p.effectiveUpkeep, 0);

  return (
    <div className="space-y-4">
      {/* source sub-tabs */}
      <div className="rounded-xl border border-card-border bg-card p-2">
        <div className="flex flex-wrap gap-1.5">
          {ENERGY_SOURCES.map((s) => {
            const active = source === s.id;
            const count = plants.filter((p) => p.source === s.id).length;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setSource(s.id);
                  setBuilding(false);
                }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${
                  active ? "text-black" : "bg-card-muted text-muted hover:text-foreground"
                }`}
                style={active ? { background: "var(--gov)" } : undefined}
              >
                <EnergyIcon name={s.icon} className="h-4 w-4" />
                <span>{s.label}</span>
                <span
                  className={`rounded-full px-1.5 text-[10px] ${active ? "bg-black/20" : "bg-card-border"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* group aggregate */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <AggTile label="Plants" value={groupPlants.length} tone="gov" />
        <AggTile label="Capacity" value={fmtCapacity(gCapacity)} />
        <AggTile label="Annual upkeep" value={fmtMoneyM(currencySymbol, gUpkeep)} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {ENERGY_SOURCES.find((s) => s.id === source)?.label} · plants
        </h2>
        <button
          onClick={() => setBuilding(true)}
          disabled={!canAct || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)] px-3 py-1.5 text-[12px] font-semibold text-gov-soft hover:bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Build plant
        </button>
      </div>

      {building && (
        <BuildPlantPanel
          regions={regions}
          currencySymbol={currencySymbol}
          busy={busy}
          onCancel={() => setBuilding(false)}
          onBuild={(src, regionId, name) => {
            setBuilding(false);
            setSource(src as (typeof ENERGY_SOURCES)[number]["id"]);
            act("POST", `${basePath}/build`, { source: src, regionId, name });
          }}
        />
      )}

      <div className="space-y-2.5">
        {groupPlants.length === 0 && (
          <div className="rounded-xl border border-card-border bg-card p-6 text-center text-[13px] text-muted">
            No plants of this source. Build one to begin.
          </div>
        )}
        {groupPlants.map((p) => (
          <PlantCard
            key={p._id}
            plant={p}
            basePath={basePath}
            canAct={canAct}
            currencySymbol={currencySymbol}
            regionName={siteName[p.regionId] ?? p.regionId}
            busy={busy}
            onAction={act}
          />
        ))}
      </div>
    </div>
  );
}
