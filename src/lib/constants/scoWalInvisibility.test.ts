import { describe, it, expect } from "vitest";
import {
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  ZOD_COUNTRY_ENUM,
  getCountryConfig,
  type CountryId,
} from "./countries";

// UKR/BLR/BAL joined SCO/WAL as latent. The three union republics are now
// authored countries with their own regions, chambers, budgets and map shards,
// but they ship at Poland's standing: seeded and visible on the world map, not
// yet offered to players.
const LATENT: CountryId[] = ["SCO", "WAL", "BLR", "UKR", "BAL"];

describe("Latent countries (SCO/WAL/UKR/BLR/BAL) are invisible in SP1", () => {
  it("are both coming-soon", () => {
    for (const id of LATENT) expect(getCountryConfig(id).status).toBe("coming-soon");
  });

  it("are in COUNTRY_CONFIGS (type safety) but absent from COUNTRY_ORDER (registered set)", () => {
    for (const id of LATENT) {
      expect(COUNTRY_CONFIGS[id]).toBeDefined();
      expect(COUNTRY_ORDER).not.toContain(id);
    }
  });

  it("ARE structurally valid in ZOD_COUNTRY_ENUM (SP2a: validation ≠ registration)", () => {
    // SP2a decoupled validation from the registered set: ZOD_COUNTRY_ENUM === ALL_COUNTRY_IDS,
    // so a SCO/WAL id parses structurally. Invisibility is NOT enforced here — it is enforced by
    // absence from COUNTRY_ORDER / getRegisteredCountryIds and by the access layer, which gates
    // playability (empty/403 downstream) until the country's countryGameStates row is activated.
    for (const id of LATENT) expect(ZOD_COUNTRY_ENUM).toContain(id);
  });

  it("a config-status-derived enabled list (what pickers/seeding/turn use via COUNTRY_ORDER) excludes them", () => {
    // The runtime sites iterate COUNTRY_ORDER, never Object.keys(COUNTRY_CONFIGS); assert the
    // registered set is exactly the non-latent configs.
    const configuredNonLatent = (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
      (id) => !LATENT.includes(id)
    );
    expect([...COUNTRY_ORDER].sort()).toEqual(configuredNonLatent.sort());
  });
});
