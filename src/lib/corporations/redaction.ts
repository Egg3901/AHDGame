import type { Corporation } from "@/lib/db/types";

/**
 * Field allowlist of corp-level financial values that are hidden from non-CEO
 * viewers when a corporation is private. Sector list, name, HQ, sector(s),
 * shareholder list, and qualitative credit rating remain visible.
 */
const PRIVATE_REDACTED_CORP_FIELDS = [
  "liquidCapital",
  "liquidCurrencyCode",
  "marketingBudget",
  "marketingStrength",
  "marketingStrengthGrowth",
  "logisticsBudget",
  "logisticsStrength",
  "logisticsStrengthNetChange",
  "rdBudget",
  "rdScore",
  "rdScoreNetChange",
  "ceoSalary",
  "sharePrice",
  "fundamentalSharePrice",
  "orderFlowMultiplier",
  "orderFlowWindowBuyValue",
  "orderFlowWindowSellValue",
  "earningsHistory",
  "dividendRate",
  "lastDividendChange",
  "creditCompositeSnapshot",
  "creditSnapshotTurn",
  "totalShares",
  "publicFloat",
  "income",
  "shareBuybackMode",
  "marketCapitalization",
  "shareEscrowBalance",
  "escrowFundingPerTurn",
  "lastEscrowWithdrawalTurn",
  /**
   * C2: the plants-tier corp-level physical aggregate (capacity, produced,
   * sold, CIP, units on order). It is the same book as the per-sector
   * physicals below, summed — leaving it in re-published everything the
   * per-row redaction strips.
   */
  "physical",
] as const;

/**
 * C2: the plants tier added a whole PHYSICAL book to each sector row, and
 * redaction never grew to cover it. A private corporation is supposed to leak
 * strictly LESS than a public one; before this list was extended it leaked
 * strictly more, to anonymous viewers, because the route returns the private
 * payload before the public fog-of-war pass ever runs.
 *
 * Two things make the physicals non-optional here:
 *
 *   1. Under plants, revenue IS capacity × mix price. Stripping `revenue` while
 *      publishing `capacityUnits` redacts nothing — the number is
 *      reconstructible from a public price.
 *   2. `fillRate` is attack-targeting intel (see financialFogOfWar.ts): it tells
 *      a rival the incumbent cannot defend its market, and unlike the money
 *      figures it does not degrade with corp size. Public corps only ever see
 *      the coarse band; a private corp must not disclose even that, so
 *      `fillRateBand` goes too.
 */
const PRIVATE_REDACTED_SECTOR_FIELDS = [
  "revenue",
  "financialRevenue",
  "realizedRevenue",
  "profitMargin",
  "currentGrowthCost",
  "workers",
  // Plants-tier physicals.
  "capacityUnits",
  "producedUnits",
  "soldUnits",
  "fillRate",
  "fillRateBand",
  // Share of output a rival could not get to market. Same class of intel as the
  // exact fill rate: it tells an attacker which of this corp's plants cannot
  // defend their market and why.
  "deliveryLimitedFraction",
  "deliveryLimitedFreightClass",
  // profit / cost. Publishing it beside the (public) profit figure lets a
  // viewer solve cost = profit / ratio and then revenue = cost + profit,
  // reconstructing the redacted revenue exactly. So it goes too.
  "fillAdjustedMarginPct",
  "constructionInProgressAnchor",
  "buildQueueSummary",
] as const;

const PRIVATE_REDACTED_BOND_FIELDS = [
  "principal",
  "outstandingPrincipal",
  "couponRate",
  "nextPaymentAt",
  "amountAtIssuance",
] as const;

export function shouldRedactCorporation(
  corp: Pick<Corporation, "isPrivate" | "userId">,
  viewerUserId: string | undefined,
  viewerIsAdmin: boolean,
  viewerHasModeratorOverride = false
): boolean {
  if (!corp.isPrivate) return false;
  if (viewerIsAdmin) return false;
  if (viewerHasModeratorOverride) return false;
  if (viewerUserId && corp.userId?.toString() === viewerUserId) return false;
  return true;
}

function omit<T extends object>(obj: T, keys: readonly string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as T;
}

export function redactPrivateCorporation<T extends Record<string, unknown>>(corp: T): T {
  return omit(corp, PRIVATE_REDACTED_CORP_FIELDS);
}

export function redactPrivateSectorRow<T extends Record<string, unknown>>(sector: T): T {
  return omit(sector, PRIVATE_REDACTED_SECTOR_FIELDS);
}

export function redactPrivateBondRow<T extends Record<string, unknown>>(bond: T): T {
  return omit(bond, PRIVATE_REDACTED_BOND_FIELDS);
}
