/**
 * Era-gating for Eastern-bloc structures (refs #3269).
 *
 * The Warsaw-Pact one-party states (HU/PL/RO/YU/BG/CS) and the CPSU's regional
 * organization only existed in the Cold-War (1953/1979) eras. They must NOT seed
 * under the 1991/2019 presets — otherwise Soviet-era regions + communist rosters
 * leak into post-Soviet worlds. These tests prove the seeders no-op in the
 * post-Soviet eras but still write in the Cold-War eras.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { EasternBlocSeedConfig } from "./seedEasternBloc";
import { seedEasternBlocCountry } from "./seedEasternBloc";
import { seedRuStatePartyOrg } from "./seedRuStatePartyOrg";
import { seedDdStatePartyOrg } from "./seedDdStatePartyOrg";
import { isEasternBlocEra } from "@/lib/seeds/presetSelector";

type Doc = Record<string, unknown>;

/**
 * Generic mock Db: every collection shares stubs that satisfy the seeders'
 * access patterns (deleteMany / updateOne / insertOne / findOne / find). Each
 * call is recorded on the returned `calls` map keyed by `${collection}.${op}`.
 */
function makeDb() {
  const calls = new Map<string, Doc[]>();
  const record = (key: string, arg: Doc) => {
    const arr = calls.get(key) ?? [];
    arr.push(arg);
    calls.set(key, arr);
  };
  const collection = vi.fn().mockImplementation((name: string) => ({
    deleteMany: vi.fn().mockImplementation((f: Doc) => {
      record(`${name}.deleteMany`, f);
      return Promise.resolve({});
    }),
    updateOne: vi.fn().mockImplementation((f: Doc) => {
      record(`${name}.updateOne`, f);
      return Promise.resolve({ upsertedCount: 1 });
    }),
    insertOne: vi.fn().mockImplementation((d: Doc) => {
      record(`${name}.insertOne`, d);
      return Promise.resolve({});
    }),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      toArray: vi.fn().mockResolvedValue([]),
    }),
  }));
  return { db: { collection } as unknown as Db, calls, collection };
}

const fakeRegion = {
  _id: "HU_BUD",
  countryId: "HU",
  name: "Budapest",
  population: 3_000_000,
  gdp: 100_000_000_000,
} as unknown as State;

// Minimal config: one region, no parties/categories/metrics/baselines. Enough to
// observe whether the seeder proceeds past its era guard (region upsert) or not.
const cfg: EasternBlocSeedConfig = {
  countryId: "HU",
  categoryId: "hu_voterGroups",
  regions: [fakeRegion],
  parties: [],
  categories: [],
  metrics: [],
  baselines: [],
};

beforeEach(() => vi.clearAllMocks());

describe("isEasternBlocEra", () => {
  it("is true only for the Cold-War (1953/1979) eras", () => {
    expect(isEasternBlocEra("1953-default")).toBe(true);
    expect(isEasternBlocEra("1979-default")).toBe(true);
    expect(isEasternBlocEra("1991-default")).toBe(false);
    expect(isEasternBlocEra("2019-default")).toBe(false);
    expect(isEasternBlocEra("2023-default")).toBe(false);
    expect(isEasternBlocEra("empty")).toBe(false);
  });
});

describe("seedEasternBlocCountry era gating (#3269)", () => {
  for (const preset of ["1991-default", "2019-default"]) {
    it(`does NOT seed the bloc country under ${preset}`, async () => {
      const { db, calls } = makeDb();
      const log = vi.fn();
      await seedEasternBlocCountry(db, true, log, preset, cfg);

      expect(calls.get("states.updateOne")).toBeUndefined();
      expect(calls.get("states.deleteMany")).toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("skipping Eastern-bloc"));
    });
  }

  for (const preset of ["1953-default", "1979-default"]) {
    it(`DOES seed the bloc country under ${preset}`, async () => {
      const { db, calls } = makeDb();
      await seedEasternBlocCountry(db, true, vi.fn(), preset, cfg);

      const upserts = calls.get("states.updateOne") ?? [];
      expect(upserts).toHaveLength(1);
      expect(upserts[0]).toEqual({ _id: "HU_BUD" });
    });
  }
});

describe("seedRuStatePartyOrg (CPSU) era gating (#3269)", () => {
  for (const preset of ["1991-default", "2019-default"]) {
    it(`does NOT seed CPSU regional org under ${preset}`, async () => {
      const { db, calls } = makeDb();
      const log = vi.fn();
      await seedRuStatePartyOrg(db, true, log, preset);

      expect(calls.get("statePartyOrg.updateOne")).toBeUndefined();
      expect(calls.get("statePartyOrg.deleteMany")).toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Skipping RU state party org"));
    });
  }

  for (const preset of ["1953-default", "1979-default"]) {
    it(`DOES seed CPSU regional org for all 14 Soviet regions under ${preset}`, async () => {
      const { db, calls } = makeDb();
      await seedRuStatePartyOrg(db, true, vi.fn(), preset);

      expect(calls.get("statePartyOrg.updateOne") ?? []).toHaveLength(14);
    });
  }
});

