export const EQUITY_LIQUIDITY_HALF_SPREAD = 0.02;
export const EQUITY_LIQUIDITY_MAX_LISTING_SHARE = 1;
export const EQUITY_LIQUIDITY_MAX_LISTINGS = 1_024;
export const EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND = 64;
export const EQUITY_LIQUIDITY_MAX_HOLDING_SHARE = 0.1;
export const EQUITY_LIQUIDITY_MAX_ISSUED_SHARE = 0.01;
export const EQUITY_LIQUIDITY_MAX_CASH_SHARE = 0.15;
export const EQUITY_LIQUIDITY_STRESS_HAIRCUT = 0.1;
export const EQUITY_LIQUIDITY_MAX_STRESS_LOSS_SHARE = 0.005;
export const EQUITY_LIQUIDITY_MIN_NOTIONAL_ANCHOR = 100;
export const EQUITY_LIQUIDITY_TARGET_NOTIONAL_ANCHOR = 50_000;
export const EQUITY_LIQUIDITY_TARGET_MARKET_CAP_SHARE = 0.005;

export interface EquityLiquidityRuleFund {
  id: string;
  scope: "country" | "global";
  kind: "broad" | "sector";
  countryId?: string;
  sectorType?: string;
  cashAnchor: number;
  quotedNav: number;
  unitSupply: number;
  holdingValueAnchor: number;
  holdings: Array<{ corporationId: string; shares: number }>;
  targetCorporationIds: string[];
}

export interface EquityLiquidityRuleListing {
  corporationId: string;
  countryId: string;
  type?: string;
  secondaryType?: string;
  referencePriceLocal: number;
  referencePriceAnchor: number;
  totalShares: number;
}

export interface EquityLiquidityRuleQuotePlan {
  fundId: string;
  corporationId: string;
  bidShares: number;
  askShares: number;
  bidPriceLocal: number;
  askPriceLocal: number;
  referencePriceLocal: number;
  referencePriceAnchor: number;
  bidNotionalAnchor: number;
  stressLossAnchor: number;
}

function positive(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : 0;
}

