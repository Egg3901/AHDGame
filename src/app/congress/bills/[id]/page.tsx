"use client";

import { useState, useEffect, useCallback } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/contexts/ToastContext";
import { BillPageErrorBoundary } from "@/components/BillPageErrorBoundary";
import { BillDetailSkeleton } from "./components/BillDetailSkeleton";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { BillProvisionCard } from "@/components/legislature/BillProvisionCard";
import { BillProposalChip } from "@/components/bills/BillProposalChip";
import { nationalProvisionToView } from "@/lib/legislature/dto/provisionView";
import type { BillDetail } from "./types";
import { chamberLabel } from "./billHelpers";
import { otherChamber } from "@/lib/billLifecycleHelpers";
import { StatusBadge } from "./components/StatusBadge";
import { VoteBar } from "./components/VoteBar";
import { VoteTallyTable } from "./components/VoteTallyTable";
import { VoteListTable } from "./components/VoteListTable";
import { LocalTime } from "@/components/time/LocalTime";
import { TimelineStepper } from "./components/TimelineStepper";
import { OverrideChamberBar } from "./components/OverrideChamberBar";
import { DeadlineCountdown } from "./components/DeadlineCountdown";
import { WhippedBadge } from "@/components/bills/WhippedBadge";
import { BillWhipPanel } from "@/components/bills/BillWhipPanel";
import { BillDiscussionPanel } from "@/components/bills/BillDiscussionPanel";
import { VoteSeatingChart } from "@/components/legislature/dispatch/VoteSeatingChart";
import {
  VoteLegend,
  VoteBar as DispatchVoteBar,
} from "@/components/legislature/dispatch/primitives";
import { getLegislativeProcess } from "@/lib/legislature/process";
import { VetoMessageModal } from "@/app/country/[code]/region/[id]/office/tabs/legislation/VetoMessageModal";

// ── Main page ─────────────────────────────────────────────────────────────────

