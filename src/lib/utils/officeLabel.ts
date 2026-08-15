import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { OfficeType } from "@/lib/db/types";

/**
 * Resolve the human-readable office label for a player. Reads the country's
 * `officeTypes` config so each country surfaces its own labels
 * (US: "President" / "Representative"; CN: "Premier" / "NPC Delegate";
 * UK: "Member of Parliament"; etc.) instead of falling back to "Office
 * Holder" for non-US offices.
 *
 * Reflects per-country office tables in `src/lib/constants/countries.ts`.
 * Shared between the state Politics tab's PlayersList and the Overview tab's
 * PlayerRoster so both surfaces label offices identically.
 */
export function officeLabelFor(countryId: CountryId, currentOffice: OfficeType | null): string {
  if (!currentOffice) return "Private Citizen";
  const config = COUNTRY_CONFIGS[countryId];
  const match = config?.officeTypes.find((o) => o.key === currentOffice.type);
  if (!match) return "Office Holder";
  // US House is the only office that surfaces seat-count in the label.
  if (
    countryId === COUNTRY_CONFIGS.US.id &&
    currentOffice.type === "house" &&
    "seatsHeld" in currentOffice &&
    typeof currentOffice.seatsHeld === "number"
  ) {
    const seats = currentOffice.seatsHeld;
    return `${match.label} (${seats} seat${seats === 1 ? "" : "s"})`;
  }
  return match.label;
}
