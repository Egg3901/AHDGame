import type { CountryEraOverride } from "../../contract";

/**
 * TR, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/tr.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts TR --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const TR_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    /*
     * ⚠️ EXPLICITLY `undefined`, AND THE KEY MUST BE PRESENT. `getCountryConfig`
     * shallow-merges this over the base config, so an explicit `undefined`
     * CLEARS the base's upper-chamber election system while simply omitting the
     * key leaves it in place. This era has no elected upper chamber; dropping
     * the key silently restores one.
     */
    upperElectionSystem: undefined,
    usdExchangeRate: 0.35714285714285715,
    majorPartyIds: ["tr_dp", "tr_chp"],
    coalitionThreshold: 244,
    legislature: {
      name: "Grand National Assembly",
      path: "/country/tr/legislature",
      bicameral: false,
      lowerChamber: {
        key: "milletMeclisi",
        name: "Grand National Assembly",
        shortName: "Meclis",
        seats: 487,
        description:
          "487 deputies of the unicameral Türkiye Büyük Millet Meclisi (1950 election size; Senate created only by the 1961 constitution).",
        elected: true,
      },
    },
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    officeTypes: [
      {
        key: "primeMinister",
        label: "Prime Minister",
        labelPlural: "Prime Ministers",
        isExecutive: true,
        isSubNational: false,
        termYears: 4,
        actionBonus: 4,
        partyStrengthWeight: 1,
      },
      {
        key: "president",
        label: "President",
        labelPlural: "Presidents",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 7,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "deputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "milletMeclisi",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Central Bank of Turkey",
        labelPlural: "Governors of the Central Bank of Turkey",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    tagline:
      "Menderes's Democrat Party republic — a unicameral Grand National Assembly, NATO membership since 1952, and deepening secular–conservative rivalry.",
    descriptor:
      "A parliamentary republic where a Prime Minister governs at the confidence of a unicameral 487-seat Grand National Assembly (TBMM); no Senate existed until the 1961 constitution.",
  },
};
