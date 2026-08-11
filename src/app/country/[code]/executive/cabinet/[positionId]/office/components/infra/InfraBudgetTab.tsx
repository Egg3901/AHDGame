"use client";

import type { InfraSummaryView } from "../../useCabinetOffice";
import { INFRA_UPKEEP_UNIT } from "@/lib/constants/cabinetInfra";
import { SectionCard, Meter } from "../dossier";
import { fmtMoneyM, fmtMoneyAbs } from "./infraUi";

export function InfraBudgetTab({
  infraSummary,
  currencySymbol,
  siteName,
}: {
  infraSummary: InfraSummaryView;
  currencySymbol: string;
  siteName: Record<string, string>;
}) {
  const envelope = infraSummary.envelope; // absolute currency
  const committedAbs = infraSummary.committedSpend * INFRA_UPKEEP_UNIT; // millions → absolute
  const use = envelope > 0 ? committedAbs / envelope : committedAbs > 0 ? 1 : 0;
  const over = envelope > 0 && committedAbs > envelope;
  const remaining = envelope - committedAbs;

  const regionEntries = Object.entries(infraSummary.byRegion).sort(
    (a, b) => b[1].operational + b[1].building - (a[1].operational + a[1].building)
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Transportation discretionary budget"
        sub="Committed spend vs the discretionary line"
      >
        <div className="flex items-end justify-between">
          <div>
            <div className="dossier-label text-muted">Committed / turn</div>
            <div
              className={`tabular mt-1 text-2xl font-bold ${over ? "text-error" : "text-foreground"}`}
            >
              {fmtMoneyM(currencySymbol, infraSummary.committedSpend)}
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
        <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
          <div className="flex justify-between rounded-lg border border-card-border bg-card-muted px-3 py-2">
            <span className="text-muted">Construction</span>
            <span className="tabular text-foreground">
              {fmtMoneyM(currencySymbol, infraSummary.constructionSpend)}
            </span>
          </div>
          <div className="flex justify-between rounded-lg border border-card-border bg-card-muted px-3 py-2">
            <span className="text-muted">Operational upkeep</span>
            <span className="tabular text-foreground">
              {fmtMoneyM(currencySymbol, infraSummary.operationalUpkeep)}
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="By region" sub="Projects per regional grid">
        <div className="space-y-2">
          {regionEntries.length === 0 && (
            <div className="text-[12px] text-muted">No projects in the pipeline.</div>
          )}
          {regionEntries.map(([regionId, counts]) => (
            <div
              key={regionId}
              className="flex items-center justify-between border-b border-card-border py-2 text-[12px] last:border-0"
            >
              <span className="text-foreground">{siteName[regionId] ?? regionId}</span>
              <span className="tabular text-muted">
                {counts.operational} operational · {counts.building} building
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
