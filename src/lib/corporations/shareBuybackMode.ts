export type ShareBuybackMode = "instant" | "escrow";

/**
 * Resolve a corporation's share buyback settlement mode. Absent/unknown ⇒ "instant"
 * so pre-existing corps keep today's treasury-backed behavior with no migration.
 */
export function getShareBuybackMode(corp: { shareBuybackMode?: string }): ShareBuybackMode {
  return corp.shareBuybackMode === "escrow" ? "escrow" : "instant";
}
