"use client";

import { useMemo, useState } from "react";
import type { BillChamber } from "@/lib/db/types/legislation";
import { mapStateBillToBillDisplay } from "@/lib/legislature/mapStateBillToBillDisplay";
import { useGameClock } from "@/contexts/useGameClock";
import { BillCard } from "@/components/bills/BillCard";
import { BillListItem, BillListStack } from "@/components/bills/BillListItem";
import { BillListControls, type BillVoteFilter } from "@/components/bills/BillListControls";
import { EmptyState } from "@/app/congress/components/CongressShared";
import { regionApiSubUrl, regionStateBillUrl } from "@/lib/urls";
import { getRegionalBillAssentTitleForState, type CountryId } from "@/lib/constants/countries";
import type { StateBillDisplay } from "@/lib/legislature/dto/stateLegislature";
import { BillEffectsSection } from "./BillEffectsSection";
import { ProposeStateBillModal } from "./ProposeStateBillModal";

export function BillsTab({
  bills,
  canPropose,
  canVote,
  stateId,
  countryId,
  blockedProvisions,
  onRefresh,
  totalSeats: _totalSeats,
  adminOverride = false,
  billChamber,
}: {
  bills: StateBillDisplay[];
  canPropose: boolean;
  canVote: boolean;
  stateId: string;
  countryId: string;
  blockedProvisions?: { legislationTypeId: string; policyOptionId: string }[];
  onRefresh: () => void;
  totalSeats: number;
  adminOverride?: boolean;
  billChamber: BillChamber;
}) {
  void _totalSeats;
  const regionalAssentTitle = getRegionalBillAssentTitleForState(countryId as CountryId, stateId);
  const clock = useGameClock();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showPropose, setShowPropose] = useState(false);
  const [voteFilter, setVoteFilter] = useState<BillVoteFilter>("all");

  const statusFiltered = useMemo(() => {
    if (statusFilter === "all") return bills;
    if (statusFilter === "active") {
      return bills.filter((b) => b.status === "active" || b.status === "veto_override");
    }
    if (statusFilter === "enrolled") {
      return bills.filter((b) => b.status === "passed");
    }
    if (statusFilter === "signed") {
      return bills.filter((b) => b.status === "signed" || b.status === "enacted");
    }
    if (statusFilter === "failed") {
      return bills.filter(
        (b) => b.status === "failed" || b.status === "override_failed" || b.status === "vetoed"
      );
    }
    return bills;
  }, [bills, statusFilter]);

  const filteredBills = useMemo(() => {
    let list = statusFiltered;
    if (voteFilter === "voted") {
      list = list.filter((b) => b.myVote != null);
    } else if (voteFilter === "not_voted") {
      list = list.filter((b) => b.myVote == null);
    }
    return [...list].sort(
      (a, b) => new Date(b.proposedAt).getTime() - new Date(a.proposedAt).getTime()
    );
  }, [statusFiltered, voteFilter]);

  const billDetailHref = (billId: string) => regionStateBillUrl(countryId, stateId, billId);

  const filterHint =
    statusFilter === "active"
      ? "voting "
      : statusFilter === "enrolled"
        ? `awaiting ${regionalAssentTitle.toLowerCase()} `
        : statusFilter === "signed"
          ? "signed "
          : statusFilter === "failed"
            ? "failed "
            : "";

  return (
    <>
      {showPropose && (
        <ProposeStateBillModal
          stateId={stateId}
          countryId={countryId}
          adminOverride={adminOverride && !canPropose}
          blockedProvisions={blockedProvisions}
          onClose={() => setShowPropose(false)}
          onSuccess={() => {
            setShowPropose(false);
            onRefresh();
          }}
        />
      )}

      <div className="space-y-4">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3">
          {(canPropose || adminOverride) && (
            <button
              onClick={() => setShowPropose(true)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                adminOverride && !canPropose
                  ? "bg-error text-white hover:bg-error/90"
                  : "bg-primary text-white hover:bg-primary/90"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {adminOverride && !canPropose ? "Propose (Admin override)" : "Propose"}
            </button>
          )}
          <div className="flex min-w-0 max-w-full flex-1 rounded-lg border border-card-border text-sm overflow-x-auto">
            {[
              { key: "all", label: "All" },
              { key: "active", label: "Voting" },
              { key: "enrolled", label: regionalAssentTitle },
              { key: "signed", label: "Signed" },
              { key: "failed", label: "Failed" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`shrink-0 px-3 py-1.5 font-medium transition-colors ${
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
            {filteredBills.length} bill{filteredBills.length !== 1 ? "s" : ""}
          </span>
        </div>

        <BillListControls
          voteFilter={voteFilter}
          onVoteFilterChange={setVoteFilter}
          showVoteFilter={canVote}
        />

        {filteredBills.length === 0 ? (
          <EmptyState
            title="No legislation yet"
            body={`No ${filterHint}bills in this legislature yet.${canPropose || adminOverride ? " Be the first to propose legislation." : ""}`}
            cta={
              canPropose || adminOverride ? (
                <button
                  onClick={() => setShowPropose(true)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
                >
                  {adminOverride && !canPropose
                    ? "Propose a Bill (Admin override)"
                    : "Propose a Bill"}
                </button>
              ) : undefined
            }
          />
        ) : (
          <BillListStack>
            {filteredBills.map((raw) => {
              const bill = mapStateBillToBillDisplay(raw, {
                chamber: billChamber,
                canVote,
                currentTurn: clock.currentTurn,
              });
              const stateVoteUrl = `${regionApiSubUrl(countryId, stateId, "legislature/bills")}/${raw.id}/vote`;
              const stateOverrideVoteUrl = `${regionApiSubUrl(countryId, stateId, "legislature/bills")}/${raw.id}/override-vote`;
              return (
                <BillListItem key={raw.id}>
                  {raw.hasVetoMessage && (
                    <span
                      className="absolute right-3 top-4 z-10 text-base sm:top-5"
                      title="Veto message attached — click into the bill to read it"
                      aria-label="Veto message"
                    >
                      💬
                    </span>
                  )}
                  <BillCard
                    bill={bill}
                    detailHref={billDetailHref(raw.id)}
                    timelineVariant="state"
                    stateTimelineStatus={raw.status}
                    stateVoteUrl={stateVoteUrl}
                    stateOverrideVoteUrl={stateOverrideVoteUrl}
                    rawStateBillStatus={raw.status}
                    stateExecutiveLabel={regionalAssentTitle}
                    onVoted={() => onRefresh()}
                  />
                  {raw.provisions && raw.provisions.length > 0 && (
                    <div className="px-4 pb-4 sm:px-5">
                      <BillEffectsSection provisions={raw.provisions} />
                    </div>
                  )}
                </BillListItem>
              );
            })}
          </BillListStack>
        )}
      </div>
    </>
  );
}
