import type { CountryEraOverride } from "../../contract";

/**
 * Czechoslovakia's 1990 multiparty Federal Assembly. Each chamber elected
 * 150 deputies for the shortened two-year constitutional transition term;
 * the Chamber of Nations divided its seats 75/75 between the Czech and Slovak
 * republics. The 1991 region bundle apportions both chambers accordingly.
 * https://www.csce.gov/publications/elections-czech-and-slovak-federal-republic/
 * https://digitallibrary.un.org/record/226768/files/E_ECE_RW_HLM_6_Add.1-EN.pdf
 */
export const CS_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    rulingPartyId: undefined,
    coalitionThreshold: 76,
    legislature: {
      name: "Federal Assembly",
      path: "/country/cs/legislature",
      bicameral: true,
      lowerChamber: {
        key: "chamberOfThePeople",
        name: "Chamber of the People",
        shortName: "People",
        seats: 150,
        description: "150 deputies elected by proportional representation in 1990.",
        elected: true,
      },
      upperChamber: {
        key: "chamberOfNations",
        name: "Chamber of Nations",
        shortName: "Nations",
        seats: 150,
        description: "150 deputies, equally divided between the Czech and Slovak republics.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 2,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },
    upperElectionSystem: {
      termYears: 2,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      upperChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "legislatureAppointment",
    officeTypes: [
      {
        key: "primeMinister",
        label: "Prime Minister",
        labelPlural: "Prime Ministers",
        isExecutive: true,
        isSubNational: false,
        termYears: 2,
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
        chamberKey: "chamberOfThePeople",
        isExecutive: false,
        isSubNational: false,
        termYears: 2,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "nationsDeputy",
        label: "Deputy of Nations",
        labelPlural: "Deputies of Nations",
        chamberKey: "chamberOfNations",
        isExecutive: false,
        isSubNational: false,
        termYears: 2,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "Governor of the SBČS",
        labelPlural: "Governors of the SBČS",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["of", "vpn", "ksc", "kdh"],
  },
};
