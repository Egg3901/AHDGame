"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyChip, formatPartyState } from "./CongressShared";
import { ElectionDropdown } from "./LeadershipShared";
import { WhippedBadge } from "@/components/bills/WhippedBadge";
import type { CountryId } from "@/lib/constants/countries";
import type { SpeakerResponse } from "@/lib/congress/types";
import { useGameClock } from "@/contexts/useGameClock";
import { LocalTime } from "@/components/time/LocalTime";

function SpeakerCard({
  speaker,
  countryId,
}: {
  speaker: NonNullable<SpeakerResponse["currentSpeaker"]>;
  countryId: CountryId;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-card-border bg-card p-4">
      <Avatar
        url={speaker.avatarUrl}
        name={speaker.characterName}
        size="h-10 w-10"
        borderKey={speaker.borderKey}
        tintColor={speaker.tintColor}
      />
      <div className="flex-1 min-w-0">
        <Link
          href={`/character/${speaker.sequentialId ?? speaker.characterId}`}
          className="font-semibold hover:text-primary transition-colors"
        >
          {speaker.characterName}
          <span className="text-muted font-normal ml-1">
            {formatPartyState(speaker.party, speaker.state, speaker.partyName)}
          </span>
        </Link>
        <p className="text-xs text-muted mt-0.5">Speaker of the House</p>
      </div>
      <PartyChip
        partyName={speaker.partyName}
        partyColor={speaker.partyColor}
        partyId={speaker.party}
        countryId={countryId}
      />
    </div>
  );
}

