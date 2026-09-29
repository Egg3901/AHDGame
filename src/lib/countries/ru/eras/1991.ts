import type { CountryEraOverride } from "../../contract";
import { turnToGameMonth } from "@/lib/utils/gameDate";

/** The direct presidential election was June 12; the office changed hands at
 * the July 10 inauguration. The game calendar resolves dates by month.
 * https://www.prlib.ru/section/2121879
 * https://www.prlib.ru/node/405940
 */
export function ru1991PresidencyStage(
  calendarTurn: number
): "chairman" | "elected" | "inaugurated" {
  const { year, month } = turnToGameMonth(calendarTurn, 1991);
  if (year > 1991 || (year === 1991 && month >= 6)) return "inaugurated";
  if (year === 1991 && month >= 5) return "elected";
  return "chairman";
}

/** Month-level representation of the 1993 constitutional crisis. Congress
 * ceased operating after the September 21 decree; the December 12 vote chose
 * the first Federal Assembly under the new constitution. The new chambers
 * first sat on January 12, 1994. The game calendar cannot express days.
 * https://www.prlib.ru/news/2038679
 * https://www.constitution.ru/en/10003000-10.htm
 * https://data.ipu.org/election-summary/HTML/2263_93.htm
 */
export function ru1993LegislatureStage(
  calendarTurn: number
): "congress" | "dissolved" | "elected" | "federalAssembly" {
  const { year, month } = turnToGameMonth(calendarTurn, 1991);
  if (year >= 1994) return "federalAssembly";
  if (year === 1993 && month >= 11) return "elected";
  if (year === 1993 && month >= 8) return "dissolved";
  return "congress";
}

/**
 * January 1991 RSFSR, before the presidency was created in April and first
 * elected in June and inaugurated in July. The 1990 Congress of People's Deputies had 1,068 directly
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
export const RU_RUSSIAN_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    name: "Russia",
    flagEmoji: "🇷🇺",
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

/**
 * The January 1991 RU slot is the Soviet Union. Congress had 2,250 seats and
 * chose the 542-member Supreme Soviet from its own deputies. The game keeps
 * Congress as its electoral chamber; the inner Supreme Soviet is not a second
 * independently elected chamber. Mikhail Gorbachev held the Soviet presidency,
 * created in 1990; the Cabinet of Ministers had replaced the Council of
 * Ministers by the 1991 opening. The federal seat map is a bounded regional
 * proxy, documented in sovietUnionRegions1991.ts.
 * https://data.ipu.org/election-summary/PDF/USSR_1989.PDF
 * https://www.mofa.go.jp/policy/other/bluebook/1990/1990-3-4.htm
 * https://www.prlib.ru/item/1407329?mode=rusmarc
 */
export const RU_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    name: "Soviet Union",
    flagEmoji: "🇸🇺",
    executiveTitle: "Chairman of the Cabinet of Ministers",
    headOfStateTitle: "President of the Soviet Union",
    executiveRealmPhrase: "the Soviet Union",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Transitional Soviet Presidency",
    rulingPartyId: undefined,
    headOfStateSelection: "legislatureAppointment",
    coalitionThreshold: 1_126,
    regionLabel: "Economic Region",
    regionLabelPlural: "Economic Regions",
    legislature: {
      name: "Congress of People's Deputies of the Soviet Union",
      path: "/country/ru/legislature",
      bicameral: false,
      lowerChamber: {
        key: "unionCongress",
        name: "Congress of People's Deputies of the Soviet Union",
        shortName: "Union Congress",
        seats: 2_250,
        description:
          "The 1989 Congress had 1,500 territorial and national-territorial deputies plus 750 representatives of public organizations. It selected the inner Supreme Soviet.",
        elected: true,
      },
      upperChamber: undefined,
    },
    subNationalChamber: undefined,
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: false,
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
        key: "chairmanOfCabinet",
        label: "Chairman of the Cabinet of Ministers",
        labelPlural: "Chairmen of the Cabinet of Ministers",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1,
      },
      {
        key: "sovietPresident",
        label: "President of the Soviet Union",
        labelPlural: "Presidents of the Soviet Union",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1,
      },
      {
        key: "unionCongressDeputy",
        label: "Union People's Deputy",
        labelPlural: "Union People's Deputies",
        chamberKey: "unionCongress",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
    ],
    majorPartyIds: ["cpsu"],
    priorityProfile: undefined,
  },
};
