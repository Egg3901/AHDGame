"use client";

import { useState } from "react";
import { ENERGY_SOURCES } from "@/lib/constants/cabinetEnergy";
import { EnergyIcon, fmtMoneyM, fmtCapacity } from "./energyUi";

export function BuildPlantPanel({
  regions,
  currencySymbol,
  busy,
  onBuild,
  onCancel,
}: {
  regions: Array<{ id: string; name: string }>;
  currencySymbol: string;
  busy: boolean;
  onBuild: (source: string, regionId: string, name: string) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState(ENERGY_SOURCES[0].id);
  const [name, setName] = useState("");
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const src = ENERGY_SOURCES.find((s) => s.id === sel) ?? ENERGY_SOURCES[0];

  return (
    <div className="gov-glow rounded-xl border border-[color-mix(in_srgb,var(--gov)_30%,transparent)] bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Build a new power plant</h3>
        <button onClick={onCancel} className="text-[12px] text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="dossier-label mb-1.5 text-muted">Source</div>
          <div className="grid gap-1.5">
            {ENERGY_SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSel(s.id)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left ${
                  sel === s.id
                    ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)]"
                    : "border-card-border bg-card-muted hover:border-[color-mix(in_srgb,var(--gov)_40%,transparent)]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <EnergyIcon name={s.icon} className="h-4 w-4 text-gov-soft" />
                  <span className="text-[12px] font-medium text-foreground">{s.label}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span>{s.renewable ? "renewable" : s.carbonPerMW <= 0 ? "clean" : "fossil"}</span>
                  <span>·</span>
                  <span>{s.firmness >= 0.8 ? "firm" : "intermittent"}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="dossier-label mb-1.5 text-muted">Region</div>
          <select
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
            className="rounded-lg border border-card-border bg-card-muted px-3 py-2 text-[13px] text-foreground outline-none focus:border-[var(--gov)]"
          >
            {regions.length === 0 && <option value="">No region available</option>}
            {regions.map((rg) => (
              <option key={rg.id} value={rg.id}>
                {rg.name}
              </option>
            ))}
          </select>

          <div className="dossier-label mb-1.5 mt-3 text-muted">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${src.label} Plant`}
            className="rounded-lg border border-card-border bg-card-muted px-3 py-2 text-[13px] text-foreground outline-none focus:border-[var(--gov)]"
          />

          <p className="mt-3 text-[11px] leading-relaxed text-muted">{src.description}</p>

          <div className="mt-3 rounded-lg border border-card-border bg-card-muted p-3 text-[12px]">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Capacity</span>
              <span className="tabular text-foreground">{fmtCapacity(src.baseCapacity)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Upkeep / turn</span>
              <span className="tabular font-semibold text-foreground">
                {fmtMoneyM(currencySymbol, src.baseCapacity * src.upkeepPerMW)}
              </span>
            </div>
          </div>

          <button
            disabled={busy || !regionId}
            onClick={() => onBuild(src.id, regionId, name.trim() || `${src.label} Plant`)}
            className="mt-3 w-full rounded-lg py-2 text-[13px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--gov)" }}
          >
            Authorize · 1 action
          </button>
        </div>
      </div>
    </div>
  );
}
