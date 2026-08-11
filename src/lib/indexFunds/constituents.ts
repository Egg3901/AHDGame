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
>;

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

export function buildIndexFundTargetConstituents(input: {
  corporations: IndexFundCandidate[];
  definition: IndexFundTargetDefinition;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
}): WeightedIndexFundConstituent[] {
  const topN = input.definition.topN ?? (input.definition.scope === "global" ? 50 : undefined);
  const ranked = input.corporations
    .filter((corporation) => isEligibleIndexFundConstituent(corporation, input.definition))
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
  if (totalMarketCapAnchor <= 0) return [];

  return ranked.map((row, index) => ({
    corporationId: row.corporationId,
    marketCapAnchor: row.marketCapAnchor,
    targetWeight: row.marketCapAnchor / totalMarketCapAnchor,
    rank: index + 1,
  }));
}
