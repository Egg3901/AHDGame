"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyChip, formatPartyState } from "./CongressShared";
import { ElectionDropdown, type CandidacyLike } from "./LeadershipShared";
import { WhippedBadge } from "@/components/bills/WhippedBadge";
import type { CountryId } from "@/lib/constants/countries";

type LeaderDisplay = {
  characterId: string | null;
  /** Sequential ID for stable URLs (prefer this over characterId) */
  sequentialId?: number | null;
  characterName: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  party: string;
  partyName: string;
  partyColor: string;
  state?: string;
};

type ElectionState = {
  current: LeaderDisplay | null;
  candidacies: CandidacyLike[];
  election: { status: "voting" | "closed" | "cancelled" | "none" };
  partyLabel: string;
  partySeats: number;
  isInParty: boolean;
  hasActiveCandidacy: boolean;
  myVoteId: string | null;
  myWhippedFromVoteId?: string | null;
  myWhippedFromOriginal?: string | null;
};

type HouseOrSenateMember = boolean;

export function HouseLeadershipRoleSection({
  title,
  electionState,
  isMember,
  leadersAdmin,
  countryId,
  onStartElection,
  onForceEnd,
  onReset,
  onVote,
  onWithdraw,
  onDeclare,
}: {
  title: string;
  electionState: ElectionState | null | undefined;
  isMember: HouseOrSenateMember;
  leadersAdmin: boolean;
  countryId: CountryId;
  onStartElection: () => void;
  onForceEnd: () => void;
  onReset: () => void;
  onVote: (id: string) => void;
  onWithdraw: () => void;
  onDeclare: () => void;
}) {
  if (!electionState) return null;

  const { current, election, candidacies, partySeats, isInParty, hasActiveCandidacy, myVoteId } =
    electionState;
  const isVoting = election?.status === "voting";
  const canVote = isInParty && isMember;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {current ? (
        <div className="flex items-center gap-4 rounded-xl border border-card-border bg-card p-4">
          <Avatar
            url={current.avatarUrl}
            name={current.characterName}
            size="h-10 w-10"
            borderKey={current.borderKey}
            tintColor={current.tintColor}
          />
          <div className="flex-1 min-w-0">
            {current.characterId ? (
              <Link
                href={`/character/${current.sequentialId ?? current.characterId}`}
                className="font-semibold hover:text-primary"
              >
                {current.characterName}
                <span className="text-muted font-normal ml-1">
                  {formatPartyState(current.party, current.state, current.partyName)}
                </span>
              </Link>
            ) : (
              <span className="font-semibold">
                {current.characterName}
                <span className="text-muted font-normal ml-1">
                  {formatPartyState(current.party, current.state, current.partyName)}
                </span>
              </span>
            )}
            <p className="text-xs text-muted">
              {title} · {electionState.partyLabel}
            </p>
          </div>
          <PartyChip
            partyName={current.partyName}
            partyColor={current.partyColor}
            partyId={current.party}
            countryId={countryId}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-card-border bg-card/50 p-4 text-center text-sm text-muted">
          No {title}.{" "}
          {isVoting
            ? "Election in progress — plurality wins."
            : "Admin can start a 24-hour election."}
        </div>
      )}
      {isVoting && electionState.myWhippedFromOriginal && (
        <WhippedBadge
          originalVote={electionState.myWhippedFromOriginal}
          originalLabel={
            electionState.myWhippedFromOriginal === "unvoted"
              ? "no prior vote"
              : (candidacies.find((c) => c.id === electionState.myWhippedFromOriginal)
                  ?.nomineeName ?? "previous candidate")
          }
          onRevert={async (v) => {
            if (v === "unvoted") return;
            onVote(v);
          }}
        />
      )}
      {isVoting && (candidacies?.length ?? 0) > 0 && (
        <ElectionDropdown
          roleLabel={title}
          candidacies={candidacies.map((c) => ({
            ...c,
            isMyVote: c.id === myVoteId,
          }))}
          partySeats={partySeats}
          canVote={canVote}
          myVoteId={myVoteId}
          onVote={onVote}
          onWithdraw={onWithdraw}
          viewOnlyLabel={
            !isMember
              ? "House members only"
              : !isInParty
                ? title.includes("Minority")
                  ? "non-majority parties only"
                  : "majority party only"
                : null
          }
        />
      )}
      {leadersAdmin && (
        <div className="flex flex-wrap gap-2">
          {election?.status !== "voting" && (
            <button
              onClick={onStartElection}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 py-2 px-4 text-sm font-medium text-amber-400 hover:bg-amber-500/20"
            >
              Start 24h {title} election
            </button>
          )}
          {isVoting && (
            <button
              onClick={onForceEnd}
              className="rounded-xl border border-green-500/40 bg-green-500/10 py-2 px-4 text-sm font-medium text-green-400 hover:bg-green-500/20"
            >
              Force end {title} election
            </button>
          )}
          <button
            onClick={onReset}
            className="rounded-xl border border-red-500/30 bg-red-500/10 py-2 px-4 text-sm font-medium text-red-400 hover:bg-red-500/20"
          >
            Reset {title} election
          </button>
        </div>
      )}
      {isMember && isInParty && !hasActiveCandidacy && isVoting && (
        <button
          onClick={onDeclare}
          className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          + Declare for {title}
        </button>
      )}
    </div>
  );
}

