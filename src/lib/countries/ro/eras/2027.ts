import type { CountryEraOverride } from "../../contract";

/**
 * Semi-presidential Romania for the 2027 preset. The 1 December 2024
 * legislative election is the latest completed parliamentary election:
 * Chamber of Deputies (331 seats) — PSD 86, AUR 63, PNL 49, USR 40,
 * SOS Romania 28, POT 24, UDMR 22, national minorities 19; Senate
 * (134 seats) — PSD 36, AUR 28, PNL 22, USR 19, SOS 12, UDMR 10, POT 7.
 * Official results: the Permanent Electoral Authority portal
 * https://prezenta.roaep.ro and the Central Electoral Bureau
 * https://www.bec.ro .
 *
 * The game has no closed-list PR method with a 5% threshold, so both
 * chambers read `pr_hareQuota` (the closest in-tree proportional method)
 * until a dedicated one exists; the directly elected presidency reads
 * `fptp` like France's. The difference is explicit here so election replay
 * can test it. `headOfStateSelection` is cleared (direct election replaces
 * the base `partyChairSync`), as is the one-party `rulingPartyId`.
 *
 * usdExchangeRate is USD per leu implied by the 2024 anchors: World Bank
 * nominal GDP USD 382.56B (https://data.worldbank.org/country/romania)
 * over INSSE 2024 GDP RON 1,766,067.6M
 * (https://insse.ro/cms/sites/default/files/com_presa/com_pdf/pib_tr4e2024_1.pdf).
 */
export const RO_2027: CountryEraOverride = {
  preset: "2027-default",
  config: {
    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    governmentType: "presidential",
    governmentTypeLabel: "Semi-Presidential Republic",
    coalitionThreshold: 233,
    legislature: {
      name: "Parliament",
      path: "/country/ro/legislature",
      bicameral: true,
      lowerChamber: {
        key: "chamberOfDeputies",
        name: "Chamber of Deputies",
        shortName: "Chamber",
        seats: 331,
        description:
          "331 deputies elected for four-year terms by closed-list proportional representation with a 5% national threshold.",
        elected: true,
      },
      upperChamber: {
        key: "senat",
        name: "Senate",
        shortName: "Senate",
        seats: 134,
        description:
          "134 senators elected for four-year terms by closed-list proportional representation with a 5% national threshold.",
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
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1,
      },
      {
        key: "primeMinister",
        label: "Prime Minister",
        labelPlural: "Prime Ministers",
        isExecutive: true,
        isSubNational: false,
        termYears: 4,
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
        label: "Governor of the BNR",
        labelPlural: "Governors of the BNR",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    rulingPartyId: undefined,
    majorPartyIds: ["psd", "aur", "pnl", "usr"],
    usdExchangeRate: 0.2166,
    exchangeName: "Bucharest Stock Exchange",
    exchangeKind: "market",
    centralGovernmentLabel: "National Government",
    executiveLabel: "Prime Minister's Office",
    tagline: "A Black Sea semi-presidential republic following the 2024 election.",
    descriptor:
      "The Prime Minister governs with the confidence of the 331-seat Chamber of Deputies and the 134-seat Senate, both elected by closed-list proportional vote.",
  },
};
