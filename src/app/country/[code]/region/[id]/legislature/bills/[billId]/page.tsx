"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/contexts/ToastContext";
import { BillPageErrorBoundary } from "@/components/BillPageErrorBoundary";
import { BillTimeline } from "@/components/bills/BillTimeline";
import { BillDiscussionPanel } from "@/components/bills/BillDiscussionPanel";
import { VoteBar } from "@/app/congress/bills/[id]/components/VoteBar";
import { VoteTallyTable } from "@/app/congress/bills/[id]/components/VoteTallyTable";
import {
  getCountryConfig,
  getRegionalBillAssentTitleForState,
  type CountryId,
} from "@/lib/constants/countries";
import { getStateBillStatusDisplayLabel } from "@/lib/legislature/stateBillUiLabels";
import { regionApiSubUrl, regionLegislatureUrl } from "@/lib/urls";
import { BillEffectsSection } from "../../components/BillEffectsSection";
import { BillProvisionCard } from "@/components/legislature/BillProvisionCard";
import { stateProvisionToView } from "@/lib/legislature/dto/provisionView";
import type { StateBillDetail } from "@/lib/legislature/dto/stateBillDetail";
import { mapStateStatusToBillStatus } from "@/lib/legislature/mapStateBillToBillDisplay";
import { useGameClock } from "@/contexts/useGameClock";
import { canonicalRegionId } from "@/lib/constants/countries";
import { isVotingDeadlinePassed } from "@/lib/legislature/billVotingWindow";
import { VetoMessageModal } from "@/app/country/[code]/region/[id]/office/tabs/legislation/VetoMessageModal";
import { VoteSeatingChart } from "@/components/legislature/dispatch/VoteSeatingChart";
import { CardSkeleton, Skeleton } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";

