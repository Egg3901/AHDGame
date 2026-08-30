"use client";

import Link from "next/link";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { BillVoteIndicator } from "./BillVoteIndicator";
import { BillProposalChip } from "./BillProposalChip";
import { KickerLabel, StatusPill, TheCountRail } from "@/components/legislature/dispatch";
import { isVotingDeadlinePassed } from "@/lib/legislature/billVotingWindow";
import { LocalTime } from "@/components/time/LocalTime";
import { useGameClock } from "@/contexts/useGameClock";

// Humanized chamber labels for the broadsheet row's dateline.
const CHAMBER_LABELS: Record<string, string> = {
  house: "House of Representatives",
  senate: "Senate",
  shugiin: "House of Representatives",
  sangiin: "House of Councillors",
  commons: "House of Commons",
  lords: "House of Lords",
  bundestag: "Bundestag",
  dail: "Dáil Éireann",
  npc: "National People's Congress",
  cabinet: "Cabinet",
  joint: "Joint Session",
};
const chamberLabel = (c: string) => CHAMBER_LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1);

interface BillCardProps {
  bill: BillDisplay;
  onVoted?: (billId: string, vote: "for" | "against" | "abstain") => void;
  /** Default `/congress/bills/{id}`. Subnational bills use region legislature URL. */
  detailHref?: string;
  timelineVariant?: "national" | "state";
  /** Raw state bill status for state timeline steps */
  stateTimelineStatus?: string;
  stateVoteUrl?: string;
  stateOverrideVoteUrl?: string;
  rawStateBillStatus?: string;
  /** Third timeline step when `timelineVariant` is state (e.g. First Minister, Governor) */
  stateExecutiveLabel?: string;
}

/**
 * Bill row in the Dispatch "Legislative Record" style: a kicker +
 * dateline, a serif headline, a two-line summary, and a "The Count" tally rail.
 * Shared across US Congress, every country legislature, and state legislatures —
 * render inside a {@link BillListItem} within a {@link BillListStack}.
 */
