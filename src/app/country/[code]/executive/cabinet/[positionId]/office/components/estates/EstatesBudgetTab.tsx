"use client";

import type { EstateView, EstateSummaryView } from "../../useCabinetOffice";
import { ESTATE_UPKEEP_UNIT } from "@/lib/constants/cabinetEstates";
import { SectionCard, Meter } from "../dossier";
import { fmtMoneyM, fmtMoneyAbs } from "./estatesUi";

export function EstatesBudgetTab({
  estates,
  estateSummary,
  currencySymbol,
  siteName,
}: {
  estates: EstateView[];
  estateSummary: EstateSummaryView;
  currencySymbol: string;
  siteName: Record<string, string>;
}) {
  const envelope = estateSummary.envelope; // absolute currency
  const upkeepAbs = estateSummary.totalUpkeep * ESTATE_UPKEEP_UNIT; // millions → absolute
  const use = envelope > 0 ? upkeepAbs / envelope : upkeepAbs > 0 ? 1 : 0;
  const over = envelope > 0 && upkeepAbs > envelope;
  const remaining = envelope - upkeepAbs;

  // Per-site upkeep rollup.
  const bySite = new Map<string, number>();
  for (const e of estates) {
    bySite.set(e.siteId, (bySite.get(e.siteId) ?? 0) + e.effectiveUpkeep);
  }
  const siteCosts = [...bySite.entries()]
    .map(([id, cost]) => ({ id, name: siteName[id] ?? id, cost }))
    .filter((s) => s.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  const maxCost = Math.max(...siteCosts.map((s) => s.cost), 1);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Portfolio discretionary budget"
        sub="Estate upkeep vs the discretionary line"
      >
        <div className="flex items-end justify-between">
          <div>
            <div className="dossier-label text-muted">Estate upkeep / committed</div>
            <div
              className={`tabular mt-1 text-2xl font-bold ${over ? "text-error" : "text-foreground"}`}
            >
              {fmtMoneyM(currencySymbol, estateSummary.totalUpkeep)}
            </div>
          </div>
          <div className="text-right">
            <div className="dossier-label text-muted">{over ? "Over budget" : "Unallocated"}</div>
            <div
              className={`tabular mt-1 text-2xl font-bold ${over ? "text-error" : "text-success"}`}
            >
              {fmtMoneyAbs(currencySymbol, Math.abs(remaining))}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Meter
            value={Math.min(100, use * 100)}
            color={over ? "linear-gradient(90deg,#b91c1c,#ef4444)" : "var(--gov)"}
            height={10}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted">
          <span>{Math.round(use * 100)}% committed</span>
          {over ? (
            <span className="font-semibold text-error">Overspend → budget-balance penalty</span>
          ) : (
            <span>Discretionary budget: {fmtMoneyAbs(currencySymbol, envelope)}</span>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Cost of estates · by location" sub="Annual upkeep share">
        <div className="space-y-2.5">
          {siteCosts.length === 0 && (
            <div className="text-[12px] text-muted">No facilities in service.</div>
          )}
          {siteCosts.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-[12px] text-foreground">{s.name}</span>
              <div className="flex-1">
                <Meter value={(s.cost / maxCost) * 100} height={6} />
              </div>
              <span className="mono w-16 shrink-0 text-right text-[12px] font-semibold tabular text-foreground">
                {fmtMoneyM(currencySymbol, s.cost)}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
