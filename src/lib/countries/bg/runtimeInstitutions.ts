import type { CountryConfig } from "@/lib/constants/countries";

/** The ordinary chamber opens only after its complete election handover. */
export function bg1991OrdinaryAssemblyConfig(config: CountryConfig): CountryConfig {
  return {
    ...config,
    coalitionThreshold: 121,
    legislature: {
      ...config.legislature,
      name: "National Assembly",
      lowerChamber: {
        ...config.legislature.lowerChamber,
        name: "National Assembly",
        seats: 240,
        description: "240 deputies elected from 31 district lists with national party quotas.",
      },
    },
    lowerElectionSystem: {
      ...config.lowerElectionSystem!,
      termYears: 4,
      singleMemberConstituencies: false,
    },
    electionSystems: { ...config.electionSystems, lowerChamber: "pr_dhondt" },
    officeTypes: config.officeTypes.map((office) =>
      office.key === "assemblyDeputy" ? { ...office, termYears: 4 } : office
    ),
  };
}
