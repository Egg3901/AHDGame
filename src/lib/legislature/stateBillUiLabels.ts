import { getRegionalBillAssentTitleForState, type CountryId } from "@/lib/constants/countries";
import { STATUS_LABELS } from "@/lib/legislature/dto/stateLegislature";

/**
 * Status chip text for a raw state bill status string on regional legislature UI, using the
 * correct regional executive title (First Minister, Mayor of London, Governor, etc.).
 *
 * `stateId` is optional so legacy callers without per-state context still resolve
 * to the country-level title.
 */
export function getStateBillStatusDisplayLabel(
  status: string,
  countryId: CountryId,
  stateId?: string | null
): string {
  if (status === "passed") {
    return `Awaiting ${getRegionalBillAssentTitleForState(countryId, stateId)}`;
  }
  return STATUS_LABELS[status] ?? status;
}
