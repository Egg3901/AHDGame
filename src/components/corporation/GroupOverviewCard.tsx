"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";

interface GroupMember {
  corporationId: string;
  name: string;
  tickerSymbol?: string;
  countryId: string;
  isRoot: boolean;
  liquidCapitalAnchor: number;
  revenueAnchor: number;
  sectorCount: number;
}

interface GroupSheet {
  rootCorporationId: string;
  rootName: string;
  memberCount: number;
  members: GroupMember[];
  totalLiquidCapitalAnchor: number;
  totalRevenueAnchor: number;
  totalSectorCount: number;
  industries: string[];
  countries: string[];
}

interface LossRelief {
  turn: number;
  corpsCredited: number;
  totalReliefAnchor: number;
}

interface AuditOutcome {
  turn: number;
  corporationName: string;
  treasury: string;
  shiftedBaseAnchor: number;
  assessmentAnchor: number;
}

interface TransferPricing {
  exposedAgreements: number;
  openExposureAnchor: number;
  recentAudits: AuditOutcome[];
}

interface GroupPayload {
  group: GroupSheet | null;
  lossRelief: LossRelief | null;
  transferPricing: TransferPricing | null;
}

const labelize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Consolidated group view (C4). Renders nothing at all unless this corporation
 * is part of a formalized group of two or more members.
 */
export function GroupOverviewCard({ corpId }: { corpId: string }) {
  const [data, setData] = useState<GroupPayload | null>(null);
  const { formatAmount } = useCurrency();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/corporations/${corpId}/group`)
      .then((res) => (res.ok ? (res.json() as Promise<GroupPayload>) : null))
      .then((payload) => {
        if (!cancelled && payload) setData(payload);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [corpId]);

  const group = data?.group;
  if (!group) return null;

  const relief = data?.lossRelief ?? null;
  const tp = data?.transferPricing ?? null;
  const audits = tp?.recentAudits ?? [];

  return (
    <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-foreground">{group.rootName} Group</h2>
        <span className="text-xs text-muted">
          {group.memberCount} members across {group.countries.length}{" "}
          {group.countries.length === 1 ? "country" : "countries"}
        </span>
      </div>
      <p className="text-xs text-muted">
        Consolidated view of the formalized group. Members file together for loss relief within each
        country and share brand and logistics strength, converging toward the group&apos;s strongest
        each turn.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted">Group Cash</div>
          <div className="text-sm font-semibold text-foreground tabular-nums">
            {formatAmount(group.totalLiquidCapitalAnchor)}
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted">Group Revenue</div>
          <div className="text-sm font-semibold text-foreground tabular-nums">
            {formatAmount(group.totalRevenueAnchor)}
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted">Sectors</div>
          <div className="text-sm font-semibold text-foreground tabular-nums">
            {group.totalSectorCount}
          </div>
        </div>
      </div>

      <ul className="divide-y divide-card-border rounded-lg border border-card-border overflow-hidden">
        {group.members.map((m) => (
          <li
            key={m.corporationId}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-card-elevated/40"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href={`/corporation/${m.corporationId}`}
                className="font-medium text-primary hover:underline min-w-0 truncate"
              >
                {m.name}
              </Link>
              {m.tickerSymbol && (
                <span className="text-[10px] text-muted tabular-nums shrink-0">
                  {m.tickerSymbol}
                </span>
              )}
              {m.isRoot && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary border border-primary/30 rounded px-1.5 py-0.5 shrink-0">
                  Parent
                </span>
              )}
            </div>
            <span className="text-xs tabular-nums text-muted shrink-0">
              {formatAmount(m.revenueAnchor)} revenue · {m.sectorCount}{" "}
              {m.sectorCount === 1 ? "sector" : "sectors"}
            </span>
          </li>
        ))}
      </ul>

      <div className="text-xs text-muted">
        Operates in {group.industries.map(labelize).join(", ") || "no industries yet"}.
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-muted">Loss relief this cycle</span>
          <span className="tabular-nums text-foreground">
            {relief
              ? `${formatAmount(relief.totalReliefAnchor)} credited to ${relief.corpsCredited} ${relief.corpsCredited === 1 ? "member" : "members"} (turn ${relief.turn})`
              : "None applied recently"}
          </span>
        </div>
        {tp && (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-muted">Transfer pricing exposure</span>
            <span className="tabular-nums text-foreground">
              {tp.exposedAgreements > 0
                ? `${formatAmount(tp.openExposureAnchor)} accrued on ${tp.exposedAgreements} ${tp.exposedAgreements === 1 ? "agreement" : "agreements"}`
                : "All intra-group contracts at arm's length"}
            </span>
          </div>
        )}
      </div>

      {audits.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Recent transfer pricing audits
          </div>
          <ul className="space-y-1 text-xs">
            {audits.map((a, i) => (
              <li
                key={`${a.turn}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span className="text-muted">
                  Turn {a.turn}: {a.corporationName} reassessed by {a.treasury}
                </span>
                <span className="tabular-nums text-error">
                  {formatAmount(a.assessmentAnchor)} assessed on {formatAmount(a.shiftedBaseAnchor)}{" "}
                  shifted
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
