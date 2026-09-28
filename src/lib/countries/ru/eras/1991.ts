import type { CountryEraOverride } from "../../contract";

/**
 * January 1991 RSFSR, before the presidency was created in April and first
 * filled in June. The 1990 Congress of People's Deputies had 1,068 directly
 * elected members and chose the 252-member Supreme Soviet from among them.
 * The Congress is the public electoral chamber in this one-chamber game model;
 * treating the inner Supreme Soviet as a separately elected upper chamber
 * would reproduce the USSR's institutions, not the RSFSR's.
 *
 * https://www.prlib.ru/news/2038679
 * https://www.prlib.ru/node/619190
 *
 * The Congress and its Supreme Soviet ceased under the 1993 constitutional
 * transition. That dated replacement and the June 1991 presidential election
 * need distinct runtime transitions; this start configuration is not a
 * permanent constitutional model for a 1991-to-2027 simulation.
 * https://www.constitution.ru/10003000/10003000-12.htm
 */
export const RU_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    executiveTitle: "Chairman of the Council of Ministers",
    headOfStateTitle: "Chairman of the Supreme Soviet",
    executiveRealmPhrase: "Russia",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Transitional Parliamentary Republic",
    rulingPartyId: undefined,
    headOfStateSelection: "legislatureAppointment",
    coalitionThreshold: 535,
    regionLabel: "Economic Region",
    regionLabelPlural: "Economic Regions",
    legislature: {
      name: "Congress of People's Deputies",
      path: "/country/ru/legislature",
      bicameral: false,
      lowerChamber: {
        key: "congressOfPeoplesDeputies",
        name: "Congress of People's Deputies",
        shortName: "Congress",
        seats: 1_068,
        description:
          "1,068 deputies elected in 1990; the Congress chose the permanent Supreme Soviet from its own members.",
        elected: true,
      },
      upperChamber: undefined,
    },
    subNationalChamber: undefined,
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    upperElectionSystem: undefined,
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    officeTypes: [
      {
        key: "primeMinister",
        label: "Chairman of the Council of Ministers",
        labelPlural: "Chairmen of the Council of Ministers",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1,
      },
      {
        key: "chairmanOfSupremeSoviet",
        label: "Chairman of the Supreme Soviet",
        labelPlural: "Chairmen of the Supreme Soviet",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "congressDeputy",
        label: "People's Deputy",
        labelPlural: "People's Deputies",
        chamberKey: "congressOfPeoplesDeputies",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
    ],
    majorPartyIds: ["cpsu", "dr", "dpr"],
    priorityProfile: undefined,
  },
};
