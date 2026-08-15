"use client";

import { useState } from "react";
import { partyApiUrl } from "@/lib/urls";
import type { ProposalView } from "@/lib/parties/dto/partyView";

function VoteBar({ yes, no, notVoted }: { yes: number; no: number; notVoted: number }) {
  const total = yes + no + notVoted;
  if (total === 0) return <span className="text-xs text-muted">No votes yet</span>;
  const yPct = Math.round((yes / total) * 100);
  const nPct = Math.round((no / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex h-2 rounded-full overflow-hidden bg-card-border">
        <div className="bg-green-500" style={{ width: `${yPct}%` }} />
        <div className="bg-red-500" style={{ width: `${nPct}%` }} />
      </div>
      <div className="flex gap-3 text-xs text-muted">
        <span className="text-green-400">{yes} yes</span>
        <span className="text-red-400">{no} no</span>
        <span>{notVoted} not voted</span>
      </div>
    </div>
  );
}

// Includes the axes retired in ticket #1032 so proposals passed before the
// retirement still render their real subject in party history.
const POSITION_SHIFT_AXIS_LABEL: Record<string, string> = {
  economic: "Economic",
  social: "Social",
  foreignPolicy: "Foreign Policy (retired)",
  culture: "Culture (retired)",
};

const REMOVE_ROLE_LABEL: Record<
  "chair" | "viceChair" | "treasurer" | "committeeMember" | "campaigner",
  string
> = {
  chair: "Chair",
  viceChair: "Vice-Chair",
  treasurer: "Treasurer",
  committeeMember: "Committee Member",
  campaigner: "Campaigner",
};

function ProposalTitle({ proposal }: { proposal: ProposalView }) {
  if (proposal.type === "rename" && proposal.rename) {
    return (
      <span>
        Rename to <strong>{proposal.rename.newName}</strong> ({proposal.rename.newAbbreviation})
      </span>
    );
  }
  if (proposal.type === "positionShift" && proposal.positionShift) {
    const { axis, direction } = proposal.positionShift;
    const dir = direction === 1 ? "right" : "left";
    return (
      <span>
        Shift <strong>{POSITION_SHIFT_AXIS_LABEL[axis]}</strong> position {dir}
      </span>
    );
  }
  if (proposal.type === "merge" && proposal.merge) {
    return (
      <span>
        Merge into <strong>{proposal.merge.targetPartyName}</strong>
      </span>
    );
  }
  if (proposal.type === "electionMethod" && proposal.electionMethod) {
    const label =
      proposal.electionMethod.method === "committee"
        ? "Committee-only"
        : proposal.electionMethod.method === "influence"
          ? "Party influence weighted"
          : "All-member";
    return (
      <span>
        Change election method to <strong>{label}</strong>
      </span>
    );
  }
  if (proposal.type === "electionDuration" && proposal.electionDuration) {
    const weeks = (proposal.electionDuration.durationTurns / 168).toFixed(1).replace(/\.0$/, "");
    return (
      <span>
        Set election duration to{" "}
        <strong>
          {weeks} week{weeks === "1" ? "" : "s"}
        </strong>{" "}
        ({proposal.electionDuration.durationTurns} turns)
      </span>
    );
  }
  if (proposal.type === "removeOfficeHolder" && proposal.removeOfficeHolder) {
    const { role, targetCharacterName } = proposal.removeOfficeHolder;
    return (
      <span>
        Remove <strong>{REMOVE_ROLE_LABEL[role]}</strong> {targetCharacterName}
      </span>
    );
  }
  if (proposal.type === "campaignerAppointment" && proposal.campaignerAppointment) {
    return (
      <span>
        Confirm <strong>{proposal.campaignerAppointment.targetCharacterName}</strong> as Campaigner
      </span>
    );
  }
  if (proposal.type === "transactionApprovalMode" && proposal.transactionApprovalMode) {
    const label =
      proposal.transactionApprovalMode.mode === "double"
        ? "two-person approval"
        : "single-person approval";
    return (
      <span>
        Switch treasury approval mode to <strong>{label}</strong>
      </span>
    );
  }
  return <span>Proposal</span>;
}

const STATUS_STYLES: Record<ProposalView["status"], string> = {
  open: "bg-blue-900/40 text-blue-300",
  passed: "bg-green-900/40 text-green-300",
  rejected: "bg-red-900/40 text-red-300",
  expired: "bg-card text-muted",
};

export function ProposalCard({
  proposal,
  country,
  partyId,
  canVote,
  votingSide,
  onVoted,
}: {
  proposal: ProposalView;
  country: string;
  partyId: string;
  canVote: boolean;
  votingSide: "proposing" | "target" | null;
  onVoted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const myVote =
    votingSide === "proposing" ? proposal.myProposingVote : (proposal.myTargetVote ?? undefined);

  const handleVote = async (vote: "yes" | "no") => {
    if (!votingSide) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(
        `${partyApiUrl(country, partyId)}/committee/proposals/${proposal.id}/vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vote }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "Failed to vote");
      } else {
        setMsg("");
        onVoted();
      }
    } catch {
      setMsg("Network error");
    } finally {
      setLoading(false);
    }
  };

  const isOpen = proposal.status === "open";

  return (
    <div className="rounded-lg border border-card-border bg-background p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">
          <ProposalTitle proposal={proposal} />
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[proposal.status]}`}
        >
          {proposal.status}
        </span>
      </div>

      <div className="text-xs text-muted">
        Proposed by {proposal.proposedByName} · Turn {proposal.createdAtTurn}
        {isOpen && ` · expires turn ${proposal.expiresAtTurn}`}
        {!isOpen && proposal.resolvedAtTurn && ` · resolved turn ${proposal.resolvedAtTurn}`}
      </div>

      {/* Vote summaries */}
      <div className="space-y-2">
        <div className="text-xs text-muted uppercase tracking-wider">
          {proposal.type === "merge" ? "Proposing committee" : "Committee vote"}
        </div>
        <VoteBar {...proposal.proposingVoteSummary} />

        {proposal.type === "merge" && proposal.targetVoteSummary && (
          <div className="pt-1">
            <div className="text-xs text-muted uppercase tracking-wider mb-1">Target committee</div>
            <VoteBar {...proposal.targetVoteSummary} />
          </div>
        )}
      </div>

      {/* Cast vote */}
      {isOpen && canVote && votingSide && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => handleVote("yes")}
            disabled={loading}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              myVote === "yes"
                ? "bg-green-600 text-white"
                : "bg-card border border-card-border text-muted hover:text-foreground hover:border-green-500"
            }`}
          >
            Yes
          </button>
          <button
            onClick={() => handleVote("no")}
            disabled={loading}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              myVote === "no"
                ? "bg-red-600 text-white"
                : "bg-card border border-card-border text-muted hover:text-foreground hover:border-red-500"
            }`}
          >
            No
          </button>
          {myVote && <span className="text-xs text-muted">Your vote: {myVote}</span>}
          {msg && <span className="text-xs text-red-400">{msg}</span>}
        </div>
      )}
    </div>
  );
}
