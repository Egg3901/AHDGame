"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
import { VoteDonut } from "@/components/bills/VoteDonut";
import {
  getCurrentCongressBillVote,
  matchesCongressBillStatusFilter,
} from "@/lib/congress/congressBillFilters";

interface NominationDisplay {
  id: string;
  positionName: string;
  nomineeCharacterName: string;
  nomineeParty?: string;
  proposedByPresidentName?: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  proposedAt?: string;
  myVote: "for" | "against" | "abstain" | null;
  isSenator: boolean;
}

function NominationCard({ nom }: { nom: NominationDisplay }) {
  return (
    <Link
      href={`/congress/nominations/${nom.id}`}
      className="group flex flex-col rounded-2xl border border-card-border bg-card shadow-lg overflow-hidden hover:border-primary/30 hover:shadow-panel hover:-translate-y-0.5 transition-all duration-200 border-l-4 border-l-warning/60"
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start gap-2 flex-wrap mb-1">
          <span className="font-bold text-sm leading-snug flex-1 min-w-0 group-hover:text-primary transition-colors">
            {nom.nomineeCharacterName} → {nom.positionName}
          </span>
          <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-400 shrink-0">
            Voting Open
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-card-border px-2 py-0.5 text-[10px] text-muted">
            senate
          </span>
          {nom.nomineeParty && (
            <span className="text-[10px] text-muted/60">{nom.nomineeParty}</span>
          )}
          {nom.myVote && (
            <span
              className={`text-[10px] font-medium ${nom.myVote === "for" ? "text-success" : nom.myVote === "against" ? "text-error" : "text-muted"}`}
            >
              Your vote: {nom.myVote}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-3 border-t border-card-border/40 flex gap-4 flex-1">
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-xs text-muted leading-relaxed">
            Cabinet nomination · Senate confirmation required
          </p>
          <p className="text-[10px] text-muted/70">
            By {nom.proposedByPresidentName ?? "President"}
            {nom.proposedAt && ` · ${new Date(nom.proposedAt).toLocaleDateString("en-US")}`}
          </p>
        </div>
        <div className="shrink-0">
          <VoteDonut
            votesFor={nom.votesFor}
            votesAgainst={nom.votesAgainst}
            votesAbstain={nom.votesAbstain}
            size={48}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-card-border/40">
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span>{nom.proposedAt ? new Date(nom.proposedAt).toLocaleDateString("en-US") : ""}</span>
          {nom.votingEndsAt && (
            <span className="text-yellow-400">
              Closes {new Date(nom.votingEndsAt).toLocaleString("en-US")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

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
        const [billsRes, nomRes] = await Promise.all([
          fetch(`/api/congress/bills?${params}`, { cache: "no-store", signal }),
          activeTab === "senate"
            ? fetch("/api/congress/cabinet-nominations", { cache: "no-store", signal })
            : null,
        ]);
        if (billsRes.ok) {
          const data: BillsResponse = await billsRes.json();
          setBills(data.bills);
          setBlockedProvisions(data.blockedProvisions ?? []);
          setProposalWarnings(data.proposalWarnings ?? {});
        }
        if (activeTab === "senate" && nomRes?.ok) {
          const data = await nomRes.json();
          setNominations(data.nominations ?? []);
        } else if (activeTab !== "senate") {
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
    { type: "bill"; id: string; date: string } | { type: "nomination"; id: string; date: string };
  const sortedItems: ListItem[] = [
    ...voteFiltered.map((b) => ({ type: "bill" as const, id: b.id, date: b.proposedAt })),
    ...filteredNominations.map((n) => ({
      type: "nomination" as const,
      id: n.id,
      date: n.proposedAt ?? "",
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const billMap = new Map(voteFiltered.map((b) => [b.id, b]));
  const nomMap = new Map(filteredNominations.map((n) => [n.id, n]));

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
        {canPropose && adminOverride && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {`Admin — propose a ${activeTab === "senate" ? "Senate" : "House"} bill`}
              </p>
              <p className="text-xs text-muted">
                Opens to a vote in the currently selected chamber immediately.
              </p>
            </div>
            <button
              onClick={() => setShowPropose(true)}
              className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              Propose Bill
            </button>
          </div>
        )}

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
                className={`px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  statusFilter === key
                    ? "bg-primary/20 text-primary"
                    : "bg-card text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="shrink-0 text-xs text-muted sm:ml-auto">
            {sortedItems.length} item{sortedItems.length !== 1 ? "s" : ""}
            {activeTab === "senate" && filteredNominations.length > 0 && (
              <span className="text-muted/80">
                {" "}
                ({voteFiltered.length} bill{voteFiltered.length !== 1 ? "s" : ""},{" "}
                {filteredNominations.length} nomination{filteredNominations.length !== 1 ? "s" : ""}
                )
              </span>
            )}
          </span>
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
            body={`No ${statusFilter !== "all" ? (STATUS_LABELS[statusFilter] ?? statusFilter).toLowerCase() + " " : ""}${activeTab === "senate" ? "bills or cabinet nominations" : "bills"} in the ${activeTab === "senate" ? "Senate" : "House"} yet.${canPropose ? " Be the first to propose legislation." : ""}`}
            cta={
              canPropose ? (
                <button
                  onClick={() => setShowPropose(true)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
                >
                  Propose Bill
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
                <BillListItem key={`nom-${item.id}`}>
                  <div className="p-4 sm:p-5">
                    <NominationCard nom={nomMap.get(item.id)!} />
                  </div>
                </BillListItem>
              )
            )}
          </BillListStack>
        )}
      </div>
    </>
  );
}