function BillDetailContent() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : undefined;
  const { showToast } = useToast();
  const preset = useActivePreset();
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [voting, setVoting] = useState(false);
  const [voteTableChamber, setVoteTableChamber] = useState<"origin" | "other">("origin");
  const [vetoModalOpen, setVetoModalOpen] = useState(false);

  const fetchBill = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/congress/bills/${id}`);
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
  }, [id]);

  useEffect(() => {
    fetchBill();
  }, [fetchBill]);

  if (!id) {
    // Params not resolved yet — show the same skeleton as the data fetch.
    return <BillDetailSkeleton />;
  }

  async function handleVote(chamberIsOther: boolean, vote: "for" | "against" | "abstain") {
    setError("");
    setMessage("");
    setVoting(true);
    try {
      trackAction("legislation.vote", { billId: id, vote, isOtherChamber: chamberIsOther });
      const res = await fetch(`/api/congress/bills/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "vote", vote, isOtherChamber: chamberIsOther }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error);
        return;
      }
      setMessage(d.message);
      showToast(d.message);
      fetchBill();
    } finally {
      setVoting(false);
    }
  }

  async function handleAction(action: string, extra?: Record<string, unknown>) {
    setError("");
    setMessage("");
    trackAction(`legislation.${action}`, { billId: id, ...extra });
    const res = await fetch(`/api/congress/bills/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await res.json();
    if (!res.ok) {
      setError(d.error);
      return;
    }
    setMessage(d.message);
    showToast(d.message);
    fetchBill();
  }

  if (loading) return <BillDetailSkeleton />;

  if (error && !bill)
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-error text-sm">{error}</p>
        <Link
          href="/congress?chamber=senate&tab=bills"
          className="text-sm text-primary hover:underline"
        >
          ← Back to Bills
        </Link>
      </div>
    );

  if (!bill) return null;

  const isActive = bill.status === "active";
  const isActiveOther = bill.status === "active_other";
  // Both chambers voting at once: the origin module and the second-chamber
  // module are BOTH live, so every gate below that means "this chamber is on
  // the floor" has to admit it. Without this the vote widgets render only once
  // a vote exists, which on a bill nobody has voted on yet is never.
  const isConcurrent = bill.status === "active_both";
  const isCabinetReview = bill.status === "cabinet_review";
  // JP Shūgiin override reuses the main votes/votingEndsAt fields, so reuse the
  // origin VoteBar — same shape as `active`, just with a 2/3 supermajority rule.
  const isJpOverride = bill.status === "override_shugiin";
  // Legacy bills may omit countryId; fall back to UK for state-scoped UK bills, otherwise US.
  const resolvedCountryId: CountryId =
    bill.countryId ?? (bill.stateId?.startsWith("uk_") ? "UK" : "US");
  const legislature = getCountryConfig(resolvedCountryId, preset).legislature;
  // Skip bicameral tally tabs and second-chamber/executive-override sections
  // when the country's legislature only runs the lower chamber for the player
  // loop (UK Commons, DE Bundestag, IE Dáil, CN NPC). Driven by the
  // legislature.bicameral config flag — see countries.ts.
  // Era-aware: TR 1953 is unicameral (no Senato).
  const isUnicameral = !legislature.bicameral;
  const backHref = legislature.path;
  const backLabel = `← Back to ${legislature.name}`;

  // Derive the "other" chamber label for bicameral display.
  // otherChamber() maps house↔senate (US) and shugiin↔sangiin (JP); unicameral
  // legislatures (UK Commons, DE Bundestag) return the same chamber, rendered
  // inert by the isUnicameral gates below.
  const otherChamberName =
    bill.originChamber === "cabinet" ? "sangiin" : otherChamber(bill.originChamber);

  const filibustered = (bill.filibusterInvocations?.length ?? 0) > 0;
  const senateIsOrigin = bill.originChamber === "senate";
  const otherRequiredPct = filibustered && !senateIsOrigin ? 60 : undefined;

  // Nationalize/privatize bills need a two-thirds supermajority in free
  // legislatures (spec 2026-06-05) — surfaced in words, not a raw percentage.
  const supermajority = bill.passRule?.rule === "twoThirds";
  const supermajorityPct = supermajority ? 67 : undefined;
  const supermajorityLabel = supermajority ? "Two-thirds supermajority to pass" : undefined;

  // Pass threshold for the chamber currently on the floor (the seating-chart
  // hero). Two-thirds (nat/priv) and the JP Shūgiin override both clear 67%;
  // an invoked filibuster lifts the Senate to 60% (3/5 cloture). Everything
  // else is a simple majority (handled by the chart's default).
  const heroRequiredPct = supermajority
    ? 67
    : isJpOverride
      ? 67
      : filibustered && bill.currentChamber === "senate"
        ? 60
        : undefined;
  // Cloture is quorum-based (3/5 of votes cast, abstains included) — the other
  // thresholds stay seat-based for display.
  const heroRequiredPctOfCast =
    !supermajority && !isJpOverride && filibustered && bill.currentChamber === "senate";

  // Dispatch seating-chart hero: live vote-colored chamber diagram for the
  // chamber currently voting, in the country's seating style (hemicycle /
  // Westminster benches / Dáil horseshoe).
  const legProcess = getLegislativeProcess(resolvedCountryId, preset);
  const chamberSeatCount = (key: string): number =>
    legislature.lowerChamber.key === key
      ? legislature.lowerChamber.seats
      : legislature.upperChamber && legislature.upperChamber.key === key
        ? legislature.upperChamber.seats
        : 0;
  const heroVotes =
    bill.currentChamber === bill.originChamber
      ? { for: bill.votesFor, abstain: bill.votesAbstain, against: bill.votesAgainst }
      : {
          for: bill.otherChamberVotesFor,
          abstain: bill.otherChamberVotesAbstain,
          against: bill.otherChamberVotesAgainst,
        };
  const heroEligible = chamberSeatCount(bill.currentChamber);
  const heroCast = heroVotes.for + heroVotes.abstain + heroVotes.against;
  const showSeatingHero =
    heroEligible > 0 && (isActive || isActiveOther || isConcurrent || isJpOverride || heroCast > 0);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {/* Back nav */}
        <Link
          href={backHref}
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          {backLabel}
        </Link>

        {/* Header */}
        <div className="rounded-xl border border-card-border bg-card shadow-panel p-6 space-y-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={bill.status} />
                {filibustered && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-error/40 bg-error/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-error">
                    ⚑ Filibustered
                  </span>
                )}
                <span className="rounded-full border border-card-border px-2 py-0.5 text-[10px] text-muted capitalize">
                  {chamberLabel(bill.originChamber)} Bill
                </span>
                <BillProposalChip adminProposed={bill.adminProposed} category={bill.category} />
                {bill.category && (
                  <span className="text-[10px] text-muted/60 capitalize">{bill.category}</span>
                )}
                {bill.provisions?.length ? (
                  <span className="text-[10px] text-cyan-400/90">
                    {bill.provisions.map((p, i) => (
                      <span key={i}>
                        {i > 0 && "; "}
                        {p.legislationTypeName}
                      </span>
                    ))}
                  </span>
                ) : bill.legislationTypeName ? (
                  <span className="text-[10px] text-cyan-400/90">{bill.legislationTypeName}</span>
                ) : null}
              </div>
              <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">
                {bill.title}
              </h1>
            </div>
          </div>

          <p className="text-sm text-muted leading-relaxed">{bill.summary}</p>

          {/* Sponsor */}
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
                <span className="font-medium">{bill.sponsorName}</span>
              )}
              {bill.sponsorPartyName && (
                <span className="ml-1" style={{ color: bill.sponsorPartyColor }}>
                  ({bill.sponsorPartyName})
                </span>
              )}
            </span>
            <span>
              Introduced <LocalTime value={bill.proposedAt} options={{ dateStyle: "medium" }} />
            </span>
          </div>

          {/* Nat/priv supermajority notice */}
          {supermajority && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              This bill transfers state ownership — it requires a{" "}
              <span className="font-semibold">two-thirds supermajority</span> of votes cast in each
              chamber to pass.
            </div>
          )}

          {/* Provisions — Proposed vs Current */}
          {bill.provisions?.length ? (
            <div className="flex flex-col gap-3 pt-2 border-t border-card-border/40">
              <h3 className="font-display text-lg font-semibold">Provisions</h3>
              {bill.provisions.map((p, i) => (
                <BillProvisionCard
                  key={i}
                  view={nationalProvisionToView(p)}
                  billCountry={resolvedCountryId}
                  index={i}
                />
              ))}
            </div>
          ) : null}

          {/* Co-sponsors */}
          {(bill.coSponsors?.length ?? 0) > 0 && (
            <div className="text-xs text-muted">
              <span className="font-medium">Co-sponsors: </span>
              {(bill.coSponsors ?? []).map((cs, i) => (
                <span key={cs.characterId}>
                  <Link
                    href={`/character/${cs.sequentialId ?? cs.characterId}`}
                    className="hover:text-primary transition-colors"
                  >
                    {cs.characterName}
                  </Link>
                  {i < (bill.coSponsors?.length ?? 0) - 1 && ", "}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            {bill.canCosponsor && (
              <button
                onClick={() => handleAction("cosponsor")}
                className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                + Co-Sponsor
              </button>
            )}
            {bill.canUncosponsor && (
              <button
                type="button"
                onClick={() => handleAction("uncosponsor")}
                className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                Remove co-sponsorship
              </button>
            )}
            {bill.canWithdraw && (
              <button
                onClick={() => handleAction("withdraw")}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Withdraw Bill
              </button>
            )}
            {bill.canFilibuster && (
              <button
                onClick={() => handleAction("filibuster")}
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
              >
                Invoke Filibuster
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
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

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            {/* Vote module — seating-chart hero + tally bar + cast vote, unified */}
            {(isCabinetReview ||
              isActive ||
              isConcurrent ||
              isJpOverride ||
              bill.votesFor + bill.votesAgainst + bill.votesAbstain > 0) && (
              <div className="space-y-4 rounded-xl border border-card-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    {chamberLabel(bill.currentChamber)} · Floor Vote
                  </h3>
                  {(isActive || isConcurrent || isJpOverride || isCabinetReview) &&
                    bill.votingEndsAt && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                        LIVE · <DeadlineCountdown deadline={bill.votingEndsAt} />
                      </span>
                    )}
                </div>
                {filibustered &&
                  bill.filibusterInvocations &&
                  bill.filibusterInvocations.length > 0 && (
                    <div className="rounded-lg border border-error/40 bg-error/10 px-4 py-3">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-base font-bold uppercase tracking-wide text-error">
                          ⚑ Filibustered
                        </span>
                        <span className="text-xs text-error/80">
                          {bill.filibusterInvocations.length}× · +
                          {bill.filibusterInvocations.length * 12}h
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        by{" "}
                        {bill.filibusterInvocations.map((inv, i) => (
                          <span key={inv.characterId}>
                            {i > 0 && <span className="text-muted">, </span>}
                            <Link
                              href={`/character/${inv.sequentialId ?? inv.characterId}`}
                              className="text-error hover:underline"
                            >
                              {inv.characterName}
                            </Link>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {showSeatingHero && (
                  <VoteSeatingChart
                    style={legProcess.seatingStyle}
                    votes={heroVotes}
                    eligible={heroEligible}
                    width={460}
                    requiredPct={heroRequiredPct}
                    requiredPctOfCast={heroRequiredPctOfCast}
                  />
                )}
                <DispatchVoteBar votes={heroVotes} eligible={heroEligible} height={10} />
                <div className="flex justify-center">
                  <VoteLegend votes={heroVotes} eligible={heroEligible} />
                </div>
                {bill.myWhippedFrom && (
                  <WhippedBadge
                    originalVote={bill.myWhippedFrom}
                    onRevert={async (v) => {
                      if (v === "unvoted") return;
                      await handleVote(false, v as "for" | "against" | "abstain");
                    }}
                  />
                )}
                {bill.canVoteOrigin && (
                  <div className="space-y-2 border-t border-card-border/60 pt-3">
                    <div className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Cast your vote
                    </div>
                    <div className="flex gap-2">
                      {(isCabinetReview
                        ? (["for", "against"] as const)
                        : (["for", "against", "abstain"] as const)
                      ).map((v) => (
                        <button
                          key={v}
                          type="button"
                          disabled={voting}
                          onClick={() => handleVote(false, v)}
                          className={`flex-1 rounded-lg border py-2.5 text-sm font-medium capitalize transition-colors disabled:opacity-50 ${
                            bill.myVote === v
                              ? v === "for"
                                ? "border-success/50 bg-success/15 text-success"
                                : v === "against"
                                  ? "border-error/50 bg-error/15 text-error"
                                  : "border-card-border bg-card-elevated text-foreground"
                              : "border-card-border bg-card text-muted hover:border-foreground/20 hover:text-foreground"
                          }`}
                        >
                          {v === "for" ? "Aye" : v === "against" ? "No" : "Abstain"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Second chamber vote */}
            {(isActiveOther ||
              isConcurrent ||
              bill.otherChamberVotesFor +
                bill.otherChamberVotesAgainst +
                bill.otherChamberVotesAbstain >
                0) && (
              <div className="space-y-2">
                {bill.myOtherChamberWhippedFrom && (
                  <WhippedBadge
                    originalVote={bill.myOtherChamberWhippedFrom}
                    onRevert={async (v) => {
                      if (v === "unvoted") return;
                      await handleVote(true, v as "for" | "against" | "abstain");
                    }}
                  />
                )}
                <VoteBar
                  label={`${chamberLabel(otherChamberName)} Vote`}
                  votesFor={bill.otherChamberVotesFor}
                  votesAgainst={bill.otherChamberVotesAgainst}
                  votesAbstain={bill.otherChamberVotesAbstain}
                  deadline={isActiveOther || isConcurrent ? bill.otherChamberVotingEndsAt : null}
                  myVote={bill.myOtherChamberVote}
                  canVote={bill.canVoteOther && !voting}
                  onVote={(v) => handleVote(true, v)}
                  requiredPct={supermajorityPct ?? otherRequiredPct}
                  requiredLabel={supermajorityLabel}
                />
              </div>
            )}

            {/* Vote by Party */}
            {((bill.voteByPartyOrigin?.length ?? 0) > 0 ||
              (bill.voteByPartyOther?.length ?? 0) > 0) && (
              <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold">Vote by Party</h3>
                  {/* Chamber sub-tabs — bicameral only */}
                  {!isUnicameral && (
                    <div className="flex rounded-lg border border-card-border overflow-hidden text-sm">
                      <button
                        type="button"
                        onClick={() => setVoteTableChamber("origin")}
                        className={`px-3 py-1.5 font-medium transition-colors ${
                          voteTableChamber === "origin"
                            ? "bg-card-border text-foreground"
                            : "bg-card text-muted hover:text-foreground"
                        }`}
                      >
                        {chamberLabel(bill.originChamber)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoteTableChamber("other")}
                        className={`px-3 py-1.5 font-medium transition-colors ${
                          voteTableChamber === "other"
                            ? "bg-card-border text-foreground"
                            : "bg-card text-muted hover:text-foreground"
                        }`}
                      >
                        {chamberLabel(otherChamberName)}
                      </button>
                    </div>
                  )}
                </div>
                {voteTableChamber === "origin" && bill.voteByPartyOrigin?.length ? (
                  <VoteTallyTable
                    voteByParty={bill.voteByPartyOrigin}
                    chamberLabel={chamberLabel(bill.originChamber)}
                  />
                ) : voteTableChamber === "other" && bill.voteByPartyOther?.length ? (
                  <VoteTallyTable
                    voteByParty={bill.voteByPartyOther}
                    chamberLabel={chamberLabel(otherChamberName)}
                  />
                ) : (
                  <p className="text-xs text-muted py-2">No votes recorded for this chamber yet.</p>
                )}
              </div>
            )}

            {/* Discussions */}
            {id && (
              <BillDiscussionPanel
                apiBase={`/api/congress/bills/${id}`}
                chamberLabel={legislature.name}
              />
            )}

            {/* Member Vote History — searchable, filterable by party / Aye-No-Abstain */}
            {id &&
              ((bill.voteByPartyOrigin?.length ?? 0) > 0 ||
                (bill.voteByPartyOther?.length ?? 0) > 0) && (
                <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
                  <h3 className="font-display text-lg font-semibold">Member Vote History</h3>
                  <VoteListTable
                    billId={id}
                    chamber={voteTableChamber}
                    showSeats={bill.originChamber !== "senate" || isUnicameral}
                  />
                </div>
              )}

            {/* Presidential action — US only */}
            {!isUnicameral && bill.status === "enrolled" && (
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-purple-300">
                      Awaiting Presidential Action
                    </h3>
                    <p className="text-xs text-muted mt-1">
                      The President has until the deadline to sign or veto. If no action is taken,
                      the bill becomes law (pocket signature).
                    </p>
                  </div>
                  {bill.presidentActionDeadline && (
                    <DeadlineCountdown deadline={bill.presidentActionDeadline} />
                  )}
                </div>
                {bill.canPresidentialAction && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction("presidential_action", { decision: "sign" })}
                      className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      ✓ Sign Into Law
                    </button>
                    <button
                      onClick={() => setVetoModalOpen(true)}
                      className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      ✗ Veto…
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Full text */}
            {bill.fullText && (
              <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
                <h3 className="font-display text-lg font-semibold">Full Text</h3>
                <pre className="text-xs text-muted whitespace-pre-wrap leading-relaxed font-sans">
                  {bill.fullText}
                </pre>
              </div>
            )}

            {/* Veto message — visible whenever the President has vetoed (during
                override voting or after the veto has been sustained/overridden). */}
            {bill.vetoMessage && bill.presidentAction === "vetoed" && (
              <div className="rounded-xl border border-error/40 bg-error/5 p-4">
                <h3 className="text-[10px] uppercase tracking-widest text-error font-semibold">
                  Veto message
                </h3>
                <p className="mt-1 text-sm italic">&ldquo;{bill.vetoMessage}&rdquo;</p>
                <p className="mt-2 text-xs text-muted">— The President</p>
              </div>
            )}

            {/* Veto Override Voting Panel — US only */}
            {!isUnicameral && bill.status === "veto_override" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-amber-300">
                      Congressional Veto Override
                    </h3>
                    <p className="text-xs text-muted mt-1">
                      A 2/3 supermajority in{" "}
                      <strong className="text-foreground">both chambers</strong> is required to
                      override the presidential veto.
                    </p>
                  </div>
                  {bill.overrideVotingEndsAt && (
                    <DeadlineCountdown deadline={bill.overrideVotingEndsAt} />
                  )}
                </div>

                {/* Per-chamber seat-weighted tallies vs the 2/3-of-seats threshold. */}
                <div className="space-y-3">
                  <OverrideChamberBar
                    label="House"
                    votesFor={bill.overrideHouseFor ?? 0}
                    total={bill.overrideHouseSeats ?? 0}
                  />
                  <OverrideChamberBar
                    label="Senate"
                    votesFor={bill.overrideSenateFor ?? 0}
                    total={bill.overrideSenateSeats ?? 0}
                  />
                </div>

                {/* Vote buttons */}
                {bill.canVetoOverride && (
                  <div className="space-y-2">
                    {bill.myOverrideVote && (
                      <p className="text-xs text-muted">
                        Your vote:{" "}
                        <span className="font-medium text-foreground capitalize">
                          {bill.myOverrideVote === "for" ? "Override" : "Sustain Veto"}
                        </span>{" "}
                        — you may change it.
                      </p>
                    )}
                    {bill.myOverrideWhippedFrom && (
                      <WhippedBadge
                        originalVote={bill.myOverrideWhippedFrom}
                        onRevert={async (v) => {
                          if (v === "unvoted") return;
                          await handleAction("veto_override_vote", { vote: v });
                        }}
                      />
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction("veto_override_vote", { vote: "for" })}
                        disabled={voting}
                        className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                          bill.myOverrideVote === "for"
                            ? "border-amber-500/60 bg-amber-500/25 text-amber-300"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                        }`}
                      >
                        ↑ Vote to Override
                      </button>
                      <button
                        onClick={() => handleAction("veto_override_vote", { vote: "against" })}
                        disabled={voting}
                        className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                          bill.myOverrideVote === "against"
                            ? "border-card-border/60 bg-card text-foreground"
                            : "border-card-border bg-card/50 text-muted hover:text-foreground hover:bg-card"
                        }`}
                      >
                        ↓ Sustain Veto
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Override failed panel — US only */}
            {!isUnicameral && bill.status === "override_failed" && (
              <div className="rounded-xl border border-error/30 bg-error/5 p-5 space-y-3">
                <h3 className="font-display text-base font-semibold text-error">Veto Sustained</h3>
                <p className="text-xs text-muted">
                  The override attempt failed to reach a 2/3 supermajority of the seats in both
                  chambers. The presidential veto stands.
                </p>
                {bill.overrideHouseSeats != null && (
                  <div className="space-y-3">
                    <OverrideChamberBar
                      label="House"
                      votesFor={bill.overrideHouseFor ?? 0}
                      total={bill.overrideHouseSeats}
                    />
                    <OverrideChamberBar
                      label="Senate"
                      votesFor={bill.overrideSenateFor ?? 0}
                      total={bill.overrideSenateSeats ?? 0}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Veto overridden panel — US only */}
            {!isUnicameral && bill.status === "signed" && bill.presidentAction === "override" && (
              <div className="rounded-xl border border-success/30 bg-success/5 p-5 space-y-3">
                <h3 className="font-display text-base font-semibold text-success">
                  Veto Overridden
                </h3>
                <p className="text-xs text-muted">
                  Congress overrode the presidential veto with a 2/3 supermajority of the seats in
                  both chambers. The bill is now law.
                </p>
                {bill.overrideHouseSeats != null && (
                  <div className="space-y-3">
                    <OverrideChamberBar
                      label="House"
                      votesFor={bill.overrideHouseFor ?? 0}
                      total={bill.overrideHouseSeats}
                    />
                    <OverrideChamberBar
                      label="Senate"
                      votesFor={bill.overrideSenateFor ?? 0}
                      total={bill.overrideSenateSeats ?? 0}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Progress timeline */}
            <TimelineStepper bill={bill} />

            {/* How it becomes law — country-specific procedure */}
            {legProcess.quirks.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
                <h3 className="font-display text-lg font-semibold">How it becomes law</h3>
                <div className="space-y-3">
                  {legProcess.quirks.map((q, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      <div>
                        <div className="text-sm font-medium text-foreground">{q.title}</div>
                        <div className="text-xs leading-relaxed text-muted">{q.body}</div>
                      </div>
                    </div>
                  ))}
                  {legProcess.dissolution && (
                    <div className="flex gap-2 border-t border-card-border/40 pt-3 text-xs leading-relaxed text-foreground/80">
                      <span className="font-semibold text-warning">
                        {legProcess.dissolution.actor}:
                      </span>
                      <span>{legProcess.dissolution.body}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Whip Count — every seated party, free vote when unwhipped */}
            {bill.whipCounts && bill.whipCounts.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
                <h3 className="font-display text-lg font-semibold">Whip Count</h3>
                <div className="space-y-2">
                  {bill.whipCounts.map((w) => (
                    <div key={w.partyId} className="flex items-center gap-2 text-sm">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: w.partyColor }}
                      />
                      <span className="flex-1 truncate font-medium text-foreground">
                        {w.partyName}
                      </span>
                      <span
                        className={`text-xs font-medium ${w.direction === "for" ? "text-success" : w.direction === "against" ? "text-error" : "text-muted"}`}
                      >
                        {w.direction === "for"
                          ? "Whipping Aye"
                          : w.direction === "against"
                            ? "Whipping No"
                            : "Free vote"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Issue party whip — party leadership only */}
            <BillWhipPanel
              billId={bill.id}
              countryId={resolvedCountryId}
              status={bill.status}
              whipPanel={bill.whipPanel}
              onWhipIssued={fetchBill}
            />
          </div>
        </div>
      </main>

      <VetoMessageModal
        open={vetoModalOpen}
        billTitle={bill.title}
        endpointUrl={`/api/congress/bills/${id}`}
        basePayload={{ action: "presidential_action", decision: "veto" }}
        onClose={() => setVetoModalOpen(false)}
        onSuccess={() => {
          setVetoModalOpen(false);
          void fetchBill();
        }}
      />
    </div>
  );
}

export default function BillDetailPage() {
  return (
    <BillPageErrorBoundary>
      <BillDetailContent />
    </BillPageErrorBoundary>
  );
}
