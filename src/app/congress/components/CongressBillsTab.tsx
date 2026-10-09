"use client";

import { useState, useEffect, useCallback } from "react";
import type { BillDisplay, BillsResponse } from "@/lib/legislature/dto/billDisplay";
import { EmptyState } from "./CongressShared";
import { STATUS_LABELS } from "./CongressConstants";
import { ProposeBillModal } from "./ProposeBillModal";
import type { ChamberTab } from "./CongressConstants";
import type { CountryId } from "@/lib/constants/countries";
import type { BillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";
import { BillCard } from "@/components/bills/BillCard";
import { BillListItem, BillListStack } from "@/components/bills/BillListItem";
import { ListRowSkeleton } from "@/components/ui";
import { BillListControls, type BillVoteFilter } from "@/components/bills/BillListControls";
import { LegislatureSeal } from "@/components/legislature/LegislatureSeal";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { NominationCard, type NominationDisplay } from "./NominationCard";
import {
  getCurrentCongressBillVote,
  matchesCongressBillStatusFilter,
} from "@/lib/congress/congressBillFilters";

export function CongressBillsTab({
  activeTab,
  canPropose,
  adminOverride,
  myChamber,
  hasActiveBill,
  countryId,
}: {
  activeTab: ChamberTab;
  canPropose: boolean;
  adminOverride?: boolean;
  myChamber?: "house" | "senate" | null;
  hasActiveBill?: boolean;
  countryId: CountryId;
}) {
  const [bills, setBills] = useState<BillDisplay[]>([]);
  const [nominations, setNominations] = useState<NominationDisplay[]>([]);
  const [blockedProvisions, setBlockedProvisions] = useState<
    { legislationTypeId: string; policyOptionId: string }[]
  >([]);
  const [proposalWarnings, setProposalWarnings] = useState<
    Record<string, BillProposalAutoFailWarning | null>
  >({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showPropose, setShowPropose] = useState(false);
  const [voteFilter, setVoteFilter] = useState<BillVoteFilter>("all");

  const fetchAll = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ chamber: activeTab });
        const [billsRes, cabinetNomRes, scotusNomRes] = await Promise.all([
          fetch(`/api/congress/bills?${params}`, { cache: "no-store", signal }),
          activeTab === "senate"
            ? fetch("/api/congress/cabinet-nominations", { cache: "no-store", signal })
            : null,
          activeTab === "senate"
            ? fetch("/api/congress/scotus-nominations", { cache: "no-store", signal })
            : null,
        ]);
        if (billsRes.ok) {
          const data: BillsResponse = await billsRes.json();
          setBills(data.bills);
          setBlockedProvisions(data.blockedProvisions ?? []);
          setProposalWarnings(data.proposalWarnings ?? {});
        }
        if (activeTab === "senate") {
          const merged: NominationDisplay[] = [];
          if (cabinetNomRes?.ok) {
            const data = await cabinetNomRes.json();
            for (const n of data.nominations ?? []) {
              merged.push({ ...n, kind: "cabinet" as const });
            }
          }
          if (scotusNomRes?.ok) {
            const data = await scotusNomRes.json();
            for (const n of data.nominations ?? []) {
              merged.push({ ...n, kind: "scotus" as const });
            }
          }
          setNominations(merged);
        } else {
          setNominations([]);
        }
      } catch (err) {
        // Mobile Safari surfaces in-flight fetch aborts as "TypeError: Load failed"
        // (and other browsers as "Failed to fetch" / DOMException AbortError).
        // None of these are actionable when the user navigated away mid-load.
        if (signal?.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        throw err;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [activeTab]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchAll(controller.signal).catch(() => {
      // Already swallowed above for aborts; anything else is logged by Sentry
      // via the global handler but should not crash this effect.
    });
    return () => controller.abort();
  }, [fetchAll]);

  const filteredBills = bills.filter((b) =>
    matchesCongressBillStatusFilter(
      b.status,
      statusFilter as "all" | "active" | "enrolled" | "signed" | "failed"
    )
  );

  const voteFiltered = (() => {
    if (voteFilter === "voted")
      return filteredBills.filter((b) => getCurrentCongressBillVote(b) != null);
    if (voteFilter === "not_voted")
      return filteredBills.filter((b) => getCurrentCongressBillVote(b) == null);
    return filteredBills;
  })();

  const filteredNominations =
    activeTab === "senate" && (statusFilter === "all" || statusFilter === "active")
      ? nominations
      : [];

  type ListItem =
    | { type: "bill"; id: string; date: string; priority: number }
    | {
        type: "nomination";
        id: string;
        date: string;
        kind: "cabinet" | "scotus";
        priority: number;
      };
  const sortedItems: ListItem[] = [
    ...voteFiltered.map((b) => ({
      type: "bill" as const,
      id: b.id,
      date:
        b.status === "veto_override" ? (b.overrideVotingStartedAt ?? b.proposedAt) : b.proposedAt,
      // A veto is a fresh live phase, so it belongs above the ordinary
      // proposal-date stream in both chamber tabs.
      priority: b.status === "veto_override" ? 1 : 0,
    })),
    ...filteredNominations.map((n) => ({
      type: "nomination" as const,
      id: n.id,
      date: n.proposedAt ?? "",
      kind: n.kind,
      priority: 0,
    })),
  ].sort(
    (a, b) => b.priority - a.priority || new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const chamberConfig = COUNTRY_CONFIGS[countryId].legislature;
  const chamber = activeTab === "senate" ? chamberConfig.upperChamber : chamberConfig.lowerChamber;
  const STATUS_KEYS = ["all", "active", "enrolled", "signed", "failed"] as const;
  const statusCounts = Object.fromEntries(
    STATUS_KEYS.map((key) => [
      key,
      bills.filter((b) => matchesCongressBillStatusFilter(b.status, key)).length +
        (activeTab === "senate" && (key === "all" || key === "active") ? nominations.length : 0),
    ])
  ) as Record<string, number>;
  const openVotes = statusCounts.active;

  const billMap = new Map(voteFiltered.map((b) => [b.id, b]));
  const nomMap = new Map(filteredNominations.map((n) => [`${n.kind}:${n.id}`, n]));

  return (
    <>
      {showPropose && (
        <ProposeBillModal
          chamber={activeTab}
          adminOverride={adminOverride}
          myChamber={myChamber}
          hasActiveBill={!canPropose && hasActiveBill}
          countryId={countryId}
          blockedProvisions={blockedProvisions}
          proposalWarnings={proposalWarnings}
          onClose={() => setShowPropose(false)}
          onSuccess={fetchAll}
        />
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-card-border bg-card px-4 py-3 shadow-card">
          <LegislatureSeal
            countryId={countryId}
            chamberKey={chamber?.key}
            chamberName={chamber?.name}
            size={52}
          />
          <div className="min-w-[9rem] flex-1">
            <h2 className="truncate text-lg font-semibold leading-tight text-foreground">
              {chamber?.name ?? (activeTab === "senate" ? "Senate" : "House")}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {chamber?.seats != null && <>{chamber.seats} seats · </>}
              {openVotes === 0
                ? "No open votes"
                : `${openVotes} open vote${openVotes === 1 ? "" : "s"}`}
            </p>
          </div>
          {canPropose && adminOverride && (
            <button
              onClick={() => setShowPropose(true)}
              title="Admin: opens to a vote in this chamber immediately"
              className="shrink-0 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              Propose bill (admin)
            </button>
          )}
        </div>

        <div className="flex w-full min-w-0 flex-wrap items-center gap-3">
          {/* Primary CTA stays first at all breakpoints so it is not pushed off-screen by filters. */}
          {!adminOverride && (canPropose || (hasActiveBill && myChamber)) && (
            <button
              onClick={() => setShowPropose(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Propose
            </button>
          )}
          {!canPropose && hasActiveBill && myChamber && (
            <span className="shrink-0 text-xs text-muted">
              Bill in progress — wait for it to resolve before proposing another.
            </span>
          )}
          <div className="flex min-w-0 max-w-full flex-1 rounded-lg border border-card-border text-sm overflow-x-auto">
            {[
              { key: "all", label: "All" },
              { key: "active", label: "Voting" },
              { key: "enrolled", label: "President" },
              { key: "signed", label: "Signed" },
              { key: "failed", label: "Failed" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  statusFilter === key
                    ? "bg-primary/20 text-primary"
                    : "bg-card text-muted hover:text-foreground"
                }`}
              >
                {label}
                {!loading && statusCounts[key] > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${
                      statusFilter === key ? "bg-primary/25" : "bg-muted/15"
                    }`}
                  >
                    {statusCounts[key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <BillListControls
          voteFilter={voteFilter}
          onVoteFilterChange={setVoteFilter}
          showVoteFilter={!!myChamber}
        />

        {loading ? (
          <div className="min-h-[24rem] border-y border-card-border/60">
            {Array.from({ length: 5 }).map((_, i) => (
              <ListRowSkeleton key={i} lines={3} withBadge />
            ))}
          </div>
        ) : sortedItems.length === 0 ? (
          <EmptyState
            title={
              activeTab === "senate" ? "No legislation or nominations yet" : "No legislation yet"
            }
            body={`No ${statusFilter !== "all" ? (STATUS_LABELS[statusFilter] ?? statusFilter).toLowerCase() + " " : ""}${activeTab === "senate" ? "bills or nominations" : "bills"} in the ${activeTab === "senate" ? "Senate" : "House"} yet.${canPropose ? " Be the first to propose legislation." : ""}`}
            cta={
              canPropose ? (
                <button
                  onClick={() => setShowPropose(true)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
                >
                  Propose bill
                </button>
              ) : undefined
            }
          />
        ) : (
          <BillListStack>
            {sortedItems.map((item) =>
              item.type === "bill" ? (
                <BillListItem key={`bill-${item.id}`}>
                  <BillCard bill={billMap.get(item.id)!} onVoted={() => fetchAll()} />
                </BillListItem>
              ) : (
                <BillListItem key={`nom-${item.kind}-${item.id}`}>
                  <NominationCard nom={nomMap.get(`${item.kind}:${item.id}`)!} />
                </BillListItem>
              )
            )}
          </BillListStack>
        )}
      </div>
    </>
  );
}
