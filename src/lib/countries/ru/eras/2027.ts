import type { CountryEraOverride } from "../../contract";

/**
 * Presidential Russian Federation for the 2027 preset. The 17-19 September
 * 2021 State Duma election is the latest completed parliamentary election:
 * 450 seats — United Russia 324, KPRF 57, A Just Russia - For Truth 27,
 * LDPR 21, New People 13. Official results: the Central Election
 * Commission portal http://www.vybory.izbirkom.ru/ .
 *
 * The Duma elects 225 deputies in single-member constituencies and 225 by
 * party list with a 5% threshold. The game has one mixed-member method
 * (`ams`); it approximates Russia's parallel mixed system until a dedicated
 * method exists. The difference is explicit here so election replay can
 * test it. The presidency is directly elected by two-round majority vote;
 * the game has no runoff method, so it reads `fptp` like France's. The
 * Federation Council (178 members, two delegated per federal subject) is
 * not popularly elected, so it reads `elected: false` and carries no
 * election system. `headOfStateSelection` is cleared (direct election
 * replaces the base `legislatureAppointment`), as is the one-party
 * `rulingPartyId`.
 *
 * usdExchangeRate is USD per ruble implied by the 2024 anchors: World Bank
 * nominal GDP USD 2,173,836M (https://data.worldbank.org/country/russian-federation)
 * over Rosstat 2024 GDP RUB 201,152,000M (revised; first estimate
 * RUB 200,039,500M).
 */
export const RU_2027: CountryEraOverride = {
  preset: "2027-default",
  config: {
    executiveTitle: "President",
    headOfStateTitle: "President",
    governmentType: "presidential",
    governmentTypeLabel: "Presidential Federation",
    coalitionThreshold: 226,
    legislature: {
      name: "Federal Assembly",
      path: "/country/ru/legislature",
      bicameral: true,
      lowerChamber: {
        key: "stateDuma",
        name: "State Duma",
        shortName: "Duma",
        seats: 450,
        description:
          "450 deputies elected for five-year terms, with 225 single-member constituencies and 225 party-list seats subject to a 5% threshold.",
        elected: true,
      },
      upperChamber: {
        key: "federationCouncil",
        name: "Federation Council",
        shortName: "Federation Council",
        seats: 178,
        description:
          "178 members delegated two per federal subject by regional legislatures and executives; not popularly elected.",
        elected: false,
      },
    },
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: true,
    },
    electionSystems: {
      lowerChamber: "ams",
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
        termYears: 6,
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
        key: "dumaDeputy",
        label: "Duma Deputy",
        labelPlural: "Duma Deputies",
        chamberKey: "stateDuma",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "federationCouncilMember",
        label: "Federation Council Member",
        labelPlural: "Federation Council Members",
        chamberKey: "federationCouncil",
        isExecutive: false,
        isSubNational: false,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Bank of Russia",
        labelPlural: "Governors of the Bank of Russia",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    rulingPartyId: undefined,
    majorPartyIds: ["er", "kprf", "ldpr", "srzp", "np"],
    usdExchangeRate: 0.01081,
    exchangeName: "Moscow Exchange",
    exchangeKind: "market",
    centralGovernmentLabel: "Federal Government",
    executiveLabel: "Presidential Administration",
    tagline: "A transcontinental presidential federation following the 2021 Duma election.",
    descriptor:
      "The President governs with a Prime Minister accountable to the 450-seat State Duma, elected by a mixed constituency and list vote, alongside the 178-member delegated Federation Council.",
  },
};
