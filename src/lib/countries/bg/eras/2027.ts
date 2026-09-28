import type { CountryEraOverride } from "../../contract";

/**
 * The 52nd National Assembly elected on 19 April 2026 has 240 members.
 * The 2027 preset begins from that known constitutional and election state;
 * a later election is decided by play, not pre-seeded as an outcome.
 * https://results.cik.bg/pe202604/hnm.64.html
 * https://www.parliament.bg/en/parliamentarygroups
 */
export const BG_2027: CountryEraOverride = {
  preset: "2027-default",
  config: {
    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    rulingPartyId: undefined,
    coalitionThreshold: 121,
    legislature: {
      name: "National Assembly",
      path: "/country/bg/legislature",
      bicameral: false,
      lowerChamber: {
        key: "nationalAssembly",
        name: "National Assembly",
        shortName: "Assembly",
        seats: 240,
        description: "240 deputies elected by proportional representation for a four-year term.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: undefined,
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
        termYears: 5,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "assemblyDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "nationalAssembly",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the BNB",
        labelPlural: "Governors of the BNB",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["pb", "gerb-sds", "pp-db", "dps", "v"],
  },
};
