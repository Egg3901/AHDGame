import type { CountryEraOverride } from "../../contract";

/**
 * GR, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/gr.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts GR --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const GR_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.03333333333333333,
    headOfStateTitle: "King",
    governmentType: "parliamentaryMonarchy",
    governmentTypeLabel: "Parliamentary Monarchy",
    majorPartyIds: ["gr_es", "gr_epek"],
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
        key: "deputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "vouli",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Bank of Greece",
        labelPlural: "Governors of the Bank of Greece",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    tagline:
      "The post-civil-war kingdom — Papagos's Greek Rally, American aid, NATO membership since 1952, and a banned communist left regrouping as EDA.",
    descriptor:
      "A parliamentary monarchy where a Prime Minister governs at the confidence of the unicameral 300-seat Vouli under King Paul I; the majoritarian electoral law magnifies pluralities into landslides.",
  },
};
