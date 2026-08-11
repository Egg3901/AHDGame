"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { ProposalVote } from "@/lib/db/types/internationalOrganization";

interface Props {
  /** Async vote handler — should return a promise that resolves on success. */
  onVote: (vote: ProposalVote) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
  /** Already-cast vote, if any, to highlight selection. */
  currentVote?: ProposalVote | null;
}

/**
 * Trio of yes/no/abstain action buttons. Used by every voting surface
 * (membership proposals, FTA legislation, leadership elections).
 */
export function VoteButtons({ onVote, disabled, disabledReason, currentVote }: Props) {
  const [pending, setPending] = useState<ProposalVote | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cast(vote: ProposalVote) {
    setPending(vote);
    setError(null);
    try {
      await onVote(vote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={currentVote === "yes" ? "primary" : "secondary"}
          onClick={() => cast("yes")}
          disabled={disabled || pending !== null}
          isLoading={pending === "yes"}
        >
          Vote Yes
        </Button>
        <Button
          size="sm"
          variant={currentVote === "no" ? "destructive" : "secondary"}
          onClick={() => cast("no")}
          disabled={disabled || pending !== null}
          isLoading={pending === "no"}
        >
          Vote No
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => cast("abstain")}
          disabled={disabled || pending !== null}
          isLoading={pending === "abstain"}
        >
          Abstain
        </Button>
      </div>
      {disabled && disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
