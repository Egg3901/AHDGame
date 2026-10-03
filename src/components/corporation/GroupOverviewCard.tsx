"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { DenseSection, KVList, KVRow, TableScroll, Td, Th } from "./dense/DenseKit";

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
    <DenseSection
      title={`Group: ${group.rootName}`}
      meta={`${group.memberCount} members in ${group.countries.length} ${group.countries.length === 1 ? "country" : "countries"}`}
    >
      <div className="space-y-3 py-1">
        <p className="text-xs text-muted">
          Members of a formalized group file together for loss relief within each country and
          share brand and logistics strength, converging on the strongest member each turn.
        </p>
        <div className="grid gap-x-8 sm:grid-cols-3">
          <KVList>
            <KVRow label="Group cash" value={formatAmount(group.totalLiquidCapitalAnchor)} />
          </KVList>
          <KVList>
            <KVRow label="Group revenue" value={formatAmount(group.totalRevenueAnchor)} />
          </KVList>
          <KVList>
            <KVRow label="Sectors" value={group.totalSectorCount.toLocaleString("en-US")} />
          </KVList>
        </div>
        <TableScroll>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Member</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">Sectors</Th>
              </tr>
            </thead>
            <tbody>
              {group.members.map((m) => (
                <tr key={m.corporationId}>
                  <Td className="max-w-[16rem] truncate">
                    <Link href={`/corporation/${m.corporationId}`} className="text-foreground hover:underline">
                      {m.name}
                    </Link>
                    {m.tickerSymbol && (
                      <span className="ml-1.5 font-mono text-[11px] text-muted">{m.tickerSymbol}</span>
                    )}
                    {m.isRoot && <span className="ml-1.5 text-[11px] text-muted">parent</span>}
                  </Td>
                  <Td align="right">{formatAmount(m.revenueAnchor)}</Td>
                  <Td align="right">{m.sectorCount}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <KVList>
          <KVRow
            mono={false}
            label="Industries"
            value={group.industries.map(labelize).join(", ") || "None yet"}
          />
          <KVRow
            mono={false}
            label="Loss relief this cycle"
            value={
              relief
                ? `${formatAmount(relief.totalReliefAnchor)} to ${relief.corpsCredited} ${relief.corpsCredited === 1 ? "member" : "members"} (turn ${relief.turn})`
                : "None applied recently"
            }
          />
          {tp && (
            <KVRow
              mono={false}
              label="Transfer pricing exposure"
              value={
                tp.exposedAgreements > 0
                  ? `${formatAmount(tp.openExposureAnchor)} on ${tp.exposedAgreements} ${tp.exposedAgreements === 1 ? "agreement" : "agreements"}`
                  : "All intra-group contracts at arm's length"
              }
            />
          )}
        </KVList>
        {audits.length > 0 && (
          <div>
            <p className="pb-1 text-xs font-medium text-muted">Recent transfer pricing audits</p>
            <table className="w-full border-collapse">
              <tbody>
                {audits.map((a, i) => (
                  <tr key={`${a.turn}-${i}`}>
                    <Td className="text-muted">
                      Turn {a.turn}: {a.corporationName}, reassessed by {a.treasury}
                    </Td>
                    <Td align="right" className="text-error">
                      {formatAmount(a.assessmentAnchor)} on {formatAmount(a.shiftedBaseAnchor)} shifted
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DenseSection>
  );
}
