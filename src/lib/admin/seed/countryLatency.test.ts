import { describe, it, expect } from "vitest";
import { COUNTRY_ORDER, COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { RESET_PRESETS } from "@/lib/constants/historicalSeats";

/**
 * Byelorussia (BLR) and the Baltics (BAL) are constituent Soviet union
 * republics, seeded as RU regions BEL/BLT. No preset seeds them as countries,
 * so they are latent: present in COUNTRY_CONFIGS for type safety and for a
 * future post-1991 era, absent from COUNTRY_ORDER so they are never rendered
 * or given state. Same pattern as SCO/WAL.
 */
describe("BLR and BAL are latent", () => {
  it("keeps configs for a future post-1991 era", () => {
    expect(COUNTRY_CONFIGS.BLR).toBeDefined();
    expect(COUNTRY_CONFIGS.BAL).toBeDefined();
  });

  it("removes them from the visible country order", () => {
    expect(COUNTRY_ORDER).not.toContain("BLR");
    expect(COUNTRY_ORDER).not.toContain("BAL");
  });

  it("still lists the genuine satellite states", () => {
    // These WERE sovereign — separate governments, Warsaw Pact members.
    for (const id of ["PL", "RO", "HU", "DD", "CS", "BG"]) {
      expect(COUNTRY_ORDER).toContain(id);
    }
  });

  /**
   * `countries` is declarative — nothing reads it to drive seeding — but it is
   * the admin-facing manifest of what a preset contains, so a latent country
   * listed here reads as a promise the bootstrap does not keep.
   */
  it("is not advertised by any reset preset", () => {
    for (const preset of RESET_PRESETS) {
      expect(preset.countries, `${preset.id} lists BLR`).not.toContain("BLR");
      expect(preset.countries, `${preset.id} lists BAL`).not.toContain("BAL");
    }
  });

  it("lists no country a preset cannot actually seed", () => {
    const live = new Set<string>(COUNTRY_ORDER);
    for (const preset of RESET_PRESETS) {
      const latent = preset.countries.filter((id) => !live.has(id));
      expect(latent, `${preset.id} advertises unseedable countries`).toEqual([]);
    }
  });
});
