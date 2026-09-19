import type { CountryEraOverride } from "../../contract";

/**
 * SE, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/se.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts SE --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const SE_1953: CountryEraOverride = {
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
    usdExchangeRate: 0.19342359767891684,
    majorPartyIds: ["se_sap", "se_h"],
    coalitionThreshold: 116,
    legislature: {
      name: "Riksdag",
      path: "/country/se/legislature",
      bicameral: false,
      upperChamber: {
        key: "forstaKammaren",
        name: "First Chamber",
        shortName: "Första kammaren",
        seats: 150,
        description:
          "150 members indirectly elected by county and city councils on staggered eight-year terms. May revise or delay legislation, but the Second Chamber ultimately prevails. Not player-managed.",
      },
      lowerChamber: {
        key: "riksdag",
        name: "Second Chamber",
        shortName: "Andra kammaren",
        seats: 230,
        description:
          "230 members elected by proportional representation — the directly elected, confidence-giving chamber of the bicameral Riksdag.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
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
        key: "monarch",
        label: "King",
        labelPlural: "Kings",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 0,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "member",
        label: "Member of the Second Chamber",
        labelPlural: "Members of the Second Chamber",
        chamberKey: "riksdag",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Riksbank",
        labelPlural: "Governors of the Riksbank",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    tagline:
      "Erlander's Social Democratic Sweden — a bicameral Riksdag, Cold War neutrality, and the expanding welfare state.",
    descriptor:
      "A constitutional monarchy with a bicameral Riksdag: a 230-seat directly elected Second Chamber and a 150-seat First Chamber indirectly elected by local councils.",
  },
};
