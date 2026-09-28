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
    ],
  };
}
