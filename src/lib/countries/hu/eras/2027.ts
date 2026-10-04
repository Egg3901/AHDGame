import type { CountryEraOverride } from "../../contract";

/**
 * Third-Republic Hungary for the 2027 preset. The 2026 National Election
 * Office result is the latest completed parliamentary election: TISZA 141,
 * FIDESZ-KDNP 52, Mi Hazank 6. The National Assembly has 199 seats.
 * https://valtor.valasztas.hu/valtort/jsp/ma1.jsp?EA=47
 *
 * The game has one mixed-member method (`ams`); it approximates Hungary's
 * parallel 106 single-member / 93 list-seat system until a dedicated method
 * exists. The difference is explicit here so election replay can test it.
 */
export const HU_2027: CountryEraOverride = {
  preset: "2027-default",
  config: {
    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    coalitionThreshold: 100,
    legislature: {
      name: "National Assembly",
      path: "/country/hu/legislature",
      bicameral: false,
      lowerChamber: {
        key: "nationalAssembly",
        name: "National Assembly",
        shortName: "Assembly",
        seats: 199,
        description:
          "199 deputies elected for four-year terms, with 106 single-member constituencies and 93 national-list seats.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: true,
    },
    electionSystems: {
      lowerChamber: "ams",
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
        key: "assemblyDelegate",
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
        label: "Governor of the MNB",
        labelPlural: "Governors of the MNB",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    rulingPartyId: undefined,
    majorPartyIds: ["tisza", "fidesz-kdnp", "mi hazank"],
    usdExchangeRate: 1 / 353.2,
    exchangeName: "Budapest Stock Exchange",
    exchangeKind: "market",
    centralGovernmentLabel: "National Government",
    executiveLabel: "Prime Minister's Office",
    tagline: "A Central European parliamentary republic following the 2026 election.",
    descriptor:
      "The Prime Minister governs with the confidence of the 199-seat National Assembly, elected by a mixed constituency and list vote.",
  },
};
