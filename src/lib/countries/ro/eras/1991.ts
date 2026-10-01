import type { CountryEraOverride } from "../../contract";

/**
 * January 1991 Romania still used the institutions elected in May 1990 under
 * Decree-Law 92/1990. The directly elected president designated the prime
 * minister; the Assembly of Deputies and Senate approved the government.
 * The constituent parliament held 396 deputy and 119 senate mandates.
 *
 * https://legislatie.just.ro/Public/DetaliiDocumentAfis/891
 * https://legislatie.just.ro/public/DetaliiDocument/35408
 * https://legislatie.just.ro/public/DetaliiDocument/92287
 *
 * The constitution took effect in December 1991 and a new parliamentary
 * election followed in 1992. This config records the 1991 starting chamber;
 * the turn transition supplies the 1992 seat counts at election resolution.
 * The 1992 electoral law's national compensation and minority-seat mechanics
 * remain an approximation in the regional PR resolver.
 */
export const RO_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    governmentType: "presidential",
    governmentTypeLabel: "Transitional Semi-Presidential Republic",
    rulingPartyId: undefined,
    coalitionThreshold: 199,
    legislature: {
      name: "Constituent Parliament",
      path: "/country/ro/legislature",
      bicameral: true,
      lowerChamber: {
        key: "chamberOfDeputies",
        name: "Assembly of Deputies",
        shortName: "Assembly",
        seats: 396,
        description: "396 deputies elected in May 1990 under Decree-Law 92/1990.",
        elected: true,
      },
      upperChamber: {
        key: "senat",
        name: "Senate",
        shortName: "Senate",
        seats: 119,
        description: "119 senators elected in May 1990 under Decree-Law 92/1990.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 2,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },
    upperElectionSystem: {
      termYears: 2,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      upperChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "fptp",
    },
    headOfStateSelection: undefined,
    officeTypes: [
      {
        key: "president",
        label: "President",
        labelPlural: "Presidents",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 2,
        actionBonus: 4,
        partyStrengthWeight: 1,
      },
      {
        key: "primeMinister",
        label: "Prime Minister",
        labelPlural: "Prime Ministers",
        isExecutive: true,
        isSubNational: false,
        actionBonus: 3,
        partyStrengthWeight: 1,
      },
      {
        key: "deputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "chamberOfDeputies",
        isExecutive: false,
        isSubNational: false,
        termYears: 2,
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
        termYears: 2,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "Governor of the BNR",
        labelPlural: "Governors of the BNR",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["fsn", "pnl", "pntcd", "udmr"],
    centralGovernmentLabel: "Government of Romania",
    executiveLabel: "Prime Minister's Office",
    tagline: "A newly pluralist republic governed by its 1990 constituent parliament.",
    descriptor:
      "The President appoints a Prime Minister whose government answers to the elected Assembly of Deputies and Senate.",
  },
};