describe("seedDdStatePartyOrg (National Front) era gating", () => {
  for (const preset of ["1991-default", "2019-default"]) {
    it(`does NOT seed DD regional org under ${preset}`, async () => {
      const { db, calls } = makeDb();
      const log = vi.fn();
      await seedDdStatePartyOrg(db, true, log, preset);

      expect(calls.get("statePartyOrg.updateOne")).toBeUndefined();
      expect(calls.get("statePartyOrg.deleteMany")).toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Skipping DD state party org"));
    });
  }

  for (const preset of ["1953-default", "1979-default"]) {
    it(`DOES seed 6 Länder × 5 National Front parties under ${preset}`, async () => {
      const { db, calls } = makeDb();
      await seedDdStatePartyOrg(db, true, vi.fn(), preset);

      expect(calls.get("statePartyOrg.updateOne") ?? []).toHaveLength(30);
    });
  }
});

describe("DD National Front org tables", () => {
  it("gives the SED a majority of the organized pool in every Land, both eras, sums ≤ 100", async () => {
    const { DD_REGION_ORG_1953, DD_REGION_ORG_1979 } =
      await import("@/lib/seeds/dd/ddStatePartyOrgCalculations");
    for (const table of [DD_REGION_ORG_1953, DD_REGION_ORG_1979]) {
      expect(Object.keys(table).sort()).toEqual(["BB", "BEO", "MV", "SN", "ST", "TH"]);
      for (const [land, row] of Object.entries(table)) {
        const bloc = row.cdu + row.ldpd + row.ndpd + row.dbd;
        expect(row.sed, `${land}: SED must out-organize the bloc`).toBeGreaterThan(bloc);
        expect(
          row.sed + bloc,
          `${land}: pool must leave an unaffiliated slice`
        ).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("seedEasternBlocCountry party era gating", () => {
  function makePartyAwareDb() {
    const calls = new Map<string, Doc[]>();
    const record = (key: string, arg: Doc) => {
      const arr = calls.get(key) ?? [];
      arr.push(arg);
      calls.set(key, arr);
    };
    const politicalParties = {
      deleteMany: vi.fn().mockImplementation((f: Doc) => {
        record("politicalParties.deleteMany", f);
        return Promise.resolve({ deletedCount: 1 });
      }),
      // Existing row → update path (avoids sequentialId counter plumbing).
      findOne: vi.fn().mockResolvedValue({ _id: "existing" }),
      updateOne: vi.fn().mockImplementation((f: Doc, u: Doc) => {
        record("politicalParties.updateOne", { filter: f, update: u });
        return Promise.resolve({ upsertedCount: 0 });
      }),
      insertOne: vi.fn().mockResolvedValue({}),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        toArray: vi.fn().mockResolvedValue([]),
      }),
    };
    const collection = vi.fn().mockImplementation((name: string) => {
      if (name === "politicalParties") return politicalParties;
      return {
        deleteMany: vi.fn().mockResolvedValue({}),
        updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({}),
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          toArray: vi.fn().mockResolvedValue([]),
        }),
      };
    });
    return {
      db: { collection } as unknown as Db,
      calls,
      politicalParties,
    };
  }

  it("1953-default upserts only MDP and prunes MSZMP", async () => {
    const { huParties } = await import("@/lib/seeds/hu/huParties");
    const { db, calls, politicalParties } = makePartyAwareDb();
    await seedEasternBlocCountry(db, false, vi.fn(), "1953-default", {
      ...cfg,
      parties: huParties,
    });

    expect(politicalParties.deleteMany).toHaveBeenCalledWith({
      $or: [
        {
          countryId: "HU",
          name: "Magyar Szocialista Munkáspárt",
          isDefault: true,
        },
      ],
    });
    const updates = calls.get("politicalParties.updateOne") ?? [];
    expect(updates).toHaveLength(1);
    expect((updates[0].update as { $set: Doc }).$set.abbreviation).toBe("MDP");
  });

  it("1979-default upserts only MSZMP and prunes MDP", async () => {
    const { huParties } = await import("@/lib/seeds/hu/huParties");
    const { db, calls, politicalParties } = makePartyAwareDb();
    await seedEasternBlocCountry(db, false, vi.fn(), "1979-default", {
      ...cfg,
      parties: huParties,
    });

    expect(politicalParties.deleteMany).toHaveBeenCalledWith({
      $or: [
        {
          countryId: "HU",
          name: "Magyar Dolgozók Pártja",
          isDefault: true,
        },
      ],
    });
    const updates = calls.get("politicalParties.updateOne") ?? [];
    expect(updates).toHaveLength(1);
    expect((updates[0].update as { $set: Doc }).$set.abbreviation).toBe("MSZMP");
  });
});