export function SpeakerSection({
  data,
  leadersAdmin,
  declaring,
  countryId,
  onDeclare,
  onWithdraw,
  onVote,
  onStartElection,
  onForceEnd,
  onReset,
  onFileVacate,
  onVacateVote,
}: {
  data: SpeakerResponse | null;
  leadersAdmin: boolean;
  declaring: boolean;
  countryId: CountryId;
  onDeclare: () => void;
  onWithdraw: () => void;
  onVote: (nominationId: string) => void;
  onStartElection: () => void;
  onForceEnd: () => void;
  onReset: () => void;
  onFileVacate: () => void;
  onVacateVote: (vote: "for" | "against") => void;
}) {
  const clock = useGameClock();
  const motion = data?.vacateMotion;
  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Speaker of the House</h3>
        {leadersAdmin && (
          <div className="flex flex-wrap gap-2">
            {data?.election?.status !== "voting" && (
              <button
                onClick={onStartElection}
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 py-2 px-4 text-sm font-medium text-amber-400 hover:bg-amber-500/20"
              >
                Start 24-hour Speaker election
              </button>
            )}
            {data?.election?.status === "voting" && (
              <button
                onClick={onForceEnd}
                className="rounded-xl border border-green-500/40 bg-green-500/10 py-2 px-4 text-sm font-medium text-green-400 hover:bg-green-500/20"
              >
                Force end Speaker election
              </button>
            )}
            <button
              onClick={onReset}
              className="rounded-xl border border-red-500/30 bg-red-500/10 py-2 px-4 text-sm font-medium text-red-400 hover:bg-red-500/20"
            >
              Reset Speaker election
            </button>
          </div>
        )}
        {data?.currentSpeaker ? (
          <SpeakerCard speaker={data.currentSpeaker} countryId={countryId} />
        ) : (
          <div className="rounded-xl border border-dashed border-card-border bg-card/50 p-6 text-center space-y-2">
            <p className="text-sm font-medium text-muted">No Speaker elected</p>
            <p className="text-xs text-muted/60">
              A 24-hour election can be started by an admin. Any seated House member may run and
              vote; top vote-getter wins (plurality).
            </p>
          </div>
        )}

        {/* Motion to vacate the chair — mid-term Speaker removal by House majority. */}
        {motion?.status === "voting" ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
            <p className="text-sm font-semibold text-red-400">
              Motion to vacate {motion.targetSpeakerName ?? "the Speaker"}
            </p>
            <p className="text-xs text-muted">
              Filed by {motion.filedByName ?? "a member"}. An absolute majority of the chamber (
              {motion.threshold} of {motion.totalSeats}) carries it and vacates the chair.
              {motion.endsOnTurn != null || motion.endsAt ? (
                <>
                  {" "}
                  Voting ends{" "}
                  <LocalTime
                    value={
                      (motion.endsOnTurn != null
                        ? clock.projectTurnToDate(motion.endsOnTurn)
                        : null) ?? (motion.endsAt ? new Date(motion.endsAt) : new Date())
                    }
                    options={{ dateStyle: "medium", timeStyle: "short" }}
                  />
                  .
                </>
              ) : null}
            </p>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium text-red-400">Vacate: {motion.votesFor}</span>
              <span className="font-medium text-muted">Keep: {motion.votesAgainst}</span>
            </div>
            {data?.isHouseMember && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => onVacateVote("for")}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    motion.myVote === "for"
                      ? "border-red-500 bg-red-500/20 text-red-300"
                      : "border-red-500/30 text-red-400 hover:bg-red-500/10"
                  }`}
                >
                  {motion.myVote === "for" ? "✓ Voted to vacate" : "Vote to vacate"}
                </button>
                <button
                  onClick={() => onVacateVote("against")}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    motion.myVote === "against"
                      ? "border-green-500 bg-green-500/20 text-green-300"
                      : "border-card-border text-muted hover:bg-card-elevated"
                  }`}
                >
                  {motion.myVote === "against" ? "✓ Voted to keep" : "Vote to keep"}
                </button>
              </div>
            )}
          </div>
        ) : (
          motion?.canFile && (
            <button
              onClick={onFileVacate}
              className="w-full rounded-xl border border-dashed border-red-500/30 bg-red-500/5 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Move to vacate the chair
            </button>
          )
        )}
        {data?.election && (
          <div className="rounded-xl border border-card-border bg-card p-4 space-y-1">
            {data.election.status === "voting" && data.election.endsAt && (
              <>
                <p className="text-sm font-medium">Speaker election in progress</p>
                <p className="text-xs text-muted">
                  Voting ends{" "}
                  <LocalTime
                    value={
                      (data.election.endsOnTurn != null
                        ? clock.projectTurnToDate(data.election.endsOnTurn)
                        : null) ?? new Date(data.election.endsAt)
                    }
                    options={{ dateStyle: "medium", timeStyle: "short" }}
                  />{" "}
                  · Any seated House member may run and vote · Plurality wins.
                </p>
              </>
            )}
            {data.election.status === "none" && leadersAdmin && (
              <p className="text-sm text-muted">
                No election in progress. Use Start above to begin.
              </p>
            )}
          </div>
        )}
        {data?.myWhippedFromOriginal && data?.election?.status === "voting" && (
          <div>
            <WhippedBadge
              originalVote={data.myWhippedFromOriginal}
              originalLabel={
                data.myWhippedFromOriginal === "unvoted"
                  ? "no prior vote"
                  : (data.activeCandidacies.find((c) => c.id === data.myWhippedFromOriginal)
                      ?.nomineeName ?? "previous candidate")
              }
              onRevert={async (v) => {
                if (v === "unvoted") return;
                onVote(v);
              }}
            />
          </div>
        )}
        {data?.election?.status === "voting" && (data?.activeCandidacies?.length ?? 0) > 0 && (
          <ElectionDropdown
            roleLabel="Speaker"
            candidacies={data.activeCandidacies.map((c) => ({
              id: c.id,
              nomineeId: c.nomineeId,
              nomineeName: c.nomineeName,
              nomineeParty: c.nomineeParty,
              nomineePartyName: c.nomineePartyName,
              nomineePartyColor: c.nomineePartyColor,
              nomineeState: c.nomineeState,
              avatarUrl: c.avatarUrl,
              borderKey: c.borderKey,
              tintColor: c.tintColor,
              votesFor: c.votesFor,
              voteByParty: c.voteByParty,
              isMyVote: c.id === data.myVoteId,
              isMyCandidate: c.isMyCandidate,
            }))}
            partySeats={data.majoritySeats}
            canVote={data.canRunForSpeaker}
            myVoteId={data.myVoteId}
            onVote={onVote}
            onWithdraw={onWithdraw}
            viewOnlyLabel={
              !data?.canRunForSpeaker ? `${data.speakerEligibilityLabel} may run and vote` : null
            }
          />
        )}
      </div>

      {data?.isHouseMember &&
        data?.canRunForSpeaker &&
        !data.hasActiveCandidacy &&
        data?.election?.status === "voting" && (
          <button
            onClick={onDeclare}
            disabled={declaring}
            className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 py-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
          >
            {declaring ? "Declaring…" : "+ Declare Your Candidacy for Speaker"}
          </button>
        )}
      {data?.isHouseMember && !data?.canRunForSpeaker && data?.election?.status === "voting" && (
        <p className="text-xs text-muted rounded-xl border border-card-border bg-card/50 p-3">
          Only {data.speakerEligibilityLabel} may run and vote in the Speaker election.
        </p>
      )}
    </>
  );
}
