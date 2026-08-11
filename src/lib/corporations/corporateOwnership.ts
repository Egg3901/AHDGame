import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { shareholderVotingPower, totalVotingPower } from "./superShares";

/** Another corporation must hold above this % of outstanding shares for subsidiary status. */
export const SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT = 50;

/** Required corporate ownership % to unlock hostile takeover merge. */
export const HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT = 75;

/**
 * Premium over market (25% → pay 125% of share price per minority share).
 * Matches hostile takeover squeeze-out payout.
 */
export const HOSTILE_TAKEOVER_PREMIUM_RATE = 0.25;

/**
 * Corporate holders ranked by CONTROL (voting power), not raw share count.
 * For single-class corps the two are identical; for dual-class corps the
 * founder's supershare votes dilute everyone else's control %, so an economic
 * majority cannot claim subsidiary status or hostile-takeover rights past the
 * founder's voting majority.
 */
export function corporateOwnershipRows(corporation: Corporation): Array<{
  corporationId: ObjectId;
  pct: number;
  shares: number;
}> {
  const totalVotes = totalVotingPower(corporation);
  if (totalVotes <= 0) return [];
  const rows: Array<{ corporationId: ObjectId; pct: number; shares: number }> = [];
  for (const sh of corporation.shareholders ?? []) {
    if (sh.corporationId && sh.shares > 0) {
      rows.push({
        corporationId: sh.corporationId,
        pct: (shareholderVotingPower(corporation, sh) / totalVotes) * 100,
        shares: sh.shares,
      });
    }
  }
  return rows;
}

/**
 * If another corporation holds over 50% (largest corporate stake wins ties),
 * returns that controlling corporate parent.
 */
export function getControllingCorporateParent(corporation: Corporation): {
  corporationId: ObjectId;
  ownershipPct: number;
} | null {
  const rows = corporateOwnershipRows(corporation);
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    return a.corporationId.toString().localeCompare(b.corporationId.toString());
  });
  const top = rows[0];
  if (top.pct <= SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT) return null;
  return {
    corporationId: top.corporationId,
    ownershipPct: Math.round(top.pct * 100) / 100,
  };
}

/** Acquirer's control % (voting power) — see corporateOwnershipRows. */
export function acquirerOwnershipPercent(
  acquirerCorpId: ObjectId,
  corporation: Corporation
): number {
  const totalVotes = totalVotingPower(corporation);
  if (totalVotes <= 0) return 0;
  const row = corporation.shareholders?.find((sh) => sh.corporationId?.equals(acquirerCorpId));
  return row ? (shareholderVotingPower(corporation, row) / totalVotes) * 100 : 0;
}
