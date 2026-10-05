import { PLAYER_RESET_DEFICIT_GDP_SHARE_1991 } from "@/lib/seeds/reference/rules/openingFiscalEnvelope";
import { fitOpeningObligations } from "./openingObligations";

export type ResetOpeningCountry = "US" | "UK" | "JP";

export const SOURCE_SIGNATURE: Record<
  ResetOpeningCountry,
  {
    revenue: number;
    spending: number;
    gdp: number;
    debt: number;
    ceiling: number;
    interest: number;
  }
> = {
  US: {
    revenue: 939_213_600_000,
    spending: 970_213_599_996,
    gdp: 6_200_000_000_000,
    debt: 3_665_000_000_000,
    ceiling: 4_145_000_000_000,
    interest: 0.075,
  },
  UK: {
    revenue: 229_306_050_000,
    spending: 209_256_090_000,
    gdp: 600_000_000_000,
    debt: 194_118_000_000,
    ceiling: 240_000_000_000,
    interest: 0.105,
  },
  JP: {
    revenue: 123_714_000_000_000,
    spending: 126_063_999_999_993,
    gdp: 470_000_000_000_000,
    debt: 172_000_000_000_000,
    ceiling: 195_000_000_000_000,
    interest: 0.058,
  },
};

/** Reviewed period obligation mix, independently guarded from the legacy seed. */
const SOURCE_OPERATING_SIGNATURE = {
  US: 752_823_998_100,
  UK: 220_156_575_000,
  JP: 110_864_060_000_000,
} as const;

/** Foreign aid has no proposed law family but remains a funded period obligation. */
export const STANDALONE_CONTINUITY = {
  US: [],
  UK: [],
  JP: [
    { id: "jp_foreign_affairs_continuity", sourceId: "jp_foreign_aid", amount: 1_736_000_000_000 },
  ],
} as const;

interface OpeningReferenceSource {
  country: string;
  scope: string;
  sourceComponents: readonly {
    sourceId: string;
    annualBooked: number;
    fiscalRole: string;
    replacementRestriction?: string;
  }[];
}

/** Pure shared calibration for opening books, current-law references and later enactment. */
export function fitReviewedOpeningClaims1991(
  country: ResetOpeningCountry,
  references: readonly OpeningReferenceSource[]
) {
  const signature = SOURCE_SIGNATURE[country];
  const fitted = fitOpeningObligations({
    revenue: signature.revenue,
    gdp: signature.gdp,
    interest: Math.round(signature.debt * signature.interest),
    maximumDeficitGdpShare: PLAYER_RESET_DEFICIT_GDP_SHARE_1991,
    obligations: [
      ...references
        .filter((reference) => reference.country === country && reference.scope === "national")
        .flatMap((reference) =>
          reference.sourceComponents
            .filter((component) => component.fiscalRole === "single-booked-owner")
            .map((component) => ({
              sourceId: component.sourceId,
              annualAmount: component.annualBooked,
              protectedTransfer:
                component.replacementRestriction === "protected-transfer" ||
                (country === "UK" && component.sourceId === "uk_local_government_funding"),
            }))
        ),
      ...STANDALONE_CONTINUITY[country].map((account) => ({
        sourceId: account.sourceId,
        annualAmount: account.amount,
      })),
    ],
  });
  if (fitted.sourceOperating !== SOURCE_OPERATING_SIGNATURE[country]) {
    throw new Error(`${country} 1991 source obligations changed; review the v2 fiscal bridge`);
  }
  return fitted;
}
