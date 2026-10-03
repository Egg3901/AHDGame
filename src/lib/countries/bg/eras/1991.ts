import type { CountryEraOverride } from "../../contract";

/**
 * Bulgaria begins 1991 with the multiparty Seventh Grand National Assembly
 * elected in June 1990. It sat with 400 deputies until 2 October 1991; the
 * ordinary 240-seat Assembly first met on 4 November after the 13 October poll.
 * The start preset describes the Grand Assembly. The turn processor changes
 * the live regional and formation seat counts after the October 1991 election
 * once the game calendar reaches November.
 *
 * https://www.parliament.bg/en/16
 * https://data.ipu.org/election-summary/HTML/2045_90.htm
 * https://data.ipu.org/election-summary/PDF/BULGARIA_1991_E.PDF
 * `ams` approximates the 1990 parallel half constituency, half list system
 * until the election engine has a separate parallel mixed method.
 */
export const BG_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    rulingPartyId: undefined,
    coalitionThreshold: 201,
    legislature: {
      name: "Grand National Assembly",
      path: "/country/bg/legislature",
      bicameral: false,
      lowerChamber: {
        key: "nationalAssembly",
        name: "Grand National Assembly",
        shortName: "Assembly",
        seats: 400,
        description: "400 deputies elected in the multiparty June 1990 election.",
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
      lowerChamber: "ams",
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
    majorPartyIds: ["bsp", "sds", "dps", "bzns"],
  },
};
