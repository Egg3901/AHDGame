import type { CountryEraOverride } from "../../contract";

/**
 * CN, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/cn.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts CN --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const CN_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 1,
    coalitionThreshold: 614,
    onePartyRegionalBudget: {
      localTaxRetentionShare: 0.4,
      corporateProfitRatio: 0.06,
      centralTransferPerCapita: 2.77,
      defaultTaxRate: 25,
      primaryTaxLegislationKey: "cn_enterprise_income_tax",
      resourceTaxLegislationKey: "cn_provincial_resource_tax",
      resourceExtractionRatio: 0.03,
      businessTaxConsumptionRatio: 0.5,
      businessTaxRate: 24,
    },
    legislature: {
      name: "National People's Congress",
      path: "/country/cn/legislature",
      bicameral: false,
      upperChamber: {
        key: "cppcc",
        name: "CPPCC",
        shortName: "CPPCC",
        seats: 2169,
        description:
          "Members of the Chinese People's Political Consultative Conference - an advisory body representing diverse social and economic constituencies.",
      },
      lowerChamber: {
        key: "npc",
        name: "National People's Congress",
        shortName: "NPC",
        seats: 1226,
        description: "1,226 deputies of the First National People's Congress (1954 convocation).",
      },
    },
  },
};
