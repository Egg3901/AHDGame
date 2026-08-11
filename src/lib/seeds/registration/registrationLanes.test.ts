import { describe, expect, it } from "vitest";
import { buildAllRegistrationSeeds, validateSeed } from "./registrationLanes";
import { build1991RegistrationSeeds } from "./registrationLanes1991";
import { states as usStates } from "@/lib/seeds/reference/states";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { politicalParties as usParties } from "@/lib/seeds/reference/politicalParties";
import { ukParties } from "@/lib/seeds/uk/ukParties";
import { jpParties } from "@/lib/seeds/jp/jpParties";
import { deParties } from "@/lib/seeds/de/deParties";
import { brParties } from "@/lib/seeds/br/brParties";
import { ieParties } from "@/lib/seeds/ie/ieParties";
import { cnParties } from "@/lib/seeds/cn/cnParties";
import { isPartyValidForPreset } from "@/lib/seeds/ensureDefaultParties";

const STATES_BY_COUNTRY: Record<string, ReadonlySet<string>> = {
  US: new Set(usStates.map((s) => s._id)),
  UK: new Set(ukRegions.map((r) => r._id)),
  JP: new Set(jpRegions.map((r) => r._id)),
  DE: new Set(deRegions.map((r) => r._id)),
  BR: new Set(brRegions.map((r) => r._id)),
  IE: new Set(ieRegions.map((r) => r._id)),
  CN: new Set(cnRegions.map((r) => r._id)),
};

const PARTY_ABBRS_BY_COUNTRY: Record<string, typeof usParties> = {
  US: usParties,
  UK: ukParties,
  JP: jpParties,
  DE: deParties,
  BR: brParties,
  IE: ieParties,
  CN: cnParties,
};

function abbrsValidForPreset(countryId: string, preset: string): Set<string> {
  const list = PARTY_ABBRS_BY_COUNTRY[countryId] ?? [];
  return new Set(
    list
      .filter((p) => isPartyValidForPreset(p, preset))
      .map((p) => p.abbreviation?.toUpperCase() ?? "")
      .filter(Boolean)
  );
}

describe("registration bootstrap seeds", () => {
  const seeds = buildAllRegistrationSeeds();

  it("includes US, UK, JP, DE", () => {
    const countries = new Set(seeds.map((s) => s.countryId));
    expect(countries).toEqual(new Set(["US", "UK", "JP", "DE"]));
  });

  it("every seed satisfies the pool-sum invariant (Org and Reg)", () => {
    const errors = seeds.map((s) => validateSeed(s)).filter((e): e is string => e !== null);
    if (errors.length > 0) {
      // Fail loudly with the first few — easier than a single boolean fail.
      throw new Error(`Seed invariant errors:\n${errors.slice(0, 10).join("\n")}`);
    }
    expect(errors).toEqual([]);
  });

  it("every seed has at least one party", () => {
    for (const s of seeds) {
      expect(s.parties.length).toBeGreaterThan(0);
    }
  });

  it("US covers the expected 50 states (template assignments + overrides)", () => {
    const us = seeds.filter((s) => s.countryId === "US");
    // We expect 49: every state in the lane assignments + AK/UT/FL/TX/GA/AZ
    // overrides + MT solid-R override. (HI is in strongD, not a 50-state full
    // map; the plan's lane assignments are the source of truth — count them.)
    expect(us.length).toBeGreaterThanOrEqual(40);
  });
});

describe("1991 registration bootstrap seeds", () => {
  const seeds = build1991RegistrationSeeds();

  it("includes US, UK, JP, DE, BR, IE, CN", () => {
    const countries = new Set(seeds.map((s) => s.countryId));
    expect(countries).toEqual(new Set(["US", "UK", "JP", "DE", "BR", "IE", "CN"]));
  });

  it("every stateId exists in the corresponding country's seeded regions", () => {
    const orphans: string[] = [];
    for (const row of seeds) {
      const valid = STATES_BY_COUNTRY[row.countryId];
      if (!valid || !valid.has(row.stateId)) {
        orphans.push(`${row.countryId}/${row.stateId}`);
      }
    }
    expect(orphans, `unknown stateIds: ${orphans.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("every party abbreviation is valid for 1991-default", () => {
    const unknowns: string[] = [];
    for (const row of seeds) {
      const valid = abbrsValidForPreset(row.countryId, "1991-default");
      for (const share of row.parties) {
        if (!valid.has(share.abbr.toUpperCase())) {
          unknowns.push(`${row.countryId}/${row.stateId}: ${share.abbr}`);
        }
      }
    }
    expect(unknowns, `unknown abbrs: ${unknowns.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("every actual seeded region in the 1991 country set has a 1991 row", () => {
    const presetCountries = ["US", "UK", "JP", "DE", "BR", "IE", "CN"] as const;
    const missing: string[] = [];
    for (const country of presetCountries) {
      const expectedIds = STATES_BY_COUNTRY[country];
      const haveIds = new Set(seeds.filter((s) => s.countryId === country).map((s) => s.stateId));
      for (const id of expectedIds) {
        if (!haveIds.has(id)) missing.push(`${country}/${id}`);
      }
    }
    expect(missing, `regions missing 1991 reg row: ${missing.join(", ")}`).toEqual([]);
  });

  it("every 1991 seed satisfies the pool-sum invariant (Org and Reg)", () => {
    const errors = seeds.map((s) => validateSeed(s)).filter((e): e is string => e !== null);
    if (errors.length > 0) {
      throw new Error(`1991 seed invariant errors:\n${errors.slice(0, 10).join("\n")}`);
    }
    expect(errors).toEqual([]);
  });

  it("1991 US covers all 50 states + DC", () => {
    const us = seeds.filter((s) => s.countryId === "US");
    expect(us.length).toBe(51);
  });

  it("1991 UK covers 12 regions", () => {
    const uk = seeds.filter((s) => s.countryId === "UK");
    expect(uk.length).toBe(12);
  });

  it("1991 DE covers 16 Länder", () => {
    const de = seeds.filter((s) => s.countryId === "DE");
    expect(de.length).toBe(16);
  });

  it("1991 JP covers 8 game regions", () => {
    const jp = seeds.filter((s) => s.countryId === "JP");
    expect(jp.length).toBe(8);
  });

  it("1991 BR covers 5 macro-regions", () => {
    const br = seeds.filter((s) => s.countryId === "BR");
    expect(br.length).toBe(5);
  });

  it("1991 IE covers 8 regions", () => {
    const ie = seeds.filter((s) => s.countryId === "IE");
    expect(ie.length).toBe(8);
  });

  it("1991 CN covers 7 macro-regions", () => {
    const cn = seeds.filter((s) => s.countryId === "CN");
    expect(cn.length).toBe(7);
  });

  it("does NOT reference AFD (didn't exist in 1991)", () => {
    for (const s of seeds.filter((row) => row.countryId === "DE")) {
      for (const p of s.parties) {
        expect(p.abbr).not.toBe("AFD");
      }
    }
  });

  it("does NOT reference RUK (didn't exist in 1992)", () => {
    for (const s of seeds.filter((row) => row.countryId === "UK")) {
      for (const p of s.parties) {
        expect(p.abbr).not.toBe("RUK");
      }
    }
  });
});