/** Plan finite-cash, inventory-backed quotes without database or server state. */
export function planEquityLiquidityQuoteRules(input: {
  funds: EquityLiquidityRuleFund[];
  listings: EquityLiquidityRuleListing[];
  totalListings: number;
  turn: number;
}): EquityLiquidityRuleQuotePlan[] {
  const fundById = new Map(input.funds.map((fund) => [fund.id, fund]));
  const slotsByFund = new Map<string, number>();
  const remainingCashRisk = new Map<string, number>();
  for (const fund of input.funds) {
    const observedBacking = positive(fund.cashAnchor) + positive(fund.holdingValueAnchor);
    const quotedBacking = positive(fund.quotedNav) * positive(fund.unitSupply);
    const aum = Math.max(observedBacking, quotedBacking);
    const stressBoundNotional =
      aum > 0
        ? (aum * EQUITY_LIQUIDITY_MAX_STRESS_LOSS_SHARE) / EQUITY_LIQUIDITY_STRESS_HAIRCUT
        : 0;
    remainingCashRisk.set(
      fund.id,
      Math.min(positive(fund.cashAnchor) * EQUITY_LIQUIDITY_MAX_CASH_SHARE, stressBoundNotional)
    );
  }

  const maxListings = Math.min(
    EQUITY_LIQUIDITY_MAX_LISTINGS,
    Math.floor(Math.max(0, input.totalListings) * EQUITY_LIQUIDITY_MAX_LISTING_SHARE)
  );
  if (maxListings <= 0) return [];

  const sortedListings = [...input.listings].sort((a, b) =>
    a.corporationId.localeCompare(b.corporationId)
  );
  const rotationOffset = sortedListings.length > 0 ? input.turn % sortedListings.length : 0;
  const rotated = [
    ...sortedListings.slice(rotationOffset),
    ...sortedListings.slice(0, rotationOffset),
  ];
  const plans: EquityLiquidityRuleQuotePlan[] = [];

  for (const listing of rotated) {
    if (plans.length >= maxListings) break;
    if (
      listing.referencePriceLocal <= 0 ||
      listing.referencePriceAnchor <= 0 ||
      listing.totalShares <= 0
    ) {
      continue;
    }

    const providers = input.funds
      .flatMap((fund) => {
        const holding = fund.holdings.find((row) => row.corporationId === listing.corporationId);
        const isTarget = fund.targetCorporationIds.includes(listing.corporationId);
        const isBroadMandate =
          fund.kind === "broad" &&
          (fund.scope === "global" || fund.countryId === listing.countryId);
        const isSectorMandate =
          fund.kind === "sector" &&
          Boolean(
            fund.sectorType &&
            (fund.sectorType === listing.type || fund.sectorType === listing.secondaryType)
          );
        if (!holding && !isTarget && !isBroadMandate && !isSectorMandate) return [];
        return [
          {
            fund,
            shares: holding?.shares ?? 0,
            priority: holding?.shares ? 3 : isTarget ? 2 : 1,
          },
        ];
      })
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          (slotsByFund.get(a.fund.id) ?? 0) - (slotsByFund.get(b.fund.id) ?? 0) ||
          b.shares - a.shares ||
          (remainingCashRisk.get(b.fund.id) ?? 0) - (remainingCashRisk.get(a.fund.id) ?? 0) ||
          a.fund.id.localeCompare(b.fund.id)
      );

    for (const provider of providers) {
      const fundId = provider.fund.id;
      if (!fundById.has(fundId)) continue;
      if ((slotsByFund.get(fundId) ?? 0) >= EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND) continue;
      const cashRisk = remainingCashRisk.get(fundId) ?? 0;
      if (cashRisk < EQUITY_LIQUIDITY_MIN_NOTIONAL_ANCHOR) continue;

      const marketCapAnchor = listing.totalShares * listing.referencePriceAnchor;
      const targetNotionalAnchor = Math.min(
        cashRisk,
        EQUITY_LIQUIDITY_TARGET_NOTIONAL_ANCHOR,
        marketCapAnchor * EQUITY_LIQUIDITY_TARGET_MARKET_CAP_SHARE
      );
      const bidShares = Math.floor(
        Math.min(
          listing.totalShares * EQUITY_LIQUIDITY_MAX_ISSUED_SHARE,
          targetNotionalAnchor / listing.referencePriceAnchor
        )
      );
      if (bidShares <= 0) continue;
      const bidNotionalAnchor = bidShares * listing.referencePriceAnchor;
      if (bidNotionalAnchor < EQUITY_LIQUIDITY_MIN_NOTIONAL_ANCHOR) continue;
      const askShares = Math.floor(
        Math.min(
          provider.shares * EQUITY_LIQUIDITY_MAX_HOLDING_SHARE,
          listing.totalShares * EQUITY_LIQUIDITY_MAX_ISSUED_SHARE,
          bidShares
        )
      );

      plans.push({
        fundId,
        corporationId: listing.corporationId,
        bidShares,
        askShares,
        bidPriceLocal: listing.referencePriceLocal * (1 - EQUITY_LIQUIDITY_HALF_SPREAD),
        askPriceLocal: listing.referencePriceLocal * (1 + EQUITY_LIQUIDITY_HALF_SPREAD),
        referencePriceLocal: listing.referencePriceLocal,
        referencePriceAnchor: listing.referencePriceAnchor,
        bidNotionalAnchor,
        stressLossAnchor: bidNotionalAnchor * EQUITY_LIQUIDITY_STRESS_HAIRCUT,
      });
      slotsByFund.set(fundId, (slotsByFund.get(fundId) ?? 0) + 1);
      remainingCashRisk.set(fundId, cashRisk - bidNotionalAnchor);
      break;
    }
  }

  return plans;
}
