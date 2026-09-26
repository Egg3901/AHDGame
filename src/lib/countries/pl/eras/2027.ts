import type { CountryEraOverride } from "../../contract";

/**
 * Poland, 2027: the Third-Republic parliamentary republic resting on the
 * latest completed parliamentary election, the October 2023 Sejm and Senate
 * vote. The National Electoral Commission portal records PiS 194, Civic
 * Coalition (KO) 157, Third Way 65, Left 26 and Confederation 18 in the
 * 460-seat Sejm; the KO-Third Way-Left majority formed Donald Tusk's
 * cabinet in December 2023.
 * https://sejmsenat2023.pkw.gov.pl/sejmsenat2023/
 * The latest completed election of any kind is the June 2025 presidential
 * runoff, won by Karol Nawrocki (50.89%) over Rafal Trzaskowski (49.11%),
 * in office from August 2025 for a five-year term.
 * https://prezydent2025.pkw.gov.pl/prezydent2025/
 *
 * The Sejm is elected by proportional representation (d'Hondt in law;
 * `pr_hareQuota` is the game's closest proportional method, the same
 * approximation the 1991 override uses) and the Senate by first-past-the
 * post in 100 single-member constituencies. The presidency is filled by
 * direct popular vote, which `headOfStateSelection` cannot express (its
 * union covers only one-party sync and legislature appointment), so the
 * field is left undefined exactly as the 1991 override leaves it.
 */
export const PL_2027: CountryEraOverride = {
  preset: "2027-default",
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
        description:
          "460 deputies elected by proportional representation to four-year terms, resting on the October 2023 result.",
        elected: true,
      },
      upperChamber: {
        key: "senat",
        name: "Senate",
        shortName: "Senate",
        seats: 100,
        description:
          "100 senators elected by first-past-the-post in single-member constituencies to four-year terms.",
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
      singleMemberConstituencies: true,
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
    tagline: "A Central European parliamentary republic following the 2023 election.",
    descriptor:
      "The Prime Minister governs with the confidence of the 460-seat Sejm, elected by proportional vote, alongside the 100-seat Senate and a directly elected President.",
  },
};
