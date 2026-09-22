import { describe, expect, it } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { selectPartyRosterForPreset } from "./ensureDefaultParties";
import { PARTY_SEED_MODULES, partySeedsForPreset } from "./partySeedRegistry";

const PRESET = "2027-default";
const INCLUDED_COUNTRIES: CountryId[] = [
  "US",
  "UK",
  "DE",
  "JP",
  "CN",
  "RU",
  "IE",
  "BR",
  "NG",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
];

const OBSOLETE_2027_PARTIES = new Set([
  "Communist Party of the Soviet Union",
  "Rassemblement pour la République",
  "Union pour la démocratie française",
  "Front National",
  "Democrazia Cristiana",
  "Partito Comunista Italiano",
  "Partito Socialista Italiano",
  "Movimento Sociale Italiano",
  "Convergència i Unió",
  "Centro Democrático y Social",
  "Ny Demokrati",
  "Kristdemokratiska samhällspartiet",
  "Folkpartiet",
  "Doğru Yol Partisi",
  "Anavatan Partisi",
  "Sosyaldemokrat Halkçı Parti",
  "Refah Partisi",
  "Demokratik Sol Parti",
]);

describe("2027 party rosters (#2294)", () => {
  it("gives every included country a direct roster without an earlier-era fallback", () => {
    for (const countryId of INCLUDED_COUNTRIES) {
      const direct = partySeedsForPreset(countryId, PRESET);
      const effective = selectPartyRosterForPreset(
        [...(PARTY_SEED_MODULES[countryId] ?? [])],
        PRESET
      );

      expect(direct.length, `${countryId} direct roster`).toBeGreaterThan(0);
      expect(effective, `${countryId} effective roster`).toEqual(direct);
      expect(
        direct.every((party) => !party.validForPresets || party.validForPresets.includes(PRESET))
      ).toBe(true);
    }
  });

  it("excludes dissolved and renamed organizations from 2027", () => {
    const activeNames = new Set(
      INCLUDED_COUNTRIES.flatMap((countryId) =>
        partySeedsForPreset(countryId, PRESET).map((party) => party.name)
      )
    );
    for (const obsolete of OBSOLETE_2027_PARTIES) expect(activeNames).not.toContain(obsolete);
  });

  it("uses unique identities and seed orders within every effective roster", () => {
    for (const countryId of INCLUDED_COUNTRIES) {
      const roster = partySeedsForPreset(countryId, PRESET);
      expect(new Set(roster.map((party) => party.name)).size, `${countryId} names`).toBe(
        roster.length
      );
      expect(
        new Set(roster.map((party) => party.abbreviation)).size,
        `${countryId} abbreviations`
      ).toBe(roster.length);
      expect(new Set(roster.map((party) => party.seedOrder)).size, `${countryId} orders`).toBe(
        roster.length
      );
    }
  });
});
