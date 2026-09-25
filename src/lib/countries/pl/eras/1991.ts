import type { CountryEraOverride } from "../../contract";

/**
 * Poland at the start of 1991: Wałęsa's presidency, a parliamentary cabinet,
 * and the bicameral Sejm and Senate restored after the 1989 amendments.
 * The October 1991 election opens all 460 Sejm and 100 Senate seats.
 * Sources: 1991 Sejm electoral law, arts. 1-2,
 * https://api.sejm.gov.pl/eli/acts/DU/1991/252/text.html ; Inter-Parliamentary
 * Union 1991 election record,
 * https://data.ipu.org/election-summary/PDF/POLAND_1991_E.PDF .
 */
export const PL_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    rulingPartyId: undefined,
    headOfStateSelection: undefined,
    coalitionThreshold: 231,
    legislature: {
      name: "National Assembly",
      path: "/country/pl/legislature",
      bicameral: true,
      lowerChamber: {
        key: "sejm",
        name: "Sejm",
        shortName: "Sejm",
        seats: 460,
        description: "460 deputies elected through proportional representation.",
        elected: true,
      },
      upperChamber: {
        key: "senat",
        name: "Senate",
        shortName: "Senate",
        seats: 100,
        description:
          "100 elected senators, two per voivodeship with extra seats for Warsaw and Katowice.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },
    upperElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      upperChamber: "fptp",
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
        termYears: 5,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "sejmDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "sejm",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "senator",
        label: "Senator",
        labelPlural: "Senators",
        chamberKey: "senat",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "President of the NBP",
        labelPlural: "Presidents of the NBP",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
  },
};
