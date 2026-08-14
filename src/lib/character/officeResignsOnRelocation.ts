import type { OfficeType } from "@/lib/db/types/character";

/**
 * Whether relocating should auto-vacate `currentOffice`.
 *
 * Country-scoped seats (President, VP, cabinet, chancellor, …) have no home-state
 * stamp and survive an in-country move — same pattern as central-bank chair and
 * NatCorp CEO residency. State/region-bound seats (governor, house, senate, …)
 * still resign. Cross-country moves vacate every office.
 */
export function officeResignsOnRelocation(
  office: OfficeType | null | undefined,
  countryChanged: boolean
): boolean {
  if (!office) return false;
  if (countryChanged) return true;
  return officeHasStateResidency(office);
}

/** True when the office is tied to a specific home state/region. */
export function officeHasStateResidency(office: OfficeType | null | undefined): boolean {
  if (!office) return false;
  return "state" in office && typeof office.state === "string" && office.state.length > 0;
}
