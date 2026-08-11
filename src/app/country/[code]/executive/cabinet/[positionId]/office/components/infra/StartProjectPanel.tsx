"use client";

import { useState } from "react";
import { INFRA_ARCHETYPES } from "@/lib/constants/cabinetInfra";
import { InfraIcon, fmtMoneyM } from "./infraUi";
import { metricLabel, fmtEffectDelta } from "../metricLabel";

export function StartProjectPanel({
  regions,
  currencySymbol,
  busy,
  onStart,
  onCancel,
}: {
  regions: Array<{ id: string; name: string }>;
  currencySymbol: string;
  busy: boolean;
  onStart: (archetypeId: string, regionId: string, name: string) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState(INFRA_ARCHETYPES[0].id);
  const [name, setName] = useState("");
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const arch = INFRA_ARCHETYPES.find((a) => a.id === sel) ?? INFRA_ARCHETYPES[0];

  return (
    <div className="gov-glow rounded-xl border border-[color-mix(in_srgb,var(--gov)_30%,transparent)] bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Start a new project</h3>
        <button onClick={onCancel} className="text-[12px] text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="dossier-label mb-1.5 text-muted">Project type</div>
          <div className="grid gap-1.5">
            {INFRA_ARCHETYPES.map((a) => (
              <button
                key={a.id}
                onClick={() => setSel(a.id)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left ${
                  sel === a.id
                    ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)]"
                    : "border-card-border bg-card-muted hover:border-[color-mix(in_srgb,var(--gov)_40%,transparent)]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <InfraIcon name={a.icon} className="h-4 w-4 text-gov-soft" />
                  <span className="text-[12px] font-medium text-foreground">{a.label}</span>
                </span>
                <span className="text-[10px] text-muted">{a.buildDuration} turns</span>
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
            placeholder={arch.label}
            className="rounded-lg border border-card-border bg-card-muted px-3 py-2 text-[13px] text-foreground outline-none focus:border-[var(--gov)]"
          />

          <p className="mt-3 text-[11px] leading-relaxed text-muted">{arch.description}</p>

          <div className="mt-3 rounded-lg border border-card-border bg-card-muted p-3 text-[12px]">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Build time</span>
              <span className="tabular text-foreground">{arch.buildDuration} turns</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Construction / turn</span>
              <span className="tabular text-foreground">
                {fmtMoneyM(currencySymbol, arch.constructionCostBase)}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Upkeep / turn (once live)</span>
              <span className="tabular font-semibold text-foreground">
                {fmtMoneyM(currencySymbol, arch.upkeepBase)}
              </span>
            </div>
            <div className="mt-1.5 border-t border-card-border pt-1.5">
              <div className="dossier-label mb-0.5 text-muted">Regional effects (once live)</div>
              {Object.entries(arch.effects).map(([path, delta]) => (
                <div key={path} className="flex justify-between py-0.5">
                  <span className="text-muted">{metricLabel(path)}</span>
                  <span className="tabular text-foreground">{fmtEffectDelta(delta)}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            disabled={busy || !regionId}
            onClick={() => onStart(arch.id, regionId, name.trim() || arch.label)}
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