function StateBillDetailContent() {
  const params = useParams<{ code: string; id: string; billId: string }>();
  const code = typeof params?.code === "string" ? params.code : "";
  const rawRegionParam = typeof params?.id === "string" ? params.id : "";
  const stateId = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const billId = typeof params?.billId === "string" ? params.billId : "";
  const { showToast } = useToast();
  const [bill, setBill] = useState<StateBillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [voting, setVoting] = useState(false);
  const [vetoModalOpen, setVetoModalOpen] = useState(false);
  const clock = useGameClock();

  const apiBase = regionApiSubUrl(code, stateId, "legislature/bills");
  const backHref = regionLegislatureUrl(code, stateId);

  const fetchBill = useCallback(async () => {
    if (!billId || !code || !stateId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/${billId}`, { cache: "no-store" });
      if (!res.ok) {
        setError("Bill not found.");
        return;
      }
      setBill(await res.json());
    } catch {
      setError("Failed to load bill.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, billId, code, stateId]);

  useEffect(() => {
    void fetchBill();
  }, [fetchBill]);

  async function postJson(url: string, body: Record<string, unknown>, okMessage: string) {
    setError("");
    setMessage("");
    setVoting(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(d.error ?? "Action failed");
        return;
      }
      const msg = d.message ?? okMessage;
      setMessage(msg);
      showToast(msg);
      void fetchBill();
    } finally {
      setVoting(false);
    }
  }

  async function handleChamberVote(vote: "for" | "against" | "abstain") {
    await postJson(`${apiBase}/${billId}/vote`, { vote }, "Vote recorded");
  }

  async function handleOverrideVote(vote: "for" | "against") {
    await postJson(`${apiBase}/${billId}/override-vote`, { vote }, "Override vote recorded");
  }

  async function handleGovernorAction(action: "signed" | "vetoed") {
    // Vetoes go through the modal to collect the required public message.
    if (action === "vetoed") {
      setVetoModalOpen(true);
      return;
    }
    await postJson(`${apiBase}/${billId}/governor-action`, { action }, "Bill signed into law");
  }

  // Mirrors the loaded layout: back link, header card (badges + title +
  // summary + sponsor meta), then body cards. Covers params-resolving and
  // data-fetch states alike.
  if (!billId || loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
          <Skeleton className="h-4 w-40" />
          <CardSkeleton className="space-y-4 shadow-panel p-6">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-9 w-3/4" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
            <div className="pt-1 border-t border-card-border/40">
              <Skeleton className="h-3 w-56 mt-2" />
            </div>
          </CardSkeleton>
          <CardSkeleton className="space-y-3 p-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardSkeleton>
        </main>
      </div>
    );
  }

  if (error && !bill) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-error text-sm">{error}</p>
        <Link href={backHref} className="text-sm text-primary hover:underline">
          ← Back to Legislature
        </Link>
      </div>
    );
  }

  if (!bill) return null;

  const isOriginStage = bill.status === "active";
  const isOverrideStage = bill.status === "veto_override";
  // DB status only transitions on the hourly turn; between the deadline passing and the next
  // turn running, we treat voting as closed to keep the UI consistent with the server-side
  // deadline rejection in /vote.
  const originVotingClosed =
    isOriginStage &&
    isVotingDeadlinePassed(
      bill.votingEndsAt,
      clock.realNow,
      bill.votingEndsOnTurn,
      clock.currentTurn
    );
  const overrideVotingClosed =
    isOverrideStage &&
    isVotingDeadlinePassed(
      bill.overrideVotingEndsAt,
      clock.realNow,
      bill.overrideVotingEndsOnTurn,
      clock.currentTurn
    );
  const canCastOriginVote = isOriginStage && !originVotingClosed;
  const canCastOverrideVote = isOverrideStage && !overrideVotingClosed;
  const votingClosedPendingResolution = originVotingClosed || overrideVotingClosed;
  const hasChamberTally =
    bill.votesFor + bill.votesAgainst + bill.votesAbstain > 0 || isOriginStage || isOverrideStage;
  const timelineStatus = mapStateStatusToBillStatus(bill.status);
  const statusLabel = votingClosedPendingResolution
    ? "Voting Closed"
    : getStateBillStatusDisplayLabel(bill.status, bill.countryId as CountryId, bill.stateId);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        <Link
          href={backHref}
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back to Legislature
        </Link>

        <div className="rounded-xl border border-card-border bg-card shadow-panel p-6 space-y-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-card-border px-2 py-0.5 text-[10px] font-medium text-muted">
                  {statusLabel}
                </span>
                {bill.adminProposed && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    Admin Proposed
                  </span>
                )}
                {bill.legislationTypeName && (
                  <span className="text-[10px] text-cyan-400/90">{bill.legislationTypeName}</span>
                )}
              </div>
              <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">
                {bill.title}
              </h1>
            </div>
          </div>

          <p className="text-sm text-muted leading-relaxed">{bill.summary}</p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted pt-1 border-t border-card-border/40">
            <span>
              Sponsored by{" "}
              {bill.sponsorId ? (
                <Link
                  href={`/character/${bill.sponsorSequentialId ?? bill.sponsorId}`}
                  className="font-medium hover:text-primary transition-colors"
                  style={{ color: bill.sponsorPartyColor }}
                >
                  {bill.sponsorName}
                </Link>
              ) : (
                <span className="font-medium" style={{ color: bill.sponsorPartyColor }}>
                  {bill.sponsorName}
                </span>
              )}
              {bill.sponsorParty && (
                <span className="ml-1" style={{ color: bill.sponsorPartyColor }}>
                  ({bill.sponsorParty})
                </span>
              )}
            </span>
            <span>
              Introduced <LocalTime value={bill.proposedAt} options={{ dateStyle: "medium" }} />
            </span>
          </div>

          {bill.provisions?.length > 0 && (
            <div className="flex flex-col gap-3 pt-2 border-t border-card-border/40">
              <h3 className="font-display text-lg font-semibold">Provisions</h3>
              {bill.provisions.map((p, i) => (
                <BillProvisionCard
                  key={i}
                  view={stateProvisionToView(p)}
                  billCountry={bill.countryId}
                  index={i}
                />
              ))}
              <BillEffectsSection provisions={bill.provisions} />
            </div>
          )}

          {bill.canGovernorAction && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-card-border/40">
              <button
                type="button"
                disabled={voting}
                onClick={() => handleGovernorAction("signed")}
                className="rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20"
              >
                Sign into law
              </button>
              <button
                type="button"
                disabled={voting}
                onClick={() => handleGovernorAction("vetoed")}
                className="rounded-lg border border-error/30 bg-error/10 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/20"
              >
                Veto…
              </button>
            </div>
          )}

          {bill.vetoMessage && (
            <div className="mt-2 rounded-xl border border-error/40 bg-error/5 p-4">
              <h3 className="text-[10px] uppercase tracking-widest text-error font-semibold">
                Veto message
              </h3>
              <p className="mt-1 text-sm italic">&ldquo;{bill.vetoMessage}&rdquo;</p>
              <p className="mt-2 text-xs text-muted">
                — {getRegionalBillAssentTitleForState(bill.countryId as CountryId, bill.stateId)}
                &apos;s office
              </p>
            </div>
          )}
        </div>

        <VetoMessageModal
          open={vetoModalOpen}
          billTitle={bill.title}
          endpointUrl={`${apiBase}/${billId}/governor-action`}
          onClose={() => setVetoModalOpen(false)}
          onSuccess={() => {
            setVetoModalOpen(false);
            void fetchBill();
            showToast("Bill vetoed");
          }}
        />

        {message && (
          <div className="rounded-lg bg-success/10 border border-success/30 px-4 py-3 text-sm text-success">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-error/10 border border-error/30 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-muted">Progress</h3>
          <BillTimeline
            status={timelineStatus}
            originChamber="state"
            proposedAt={bill.proposedAt}
            votingEndsAt={
              isOriginStage
                ? (bill.votingEndsAt ?? null)
                : isOverrideStage
                  ? (bill.overrideVotingEndsAt ?? null)
                  : null
            }
            variant="state"
            stateStatus={bill.status}
            stateExecutiveLabel={getRegionalBillAssentTitleForState(
              bill.countryId as CountryId,
              bill.stateId
            )}
          />
        </div>

        {hasChamberTally && bill.eligibleSeats > 0 && (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Chamber · Floor Vote
            </h3>
            <VoteSeatingChart
              style="hemicycle"
              votes={{
                for: bill.votesFor,
                abstain: bill.votesAbstain,
                against: bill.votesAgainst,
              }}
              eligible={bill.eligibleSeats}
              width={460}
            />
          </div>
        )}

        {hasChamberTally && (
          <VoteBar
            label={isOverrideStage ? "Chamber vote (closed)" : "Chamber vote"}
            votesFor={bill.votesFor}
            votesAgainst={bill.votesAgainst}
            votesAbstain={bill.votesAbstain}
            deadline={isOriginStage && !isOverrideStage ? (bill.votingEndsAt ?? null) : null}
            myVote={bill.myVote}
            canVote={bill.canVote && !voting && canCastOriginVote}
            onVote={canCastOriginVote ? (v) => void handleChamberVote(v) : undefined}
          />
        )}

        {isOverrideStage && (
          <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold">Veto override</h3>
            <VoteBar
              label="Override vote (2/3 required)"
              votesFor={bill.overrideVotesFor}
              votesAgainst={bill.overrideVotesAgainst}
              votesAbstain={0}
              requiredLabel={
                bill.eligibleSeats > 0
                  ? `${bill.overrideVotesFor} / ${Math.ceil((bill.eligibleSeats * 2) / 3)} needed (2/3)`
                  : undefined
              }
              deadline={bill.overrideVotingEndsAt ?? null}
              myVote={
                bill.myOverrideVote === "for"
                  ? "for"
                  : bill.myOverrideVote === "against"
                    ? "against"
                    : null
              }
              canVote={bill.canVote && !voting && canCastOverrideVote}
              omitAbstain
              onVote={
                canCastOverrideVote
                  ? (v) => {
                      if (v === "for" || v === "against") void handleOverrideVote(v);
                    }
                  : undefined
              }
            />
          </div>
        )}

        {bill.voteByParty.length > 0 && (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3">Vote tally by party</h3>
            <VoteTallyTable voteByParty={bill.voteByParty} chamberLabel="Chamber" />
          </div>
        )}

        {bill.voteByPartyOverride.length > 0 && (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3">Override vote tally by party</h3>
            <VoteTallyTable voteByParty={bill.voteByPartyOverride} chamberLabel="Override" />
          </div>
        )}

        {/* Discussions */}
        <BillDiscussionPanel
          apiBase={`${apiBase}/${billId}`}
          chamberLabel={
            getCountryConfig(bill.countryId as CountryId).subNationalChamber?.name ?? "legislature"
          }
        />
      </main>
    </div>
  );
}

export default function StateBillDetailPage() {
  return (
    <BillPageErrorBoundary>
      <StateBillDetailContent />
    </BillPageErrorBoundary>
  );
}
