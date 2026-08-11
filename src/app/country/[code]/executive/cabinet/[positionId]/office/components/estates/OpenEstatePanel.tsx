"use client";

import { useState } from "react";
import { getPortfolioCatalog } from "@/lib/constants/cabinetEstates";
import { EstateIcon, fmtMoneyM } from "./estatesUi";
import { metricLabel, fmtEffectDelta } from "../metricLabel";

export function OpenEstatePanel({
  portfolioKey,
  isForeign,
  sites,
  existingForeign,
  currencySymbol,
  busy,
  onOpen,
  onCancel,
}: {
  portfolioKey: string;
  isForeign: boolean;
  sites: Array<{ id: string; name: string }>;
  /** `${archetypeId}@${siteId}` already hosted (foreign one-per-host). */
  existingForeign: Set<string>;
  currencySymbol: string;
  busy: boolean;
  onOpen: (archetypeId: string, siteId: string, name: string) => void;
  onCancel: () => void;
}) {
  const catalog = getPortfolioCatalog(portfolioKey);
  const [sel, setSel] = useState(catalog[0]?.id ?? "");
  const [name, setName] = useState("");
  const archetype = catalog.find((a) => a.id === sel) ?? catalog[0];

  // For foreign, a host is selectable only if it doesn't already host this archetype.
  const availableSites =
    isForeign && archetype
      ? sites.filter((s) => !existingForeign.has(`${archetype.id}@${s.id}`))
      : sites;

  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  // Keep the chosen site valid as the archetype changes (foreign exclusions).
  const effectiveSiteId = availableSites.some((s) => s.id === siteId)
    ? siteId
    : (availableSites[0]?.id ?? "");

  if (!archetype) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-[13px] text-muted">
        No archetypes configured for this portfolio.
      </div>
    );
  }

  return (
    <div className="gov-glow rounded-xl border border-[color-mix(in_srgb,var(--gov)_30%,transparent)] bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Open a new facility</h3>
        <button onClick={onCancel} className="text-[12px] text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="dossier-label mb-1.5 text-muted">Type</div>
          <div className="grid gap-1.5">
            {catalog.map((a) => (
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
                  <EstateIcon name={a.icon} className="h-4 w-4 text-gov-soft" />
                  <span className="text-[12px] font-medium text-foreground">{a.label}</span>
                </span>
                <span className="tabular text-[11px] text-muted">
                  {fmtMoneyM(currencySymbol, a.upkeepBase)}/turn
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="dossier-label mb-1.5 text-muted">
            {isForeign ? "Host country" : "Region"}
          </div>
          <select
            value={effectiveSiteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-card-border bg-card-muted px-3 py-2 text-[13px] text-foreground outline-none focus:border-[var(--gov)]"
          >
            {availableSites.length === 0 && <option value="">No available site</option>}
            {availableSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <div className="dossier-label mb-1.5 mt-3 text-muted">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={archetype.label}
            className="rounded-lg border border-card-border bg-card-muted px-3 py-2 text-[13px] text-foreground outline-none focus:border-[var(--gov)]"
          />

          <p className="mt-3 text-[11px] leading-relaxed text-muted">{archetype.description}</p>

          <div className="mt-3 rounded-lg border border-card-border bg-card-muted p-3 text-[12px]">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Capacity</span>
              <span className="tabular text-foreground">
                {archetype.outputBase.toLocaleString("en-US")}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Upkeep / turn</span>
              <span className="tabular font-semibold text-foreground">
                {fmtMoneyM(currencySymbol, archetype.upkeepBase)}
              </span>
            </div>
            <div className="mt-1.5 border-t border-card-border pt-1.5">
              <div className="dossier-label mb-0.5 text-muted">
                {isForeign ? "Effects" : "Regional effects"}
              </div>
              {Object.entries(archetype.effects).map(([path, delta]) => (
                <div key={path} className="flex justify-between py-0.5">
                  <span className="text-muted">{metricLabel(path)}</span>
                  <span className="tabular text-foreground">{fmtEffectDelta(delta)}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            disabled={busy || !effectiveSiteId}
            onClick={() => onOpen(archetype.id, effectiveSiteId, name.trim() || archetype.label)}
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
