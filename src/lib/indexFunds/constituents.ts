import type { ObjectId } from "mongodb";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  Corporation,
  IndexFundKind,
  IndexFundScope,
  IndexFundTargetConstituent,
} from "@/lib/db/types";
import { applyListingRetention, applyListingStandards } from "./listingStandards";
import type { ListingFailureStreak } from "./listingStandards";
import { failuresAfterWaiver } from "./petitions/rules";

export type IndexFundTargetDefinition = {
  scope: IndexFundScope;
  kind: IndexFundKind;
  countryId?: CountryId;
  sectorType?: CorporationType;
  /** Top-N market-cap cutoff. Defaults to 50 for global broad funds and unlimited otherwise. */
  topN?: number;
  anchorCurrencyCode: CurrencyCode;
};

export type IndexFundCandidate = Pick<
  Corporation,
  | "_id"
  | "countryId"
  | "type"
  | "secondaryType"
  | "sharePrice"
  | "totalShares"
  | "liquidCurrencyCode"
  | "countryOwnerId"
  | "isPrivate"
  | "hiddenFromExchange"
> & {
  /** A7 listing standards: shares in public hands, and solvency. */
  publicFloat?: number;
  liquidCapital?: number;
};

export type WeightedIndexFundConstituent = IndexFundTargetConstituent & {
  rank: number;
};

function positiveRate(
  rates: Partial<Record<CurrencyCode, number>>,
  code: CurrencyCode
): number | null {
  const rate = rates[code];
  return Number.isFinite(rate) && rate && rate > 0 ? rate : null;
}

export function convertLocalMarketCapToFundAnchor(input: {
  localMarketCap: number;
  localCurrencyCode?: CurrencyCode;
  fundAnchorCurrencyCode: CurrencyCode;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
}): number | null {
  if (!Number.isFinite(input.localMarketCap) || input.localMarketCap <= 0) return null;
  const localCurrencyCode = input.localCurrencyCode ?? "USD";
  const localRate = positiveRate(input.exchangeRates, localCurrencyCode);
  const fundRate = positiveRate(input.exchangeRates, input.fundAnchorCurrencyCode);
  if (!localRate || !fundRate) return null;

  const anchorUnits = input.localMarketCap / localRate;
  return anchorUnits * fundRate;
}

export function isEligibleIndexFundConstituent(
  corporation: IndexFundCandidate,
  definition: Pick<IndexFundTargetDefinition, "scope" | "kind" | "countryId" | "sectorType">
): boolean {
  if (corporation.isPrivate || corporation.hiddenFromExchange || corporation.countryOwnerId) {
    return false;
  }
  if (!Number.isFinite(corporation.sharePrice) || corporation.sharePrice <= 0) return false;
  if (!Number.isFinite(corporation.totalShares) || corporation.totalShares <= 0) return false;

  if (definition.scope === "country" && corporation.countryId !== definition.countryId)
    return false;
  if (definition.kind === "sector") {
    if (!definition.sectorType) return false;
    return (
      corporation.type === definition.sectorType ||
      corporation.secondaryType === definition.sectorType
    );
  }

  return true;
}

/**
 * A7: candidates that pass the mechanical eligibility test AND the listing
 * standards. Screened as a set rather than one at a time, because the size bar
 * is measured against the pool's own median.
 */
