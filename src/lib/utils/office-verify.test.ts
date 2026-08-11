import { describe, it, expect } from "vitest";
import { getOfficeLabel } from "@/lib/utils/politics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * Country-completeness guard for {@link getOfficeLabel}.
 *
 * Every office type declared in a country's config must resolve to a real,
 * human-readable label — never the bare key (e.g. "npcDelegate") or an empty
 * string. This is the regression that broke the CCP party-member roster
 * (fix/office-list): non-US office keys fell through to a US-only map / the
 * raw-key default branch. Looping the configs means any future country or
 * office type is covered automatically.
 */
describe("getOfficeLabel resolves every office type in every country", () => {
  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    for (const office of COUNTRY_CONFIGS[countryId].officeTypes) {
      it(`${countryId}/${office.key} renders the configured label, not the raw key`, () => {
        const label = getOfficeLabel({ type: office.key, state: "XX", seatsHeld: 1 }, countryId);
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toBe(office.key);
        expect(label).not.toBe(`${office.key} (XX)`);
        // Non-executive offices surface their config label verbatim; executives
        // use "{label} of {realm}" phrasing which still contains the label.
        expect(label.includes(office.label) || office.isExecutive).toBe(true);
      });
    }
  }
});
