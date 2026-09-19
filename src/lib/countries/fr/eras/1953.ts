import type { CountryEraOverride } from "../../contract";

/**
 * FR, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/fr.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts FR --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const FR_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    usdExchangeRate: 0.002857142857142857,
    executiveTitle: "President of the Council",
    headOfStateTitle: "President",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    coalitionThreshold: 314,
    legislature: {
      name: "Parliament",
      path: "/country/fr/legislature",
      bicameral: true,
      upperChamber: {
        key: "senat",
        name: "Council of the Republic",
        shortName: "Conseil",
        seats: 320,
        description:
          "320 councillors of the Conseil de la République, elected indirectly by local authorities for six-year terms. A weaker revising chamber under the Fourth Republic.",
        elected: true,
      },
      lowerChamber: {
        key: "assembleeNationale",
        name: "National Assembly",
        shortName: "Assemblée",
        seats: 627,
        description:
          "627 deputies elected in the June 1951 election by proportional representation. The chamber that made and unmade Fourth Republic cabinets.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },
    upperElectionSystem: {
      termYears: 6,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      upperChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    officeTypes: [
      {
        key: "primeMinister",
        label: "President of the Council",
        labelPlural: "Presidents of the Council",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
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
        chamberKey: "assembleeNationale",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "senator",
        label: "Councillor of the Republic",
        labelPlural: "Councillors of the Republic",
        chamberKey: "senat",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Banque de France",
        labelPlural: "Governors of the Banque de France",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    tagline:
      "The Fourth Republic - a ceremonial President and a fragile President of the Council governing through an unstable Assemblée Nationale.",
    descriptor:
      "A parliamentary republic: a President elected by Parliament shares the stage with a President of the Council answerable to the 627-seat National Assembly, with an indirectly-elected Council of the Republic.",
    executiveLabel: "Matignon",
  },
};
