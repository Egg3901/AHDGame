"use client";

import { useState } from "react";
import { useToast } from "@/contexts/ToastContext";

interface WhippedBadgeProps {
  /**
   * Pre-whip value. For bills/cabinet/gov votes: "for" | "against" | "abstain" | "unvoted".
   * For leadership: the previous candidacy ObjectId (string) or "unvoted".
   */
  originalVote: string;
  onRevert: (originalVote: string) => Promise<void>;
  /** Short human label for what the original vote was (e.g. "AYE", "NAY", "Jane Doe", "no prior vote"). */
  originalLabel?: string;
}

/**
 * Shown on a character's vote page when their vote was force-set by a Player Whip.
 * Clicking Revert replays the pre-whip value through the normal vote endpoint,
 * which also clears the whipped snapshot so the badge disappears.
 *
 * Exception: when the pre-whip state was "unvoted" there is no value to replay —
 * the badge explains that instead and hides the Revert button. Submitting any
 * new vote through the normal endpoints still clears the whipped snapshot.
 */
export function WhippedBadge({ originalVote, onRevert, originalLabel }: WhippedBadgeProps) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  const isUnvoted = originalVote === "unvoted";
  const label =
    originalLabel ??
    (isUnvoted
      ? "no prior vote"
      : originalVote === "for" || originalVote === "against" || originalVote === "abstain"
        ? originalVote.toUpperCase()
        : "previous candidate");

  const handleRevert = async () => {
    setPending(true);
    try {
      await onRevert(originalVote);
      showToast("Reverted to your original vote", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Revert failed", "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="status"
      className="inline-flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning"
    >
      <span className="font-semibold">Whipped by Party</span>
      <span>— original: {label}</span>
      {isUnvoted ? (
        <span className="italic">Vote normally to clear this badge.</span>
      ) : (
        <button
          onClick={handleRevert}
          disabled={pending}
          className="font-medium underline hover:no-underline disabled:opacity-50"
        >
          {pending ? "Reverting..." : "Revert"}
        </button>
      )}
    </div>
  );
}