export function BillCard({
  bill,
  onVoted,
  detailHref,
  timelineVariant = "national",
  stateVoteUrl,
  stateOverrideVoteUrl,
  rawStateBillStatus,
}: BillCardProps) {
  const isVoting =
    bill.status === "active" ||
    bill.status === "active_other" ||
    bill.status === "active_both" ||
    bill.status === "veto_override" ||
    bill.status === "cabinet_review" ||
    bill.status === "override_shugiin";

  // Bill DB status only transitions on the hourly turn cron; between `votingEndsAt`
  // passing and the next turn, treat voting as closed so the badge matches the
  // server-side deadline. active / active_other / cabinet_review / override_shugiin
  // always expose a usable deadline on BillDisplay; state (region) bills also expose
  // the override deadline for `veto_override` (mapStateBillToBillDisplay maps
  // overrideVotingEndsAt/OnTurn onto votingEndsAt/OnTurn), so without this the card
  // keeps showing a live "Override Voting" pill for up to a turn after the override
  // deadline passes — the ticket #936 "override vote not resolving" perception.
  const deadlineCheckable =
    bill.status === "active" ||
    bill.status === "active_other" ||
    bill.status === "cabinet_review" ||
    bill.status === "override_shugiin" ||
    (timelineVariant === "state" && bill.status === "veto_override");
  const activeVotingDeadline =
    bill.status === "active_other" ? bill.otherChamberVotingEndsAt : bill.votingEndsAt;
  const activeVotingDeadlineTurn =
    bill.status === "active_other" ? bill.otherChamberVotingEndsOnTurn : bill.votingEndsOnTurn;
  const clock = useGameClock();
  // A concurrent bill leaves `active_both` only once BOTH chambers' clocks have
  // run out — the lifecycle ANDs the two deadline pairs — so the card has to
  // check the pair too, or it mutes the pill while one house is still voting.
  const concurrentDeadlinePassed =
    bill.status === "active_both" &&
    isVotingDeadlinePassed(
      bill.votingEndsAt,
      clock.realNow,
      bill.votingEndsOnTurn,
      clock.currentTurn
    ) &&
    isVotingDeadlinePassed(
      bill.otherChamberVotingEndsAt,
      clock.realNow,
      bill.otherChamberVotingEndsOnTurn,
      clock.currentTurn
    );
  const votingDeadlinePassed =
    concurrentDeadlinePassed ||
    (deadlineCheckable &&
      isVotingDeadlinePassed(
        activeVotingDeadline,
        clock.realNow,
        activeVotingDeadlineTurn,
        clock.currentTurn
      ));
  const isVotingOpen = isVoting && !votingDeadlinePassed;

  const accent =
    bill.status === "signed"
      ? "var(--success)"
      : bill.status === "failed" ||
          bill.status === "vetoed" ||
          bill.status === "override_failed" ||
          bill.status === "withdrawn" ||
          bill.status === "filibustered"
        ? "var(--error)"
        : isVotingOpen
          ? "var(--warning)"
          : votingDeadlinePassed
            ? "var(--muted)"
            : "var(--info)";

  // The Count rail uses current-chamber tally; for the active 2nd-chamber phase
  // show that chamber's tally instead. A concurrent bill has two live tallies and
  // the card has no viewer chamber to pick by, so it shows the lower house and
  // leaves the full picture to the detail page.
  const showOther = bill.status === "active_other";
  const votes = showOther
    ? {
        for: bill.otherChamberVotesFor,
        abstain: bill.otherChamberVotesAbstain,
        against: bill.otherChamberVotesAgainst,
      }
    : { for: bill.votesFor, abstain: bill.votesAbstain, against: bill.votesAgainst };
  const cast = votes.for + votes.abstain + votes.against;
  const pass = votes.for > votes.against;

  const href = detailHref ?? `/congress/bills/${bill.id}`;
  // votingDeadlinePassed shows a muted "Voting Closed" pill; the fallback branch
  // of dispatchStatusMeta renders an unknown label as a muted pill.
  const pillStatus = votingDeadlinePassed && isVoting ? "Voting Closed" : bill.status;

  const railFooter = isVotingOpen
    ? null
    : votingDeadlinePassed
      ? "Voting closed"
      : bill.status === "signed"
        ? "Measure carried"
        : bill.status === "failed" ||
            bill.status === "vetoed" ||
            bill.status === "override_failed" ||
            bill.status === "withdrawn" ||
            bill.status === "filibustered"
          ? "Measure rejected"
          : cast > 0
            ? pass
              ? "Carried in chamber"
              : "Rejected in chamber"
            : undefined;

  return (
    <div
      className="grid grid-cols-1 gap-5 p-4 sm:grid-cols-[1fr_180px] sm:gap-8 sm:p-5"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Left: dateline + headline + summary + sponsor + vote */}
      <div className="min-w-0">
        <Link href={href} className="group block">
          <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
            {bill.category && <KickerLabel>{bill.category}</KickerLabel>}
            <span className="h-[3px] w-[3px] rounded-full bg-muted" />
            <BillProposalChip adminProposed={bill.adminProposed} category={bill.category} />
            <span style={{ display: "inline-flex" }}>
              <StatusPill status={pillStatus} size="sm" />
            </span>
          </div>
          <h3
            className="font-display m-0 text-foreground transition-colors group-hover:text-primary"
            style={{ fontSize: 23, lineHeight: 1.15, fontWeight: 600, letterSpacing: "-0.005em" }}
          >
            {bill.title}
          </h3>
          <p className="mt-2 line-clamp-2 max-w-[62ch] text-sm leading-relaxed text-muted">
            {bill.summary}
          </p>
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className="text-muted">
            By{" "}
            {bill.sponsorId ? (
              <Link
                href={`/character/${bill.sponsorSequentialId ?? bill.sponsorId}`}
                className="font-semibold hover:underline underline-offset-2"
                style={{ color: bill.sponsorPartyColor || undefined }}
              >
                {bill.sponsorName}
              </Link>
            ) : (
              <span
                className="font-semibold"
                style={{ color: bill.sponsorPartyColor || undefined }}
              >
                {bill.sponsorName}
              </span>
            )}
          </span>
          <span className="text-card-border">·</span>
          <span className="italic text-muted">{chamberLabel(bill.currentChamber)}</span>
          <span className="text-card-border">·</span>
          <LocalTime
            className="text-muted/70"
            value={bill.proposedAt}
            options={{ dateStyle: "medium" }}
          />
        </div>
        <div className="mt-3">
          <BillVoteIndicator
            billId={bill.id}
            myVote={bill.myVote}
            canVote={(bill.canVoteOrigin || bill.canVoteOther) && !votingDeadlinePassed}
            onVoted={onVoted}
            omitAbstain={bill.status === "cabinet_review"}
            stateVoteUrl={stateVoteUrl}
            stateOverrideVoteUrl={stateOverrideVoteUrl}
            rawStateBillStatus={timelineVariant === "state" ? rawStateBillStatus : undefined}
            shiftPreview={bill.voteShiftPreview}
          />
        </div>
      </div>

      {/* Right: The Count rail */}
      <Link href={href} className="block">
        <TheCountRail votes={votes} eligible={cast || 1} footer={railFooter ?? undefined} />
      </Link>
    </div>
  );
}
