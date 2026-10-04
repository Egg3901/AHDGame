import type { CountryEraOverride } from "../../contract";
import { INITIAL_RATES_1991 } from "@/lib/constants/currencies";

/**
 * January 1991 SFRY institutions, before the federation broke apart.
 * The 1974 constitution provided a 220-seat Federal Chamber and an 88-seat
 * Council of Republics and Provinces. The federal executive was the Federal
 * Executive Council, alongside an eight-member rotating Presidency. There
 * was no federal multiparty election in 1991; the republics held their own.
 *
 * This is a start-state snapshot, not a claim that SFRY institutions survived
 * the 1991-92 dissolution. A dated succession transition must retire the
 * federal offices and delegations, split republic state, and create the 1992
 * Federal Republic of Yugoslavia for Serbia and Montenegro. Until then the
 * 1991-to-2027 YU political horizon remains incomplete.
 *
 * https://www.arhivyu.rs/en/leksikon-jugoslavije/konstitutivni_akti_jugoslavije
 * https://www.parlament.gov.rs/national-assembly/history/after-second-world-war.534.html
 * https://www.ecoi.net/en/document/1355059.html
 * https://hudoc.echr.coe.int/app/conversion/pdf/?id=001-107425&library=ECHR
 */
export const YU_1991: CountryEraOverride = {
  preset: "1991-default",
  config: {
    // Regional GDP is stored in original local currency, not the accounting unit.
    usdExchangeRate: 1 / INITIAL_RATES_1991.YU!,
    executiveTitle: "Prime Minister",
    headOfStateTitle: "Chair of the Presidency",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Federal Parliamentary Republic",
    rulingPartyId: undefined,
    coalitionThreshold: 111,
    legislature: {
      name: "Federal Assembly",
      path: "/country/yu/legislature",
      bicameral: true,
      lowerChamber: {
        key: "federalAssembly",
        name: "Federal Chamber",
        shortName: "Federal",
        seats: 220,
        description: "220 delegates chosen through the republic and province delegate system.",
        elected: true,
      },
      upperChamber: {
        key: "councilRepublicsProvinces",
        name: "Council of Republics and Provinces",
        shortName: "Republics",
        seats: 88,
        description: "Twelve delegates per republic and eight per autonomous province.",
        elected: false,
      },
    },
    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },
    headOfStateSelection: undefined,
    majorPartyIds: ["srsj", "sps", "hdz", "sda", "demos", "skcg", "vmro-dpmne"],
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
        label: "Chair of the Presidency",
        labelPlural: "Chairs of the Presidency",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 1,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "assemblyDelegate",
        label: "Federal Delegate",
        labelPlural: "Federal Delegates",
        chamberKey: "federalAssembly",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "councilDelegate",
        label: "Republic or Province Delegate",
        labelPlural: "Republic or Province Delegates",
        chamberKey: "councilRepublicsProvinces",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "Governor of the NBY",
        labelPlural: "Governors of the NBY",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
  },
};