export function screenListingStandards(
  corporations: IndexFundCandidate[],
  retention?: {
    /** Corporations the fund already targets or holds. */
    incumbentIds: Set<string>;
    /** Failure streaks recorded at the last rebalance. */
    priorStreaks: Map<string, number>;
    /**
     * A7 part 2: corporations holding an active committee waiver. A waiver
     * suppresses the waivable failures only, never solvency, so an insolvent
     * corporation stays out however the committee voted.
     */
    waivedIds?: Set<string>;
  }
): { passed: IndexFundCandidate[]; streaks: ListingFailureStreak[]; droppedIds: string[] } {
  const rawVerdicts = applyListingStandards(
    corporations.map((c) => ({
      corporationId: c._id.toString(),
      marketCapAnchor: (c.sharePrice ?? 0) * (c.totalShares ?? 0),
      // Absent publicFloat is UNKNOWN, not zero. Passing 0 here would exclude
      // every corporation that has never had float recorded.
      freeFloatRatio:
        c.publicFloat !== undefined && (c.totalShares ?? 0) > 0
          ? c.publicFloat / (c.totalShares as number)
          : undefined,
      insolvent: (c.liquidCapital ?? 0) < 0,
    }))
  );
  const waived = retention?.waivedIds;
  const verdicts = waived
    ? rawVerdicts.map((v) => {
        if (!waived.has(v.corporationId)) return v;
        const failures = failuresAfterWaiver(v.failures, true);
        return { ...v, failures, qualifies: failures.length === 0 };
      })
    : rawVerdicts;

  const { qualifiedIds, streaks, droppedIds } = applyListingRetention({
    verdicts,
    // With no retention state (a caller that does not persist streaks) every
    // corporation is an applicant, so the bar applies immediately. That is the
    // strict reading, not the lenient one.
    incumbentIds: retention?.incumbentIds ?? new Set(),
    priorStreaks: retention?.priorStreaks ?? new Map(),
  });

  const passed: IndexFundCandidate[] = [];
  for (const corp of corporations) {
    if (qualifiedIds.has(corp._id.toString())) passed.push(corp);
  }
  return { passed, streaks, droppedIds };
}

export function buildIndexFundTargetConstituents(input: {
  corporations: IndexFundCandidate[];
  definition: IndexFundTargetDefinition;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  /**
   * Retention state for the grace period. Omitted by callers that hold no
   * position (previews, tests of pure weighting), where every corporation is an
   * applicant and the bar applies on the spot.
   */
  retention?: {
    incumbentIds: Set<string>;
    priorStreaks: Map<string, number>;
    waivedIds?: Set<string>;
  };
}): {
  constituents: WeightedIndexFundConstituent[];
  streaks: ListingFailureStreak[];
  droppedIds: string[];
} {
  const topN = input.definition.topN ?? (input.definition.scope === "global" ? 50 : undefined);
  // Standards are applied to the corporations that match THIS index's mandate,
  // so the size bar is relative to the peers a fund would actually choose
  // between, not to every listed corporation in the world.
  const eligible = input.corporations.filter((corporation) =>
    isEligibleIndexFundConstituent(corporation, input.definition)
  );
  const screened = screenListingStandards(eligible, input.retention);
  const ranked = screened.passed
    .map((corporation) => {
      const marketCapAnchor = convertLocalMarketCapToFundAnchor({
        localMarketCap: corporation.sharePrice * corporation.totalShares,
        localCurrencyCode: corporation.liquidCurrencyCode,
        fundAnchorCurrencyCode: input.definition.anchorCurrencyCode,
        exchangeRates: input.exchangeRates,
      });
      return marketCapAnchor
        ? {
            corporationId: corporation._id,
            marketCapAnchor,
          }
        : null;
    })
    .filter((row): row is { corporationId: ObjectId; marketCapAnchor: number } => row !== null)
    .sort(
      (a, b) =>
        b.marketCapAnchor - a.marketCapAnchor ||
        a.corporationId.toString().localeCompare(b.corporationId.toString())
    )
    .slice(0, topN);

  const totalMarketCapAnchor = ranked.reduce((sum, row) => sum + row.marketCapAnchor, 0);
  if (totalMarketCapAnchor <= 0) {
    return { constituents: [], streaks: screened.streaks, droppedIds: screened.droppedIds };
  }

  return {
    constituents: ranked.map((row, index) => ({
      corporationId: row.corporationId,
      marketCapAnchor: row.marketCapAnchor,
      targetWeight: row.marketCapAnchor / totalMarketCapAnchor,
      rank: index + 1,
    })),
    streaks: screened.streaks,
    droppedIds: screened.droppedIds,
  };
}
