import { describe, expect, it } from "vitest";
import { generateCountryOwnedSeedData } from "./budgets";
import {
  corporationPathIdFromDoc,
  corporationQueryFromParamId,
} from "@/lib/api/corporations/resolveQuery";
import { SEED_PRESET_IDS } from "@/lib/constants/turnTime";

// One synthetic producing state per country that can own seeded corporations:
// sovereign issuers (US/UK/JP/RU/DE/IE/BR/CN/NG/FR/IT/ES/SE/TR/GR/AT/FI/DD),
// the 1953 market state enterprises, and the command-economy SOE stacks.
const SEED_COUNTRIES = [
  "US",
  "UK",
  "JP",
  "RU",
  "DE",
  "IE",
  "BR",
  "CN",
  "NG",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
  "DD",
  "PL",
  "HU",
  "CS",
  "BG",
  "UKR",
  "BLR",
  "BAL",
  "RO",
  "YU",
] as const;

function statesForAll() {
  return SEED_COUNTRIES.map((countryId, i) => ({
    id: `${countryId}_ST${i}`,
    population: 1_000_000,
    gdp: 10_000,
    countryId,
  }));
}

// Cover every canonical reset preset (not a local copy of the list): a new
// preset added to SEED_PRESET_IDS is automatically covered here instead of
// silently skipping uniqueness for its seed output.
const SUPPORTED_CORP_SEED_PRESETS: readonly string[] = SEED_PRESET_IDS;

function seqIdsOf(preset: string, commandEconomyEnabled: boolean) {
  return generateCountryOwnedSeedData(statesForAll(), preset, commandEconomyEnabled)
    .map((entry) => entry.corporation.sequentialId)
    .filter((sequentialId): sequentialId is number => sequentialId !== undefined);
}

describe("seeded corporation sequentialIds (issue #2028)", () => {
  it.each(SUPPORTED_CORP_SEED_PRESETS)(
    "preset %s seeds globally unique sequentialIds (command economy on)",
    (preset) => {
      const seqs = seqIdsOf(preset, true);
      expect(seqs.length).toBeGreaterThan(0);
      expect(new Set(seqs).size).toBe(seqs.length);
    }
  );

  it.each(SUPPORTED_CORP_SEED_PRESETS)(
    "preset %s seeds globally unique sequentialIds (command economy off)",
    (preset) => {
      const seqs = seqIdsOf(preset, false);
      expect(seqs.length).toBeGreaterThan(0);
      expect(new Set(seqs).size).toBe(seqs.length);
    }
  );

  it.each(SUPPORTED_CORP_SEED_PRESETS)(
    "preset %s seeds globally unique corporation ObjectIds",
    (preset) => {
      for (const flag of [true, false]) {
        const oids = generateCountryOwnedSeedData(statesForAll(), preset, flag).map((entry) =>
          entry.corporation._id.toString()
        );
        expect(new Set(oids).size).toBe(oids.length);
      }
    }
  );

  // The exact duplicate pairs reported against 1953-default: each pair shared
  // one identifier across two corporations. Red before the fix (seven shared
  // ids), green after: every named corporation now holds its own id.
  it("gives each formerly colliding 1953 pair its own identifier", () => {
    const corps = generateCountryOwnedSeedData(statesForAll(), "1953-default", true).map(
      (entry) => entry.corporation
    );
    const byName = new Map(corps.map((c) => [c.name, c.sequentialId]));
    const pairs: Array<[string, string]> = [
      ["Soviet Union", "France"],
      ["Italy", "East Germany"],
      ["Régie et Charbonnages de France", "Spain"],
      ["IRI-ENI Holding", "Sweden"],
      ["Statens Affärsverk", "Greece"],
      ["İktisadi Devlet Teşekkülleri Holding", "Austria"],
      ["DEI-SEK Dimosies Epicheiriseis", "Finland"],
    ];
    for (const [a, b] of pairs) {
      expect(byName.has(a), `missing seeded corporation ${a}`).toBe(true);
      expect(byName.has(b), `missing seeded corporation ${b}`).toBe(true);
      expect(byName.get(a)).not.toBe(byName.get(b));
    }
  });

  it("keeps the long-stable sovereign sequence US 900_001 through DD 900_010", () => {
    const corps = generateCountryOwnedSeedData(statesForAll(), "1953-default", true).map(
      (entry) => entry.corporation
    );
    const byName = new Map(corps.map((c) => [c.name, c.sequentialId]));
    expect(byName.get("United States")).toBe(900_001);
    expect(byName.get("United Kingdom")).toBe(900_002);
    expect(byName.get("Japan")).toBe(900_003);
    expect(byName.get("Soviet Union")).toBe(900_009);
    expect(byName.get("East Germany")).toBe(900_010);
  });

  it("is retry-deterministic: a re-seed produces the identical id set", () => {
    const first = seqIdsOf("1953-default", true);
    const second = seqIdsOf("1953-default", true);
    expect([...second].sort((a, b) => a - b)).toEqual([...first].sort((a, b) => a - b));
  });

  // Runtime corporations allocate from the `corporation` counter (starting at
  // 1); reserved seed ids live in the 900_xxx range, so the allocator can
  // never hand out a seed id. The unique index then guards the boundary.
  it("reserves seed ids far above any runtime counter allocation", () => {
    const reserved = new Set<number>();
    for (const preset of SUPPORTED_CORP_SEED_PRESETS) {
      for (const flag of [true, false]) {
        for (const seq of seqIdsOf(preset, flag)) reserved.add(seq);
      }
    }
    expect(Math.min(...reserved)).toBeGreaterThanOrEqual(900_001);
    // Simulate the first thousand runtime allocations off a fresh counter.
    for (let seq = 1; seq <= 1000; seq += 1) {
      expect(reserved.has(seq)).toBe(false);
    }
  });

  it("round-trips every seeded corporation link through the sequentialId lookup", () => {
    const entries = generateCountryOwnedSeedData(statesForAll(), "1953-default", true);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const path = corporationPathIdFromDoc({
        _id: entry.corporation._id,
        sequentialId: entry.corporation.sequentialId,
      });
      expect(path).toBe(String(entry.corporation.sequentialId));
      // The URL segment must parse back to a query matching ONLY this corp:
      // with globally unique ids the query is unambiguous by construction.
      expect(corporationQueryFromParamId(path)).toEqual({
        sequentialId: entry.corporation.sequentialId,
      });
    }
    const queries = entries.map((entry) =>
      JSON.stringify(corporationQueryFromParamId(String(entry.corporation.sequentialId)))
    );
    expect(new Set(queries).size).toBe(queries.length);
  });
});
