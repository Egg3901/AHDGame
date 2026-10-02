import type { CountryConfig } from "@/lib/constants/countries";

/** The Congress and prime minister continue after the July 1991 presidential
 * inauguration. The 1993 constitutional settlement is a separate transition.
 */
export function ru1991PresidentialConfig(config: CountryConfig): CountryConfig {
  return {
    ...config,
    headOfStateTitle: "President",
    headOfStateSelection: undefined,
    governmentTypeLabel: "Transitional Presidential Republic",
    electionSystems: { ...config.electionSystems, headOfState: "fptp" },
    officeTypes: [
      ...config.officeTypes.filter((office) => office.key !== "chairmanOfSupremeSoviet"),
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
        key: "vicePresident",
        label: "Vice President",
        labelPlural: "Vice Presidents",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 2,
        partyStrengthWeight: 1,
      },
    ],
  };
}

export function ru1993DissolvedCongressConfig(config: CountryConfig): CountryConfig {
  return {
    ...config,
    legislature: {
      ...config.legislature,
      name: "Congress of People's Deputies (dissolved)",
      lowerChamber: { ...config.legislature.lowerChamber, seats: 0, elected: false },
    },
    officeTypes: config.officeTypes.filter((office) => office.key !== "congressDeputy"),
  };
}

/** The first Duma and Federation Council were each elected for two years.
 * The 450-seat Duma split 225 single-member seats and 225 list seats; the
 * first 178-member Council was directly elected, unlike its later delegated
 * composition. The macroregion model cannot assign its 89 two-seat subjects.
 * https://www.constitution.ru/en/10003000-06.htm
 * https://www.constitution.ru/en/10003000-10.htm
 * https://www.prlib.ru/item/358718
 * https://data.ipu.org/election-summary/HTML/2263_93.htm
 */
export function ru1993FederalAssemblyConfig(config: CountryConfig): CountryConfig {
  return {
    ...config,
    executiveTitle: "Prime Minister",
    governmentTypeLabel: config.officeTypes.some((office) => office.key === "president")
      ? "Presidential Federation"
      : "Parliamentary Federation",
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
          "First convocation: 225 constituency and 225 party-list deputies, elected for two years in December 1993.",
        elected: true,
      },
      upperChamber: {
        key: "federationCouncil",
        name: "Federation Council",
        shortName: "Federation Council",
        seats: 178,
        description:
          "First convocation: two directly elected members per federal subject, for a two-year term.",
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
      snapElectionsAllowed: false,
    },
    electionSystems: { ...config.electionSystems, lowerChamber: "ams", upperChamber: "fptp" },
    officeTypes: [
      ...config.officeTypes.filter((office) => office.key !== "congressDeputy"),
      {
        key: "dumaDeputy",
        label: "Duma Deputy",
        labelPlural: "Duma Deputies",
        chamberKey: "stateDuma",
        isExecutive: false,
        isSubNational: false,
        termYears: 2,
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
        termYears: 2,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
    ],
  };
}

/** Regional heads and delegates serve through their actual regional authority,
 * while the Council keeps its statutory upper-chamber vote on ordinary laws. */
export function ruRegionalCouncilConfig(
  config: CountryConfig,
  mode: "regionalHeads" | "regionalDelegates"
): CountryConfig {
  if (!config.legislature.upperChamber)
    throw new Error("Regional Council needs its active upper chamber");
  return {
    ...config,
    legislature: {
      ...config.legislature,
      upperChamber: {
        ...config.legislature.upperChamber,
        elected: false,
        participatesInOrdinaryBills: true,
        description:
          mode === "regionalHeads"
            ? "The executive head and legislative chair of each federal subject represent their region ex officio."
            : "Executive and legislative regional authorities appoint separate representatives. Membership follows the appointing authority, with no fixed national election cycle.",
      },
    },
    upperElectionSystem: undefined,
    electionSystems: { ...config.electionSystems, upperChamber: undefined },
    officeTypes: config.officeTypes.map((office) =>
      office.key === "federationCouncilMember" ? { ...office, termYears: undefined } : office
    ),
  };
}
