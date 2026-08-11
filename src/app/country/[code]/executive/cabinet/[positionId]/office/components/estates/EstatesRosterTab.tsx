"use client";

import { useMemo, useState } from "react";
import type { EstateView } from "../../useCabinetOffice";
import { getPortfolioCatalog } from "@/lib/constants/cabinetEstates";
import { AggTile, EstateIcon, fmtMoneyM } from "./estatesUi";
import { EstateCard } from "./EstateCard";
import { OpenEstatePanel } from "./OpenEstatePanel";

export function EstatesRosterTab({
  countryCode,
  positionId,
  portfolioKey,
  estates,
  canAct,
  currencySymbol,
  isForeign,
  sites,
  siteName,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  portfolioKey: string;
  estates: EstateView[];
  canAct: boolean;
  currencySymbol: string;
  isForeign: boolean;
  sites: Array<{ id: string; name: string }>;
  siteName: Record<string, string>;
  onUpdate: () => void;
}) {
  const catalog = getPortfolioCatalog(portfolioKey);
  const [archetypeId, setArchetypeId] = useState(catalog[0]?.id ?? "");
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const basePath = `/api/country/${countryCode}/executive/cabinet/${positionId}/estates`;

  const groupEstates = useMemo(
    () => estates.filter((e) => e.archetypeId === archetypeId),
    [estates, archetypeId]
  );
  const existingForeign = useMemo(
    () =>
      new Set(
        estates.filter((e) => e.siteScope === "country").map((e) => `${e.archetypeId}@${e.siteId}`)
      ),
    [estates]
  );

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

  if (catalog.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-[13px] text-muted">
        No facility types configured for this portfolio.
      </div>
    );
  }

  const gOutput = groupEstates.reduce((s, e) => s + e.effectiveOutput, 0);
  const gUpkeep = groupEstates.reduce((s, e) => s + e.effectiveUpkeep, 0);
  const gCond = groupEstates.length
    ? Math.round(groupEstates.reduce((s, e) => s + e.condition, 0) / groupEstates.length)
    : 0;

  return (
    <div className="space-y-4">
      {/* archetype sub-tabs */}
      <div className="rounded-xl border border-card-border bg-card p-2">
        <div className="flex flex-wrap gap-1.5">
          {catalog.map((a) => {
            const active = archetypeId === a.id;
            const count = estates.filter((e) => e.archetypeId === a.id).length;
            return (
              <button
                key={a.id}
                onClick={() => {
                  setArchetypeId(a.id);
                  setOpening(false);
                }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${
                  active ? "text-black" : "bg-card-muted text-muted hover:text-foreground"
                }`}
                style={active ? { background: "var(--gov)" } : undefined}
              >
                <EstateIcon name={a.icon} className="h-4 w-4" />
                <span>{a.label}</span>
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
        <AggTile label="Total output" value={gOutput.toLocaleString("en-US")} tone="gov" />
        <AggTile label="Avg condition" value={`${gCond}%`} ring={gCond} />
        <AggTile label="Annual upkeep" value={fmtMoneyM(currencySymbol, gUpkeep)} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {catalog.find((a) => a.id === archetypeId)?.label} · facilities
        </h2>
        <button
          onClick={() => setOpening(true)}
          disabled={!canAct || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)] px-3 py-1.5 text-[12px] font-semibold text-gov-soft hover:bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Open estate
        </button>
      </div>

      {opening && (
        <OpenEstatePanel
          portfolioKey={portfolioKey}
          isForeign={isForeign}
          sites={sites}
          existingForeign={existingForeign}
          currencySymbol={currencySymbol}
          busy={busy}
          onCancel={() => setOpening(false)}
          onOpen={(type, siteId, name) => {
            setOpening(false);
            setArchetypeId(type);
            act("POST", `${basePath}/open`, { archetypeId: type, siteId, name });
          }}
        />
      )}

      <div className="space-y-2.5">
        {groupEstates.length === 0 && (
          <div className="rounded-xl border border-card-border bg-card p-6 text-center text-[13px] text-muted">
            No facilities of this type. Open one to begin.
          </div>
        )}
        {groupEstates.map((e) => (
          <EstateCard
            key={e._id}
            estate={e}
            basePath={basePath}
            canAct={canAct}
            currencySymbol={currencySymbol}
            siteLabel={siteName[e.siteId] ?? e.siteId}
            busy={busy}
            onAction={act}
          />
        ))}
      </div>
    </div>
  );
}
