import type { CountryEraOverride } from "../../contract";

/**
 * Hungary after the 1990 multiparty election. The National Election Office
 * records 386 Assembly seats: 176 constituency, 120 regional-list and 90
 * national-list. The constitutional President is elected by Parliament.
 *
 * https://static.valasztas.hu/v98stat/1990pmand.htm
 * https://www.parlament.hu/documents/125505/138476/The+Constitution/9101ae2d-02d7-4864-b1c4-6d5bdfd2d33c
 *
 * `ams` approximates the historical mixed electoral formula until the game
 * models its separate regional and compensation lists. The region seed already
 * apportions all 386 seats across the six game macroregions.
 */
export const HU_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    rulingPartyId: undefined,
    coalitionThreshold: 194,
    legislature: {
      name: "National Assembly",
      path: "/country/hu/legislature",
      bicameral: false,
      lowerChamber: {
        key: "nationalAssembly",
        name: "National Assembly",
        shortName: "Assembly",
        seats: 386,
        description: "386 deputies elected in a mixed constituency and list system in 1990.",
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
    majorPartyIds: ["mdf", "szdsz", "fkgp", "mszp", "fidesz", "kdnp"],
    exchangeName: "Budapest Stock Exchange",
    exchangeKind: "market",
  },
};