export function SenateLeadershipRoleSection({
  title,
  electionState,
  isMember,
  leadersAdmin,
  countryId,
  onStartElection,
  onForceEnd,
  onReset,
  onVote,
  onWithdraw,
  onDeclare,
  declaring,
}: {
  title: string;
  electionState: ElectionState | null | undefined;
  isMember: HouseOrSenateMember;
  leadersAdmin: boolean;
  countryId: CountryId;
  onStartElection: () => void;
  onForceEnd: () => void;
  onReset: () => void;
  onVote: (id: string) => void;
  onWithdraw: () => void;
  onDeclare: () => void;
  declaring?: boolean;
}) {
  if (!electionState) return null;

  const { current, election, candidacies, partySeats, isInParty, hasActiveCandidacy, myVoteId } =
    electionState;
  const isVoting = election?.status === "voting";
  const canVote = isInParty && isMember;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {current ? (
        <div className="flex items-center gap-4 rounded-xl border border-card-border bg-card p-4">
          <Avatar
            url={current.avatarUrl}
            name={current.characterName}
            size="h-10 w-10"
            borderKey={current.borderKey}
            tintColor={current.tintColor}
          />
          <div className="flex-1 min-w-0">
            {current.characterId ? (
              <Link
                href={`/character/${current.sequentialId ?? current.characterId}`}
                className="font-semibold hover:text-primary"
              >
                {current.characterName}
                <span className="text-muted font-normal ml-1">
                  {formatPartyState(current.party, current.state, current.partyName)}
                </span>
              </Link>
            ) : (
              <span className="font-semibold">
                {current.characterName}
                <span className="text-muted font-normal ml-1">
                  {formatPartyState(current.party, current.state, current.partyName)}
                </span>
              </span>
            )}
            <p className="text-xs text-muted">
              {title} · {electionState.partyLabel}
            </p>
          </div>
          <PartyChip
            partyName={current.partyName}
            partyColor={current.partyColor}
            partyId={current.party}
            countryId={countryId}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-card-border bg-card/50 p-4 text-center text-sm text-muted">
          No {title}.{" "}
          {isVoting
            ? "Election in progress — plurality wins."
            : "Admin can start a 24-hour election."}
        </div>
      )}
      {isVoting && electionState.myWhippedFromOriginal && (
        <WhippedBadge
          originalVote={electionState.myWhippedFromOriginal}
          originalLabel={
            electionState.myWhippedFromOriginal === "unvoted"
              ? "no prior vote"
              : (candidacies.find((c) => c.id === electionState.myWhippedFromOriginal)
                  ?.nomineeName ?? "previous candidate")
          }
          onRevert={async (v) => {
            if (v === "unvoted") return;
            onVote(v);
          }}
        />
      )}
      {isVoting && (candidacies?.length ?? 0) > 0 && (
        <ElectionDropdown
          roleLabel={title === "President Pro Tempore" ? "Pro Tempore" : title}
          candidacies={candidacies.map((c) => ({
            ...c,
            isMyVote: c.id === myVoteId,
          }))}
          partySeats={partySeats}
          canVote={canVote}
          myVoteId={myVoteId}
          onVote={onVote}
          onWithdraw={onWithdraw}
          viewOnlyLabel={
            !isMember
              ? "Senators only"
              : !isInParty
                ? title.includes("Minority")
                  ? "non-majority parties only"
                  : "majority party only"
                : null
          }
        />
      )}
      {leadersAdmin && (
        <div className="flex flex-wrap gap-2">
          {election?.status !== "voting" && (
            <button
              onClick={onStartElection}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 py-2 px-4 text-sm font-medium text-amber-400 hover:bg-amber-500/20"
            >
              Start 24h {title === "President Pro Tempore" ? "Pro Tempore" : title} election
            </button>
          )}
          {isVoting && (
            <button
              onClick={onForceEnd}
              className="rounded-xl border border-green-500/40 bg-green-500/10 py-2 px-4 text-sm font-medium text-green-400 hover:bg-green-500/20"
            >
              Force end {title === "President Pro Tempore" ? "Pro Tempore" : title} election
            </button>
          )}
          <button
            onClick={onReset}
            className="rounded-xl border border-red-500/30 bg-red-500/10 py-2 px-4 text-sm font-medium text-red-400 hover:bg-red-500/20"
          >
            Reset {title === "President Pro Tempore" ? "Pro Tempore" : title} election
          </button>
        </div>
      )}
      {isMember && isInParty && !hasActiveCandidacy && isVoting && (
        <button
          onClick={onDeclare}
          disabled={declaring}
          className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {declaring ? "Declaring…" : `+ Declare for ${title}`}
        </button>
      )}
    </div>
  );
}
