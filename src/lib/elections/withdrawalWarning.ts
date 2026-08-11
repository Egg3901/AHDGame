/**
 * Build the confirmation message shown before a player withdraws from an
 * election. The wording is phase-aware because the consequences differ:
 *
 * - **Primary phase:** no vote pool has accumulated yet (primary resolves
 *   from a per-candidate score, not from accumulated votes). Withdrawing
 *   just removes the candidacy.
 * - **General phase:** accumulated votes are *permanently removed* from
 *   the tally (not redistributed) — see
 *   `/api/elections/[id]/withdraw/route.ts`. For a close race a late
 *   withdrawal can tip the outcome, so the warning surfaces that fact
 *   explicitly.
 *
 * Withdrawing always blocks re-entry into the same election regardless of
 * phase (`elections.md` §Withdrawal Mechanics).
 */
export function buildWithdrawalConfirmMessage(phase: "primary" | "general" | "unknown"): string {
  if (phase === "general") {
    return [
      "Withdraw from this race?",
      "",
      "Your accumulated votes will be permanently REMOVED from the tally — they are NOT redistributed to other candidates.",
      "",
      "You cannot re-enter this election after withdrawing.",
    ].join("\n");
  }
  if (phase === "primary") {
    return [
      "Withdraw from this primary?",
      "",
      "You cannot re-enter this election after withdrawing.",
    ].join("\n");
  }
  // Phase unknown (caller didn't supply it) — use a conservative warning
  // that mentions the destructive general-phase behavior.
  return [
    "Withdraw from this race?",
    "",
    "If the election is in its general phase, your accumulated votes will be permanently removed (not redistributed).",
    "",
    "You cannot re-enter this election after withdrawing.",
  ].join("\n");
}
