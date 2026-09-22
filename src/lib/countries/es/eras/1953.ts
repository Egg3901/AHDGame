import type { CountryEraOverride } from "../../contract";

/**
 * ES, 1953.
 *
 * ⚠ GENERATED from `__snapshots__/es.pre-move.json`. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-eras.ts ES --force
 *
 * ⚠ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No per-era orders of battle: this era falls back to the base set rather
 * than inventing an empty one.
 */
export const ES_1953: CountryEraOverride = {
  preset: "1953-default",
  config: {
    /*
     * ⚠️ EXPLICITLY `undefined`, AND THE KEY MUST BE PRESENT. `getCountryConfig`
     * shallow-merges this over the base config, so an explicit `undefined`
     * CLEARS the base's upper-chamber election system while simply omitting the
     * key leaves it in place. This era has no elected upper chamber; dropping
     * the key silently restores one.
     */
    upperElectionSystem: undefined,
    usdExchangeRate: 0.025252525252525252,
    executiveTitle: "Caudillo",
    headOfStateTitle: "Jefe del Estado",
    governmentType: "onePartyState",
    governmentTypeLabel: "One Party State",
    regionLabel: "Province",
    regionLabelPlural: "Provinces",
    rulingPartyId: 1,
    majorPartyIds: ["es_fet"],
    coalitionThreshold: 176,
    legislature: {
      name: "Cortes Españolas",
      path: "/country/es/legislature",
      bicameral: false,
      lowerChamber: {
        key: "congresoDiputados",
        name: "Cortes Españolas",
        shortName: "Cortes",
        seats: 350,
        description:
          "350 procuradores of the Cortes Españolas — a corporatist chamber seated by 'organic democracy' (syndicates, municipalities, families, and direct Franco appointment), not by competitive election.",
        elected: false,
      },
    },
    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    officeTypes: [
      {
        key: "caudillo",
        label: "Caudillo",
        labelPlural: "Caudillos",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 0,
        actionBonus: 4,
        partyStrengthWeight: 1,
      },
      {
        key: "procurador",
        label: "Procurador",
        labelPlural: "Procuradores",
        chamberKey: "congresoDiputados",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Banco de España",
        labelPlural: "Governors of the Banco de España",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    tagline:
      "Franco's Spain - a one-party dictatorship under the Caudillo, with FET as the sole Movimiento party and a corporatist Cortes Españolas.",
    descriptor:
      "A one-party state where Franco governs as both Jefe del Estado and Caudillo through FET y de las JONS; the 350-seat Cortes Españolas is a corporatist appointed chamber, and Spain is organised into provinces rather than autonomous communities.",
    executiveLabel: "El Pardo",
  },
};
