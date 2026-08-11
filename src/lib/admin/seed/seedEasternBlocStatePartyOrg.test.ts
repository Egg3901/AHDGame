/**
 * One-party regional party organisation: the six Warsaw-Pact satellites plus the
 * three Soviet union republics modelled as their own countries (UKR/BLR/BAL).
 *
 * The six Warsaw-Pact satellites previously had NO `statePartyOrg` rows at all.
 * That is not cosmetic: `registration` feeds the swing-flow engine's
 * `regByParty` map, which gates §7.3.2 defense, so a party with no row falls to
 * the newcomer baseline and becomes ~20%-peelable — the PZPR organisable out of
 * Silesia by a party that did not exist.
 *
 * Also pins the era gate. These are Cold-War structures; seeding them into a
 * 1991/2019 world would attach communist rosters to successor democracies
 * (refs #3269), the same failure `seedEasternBlocCountry` guards against.
 */

import { describe, expect, it, vi } from "vitest";
import {
  EASTERN_BLOC_STATE_PARTY_ORG,
  easternBlocOrgEra,
} from "@/lib/seeds/shared/easternBlocStatePartyOrg";
import { seedEasternBlocStatePartyOrg } from "./seedEasternBlocStatePartyOrg";
import { getPlSeedConfig } from "@/lib/seeds/pl/plSeed";
import { getHuSeedConfig } from "@/lib/seeds/hu/huSeed";
import { getRoSeedConfig } from "@/lib/seeds/ro/roSeed";
import { getBgSeedConfig } from "@/lib/seeds/bg/bgSeed";
import { getCsSeedConfig } from "@/lib/seeds/cs/csSeed";
import { getYuSeedConfig } from "@/lib/seeds/yu/yuSeed";
import { getUaSeedConfig } from "@/lib/seeds/ua/uaSeed";
import { getBlrSeedConfig } from "@/lib/seeds/blr/blrSeed";
import { getBalSeedConfig } from "@/lib/seeds/bal/balSeed";
import type { EasternBlocSeedConfig } from "./seedEasternBloc";

const CONFIGS: Record<string, (preset: string) => EasternBlocSeedConfig> = {
  PL: getPlSeedConfig,
  HU: getHuSeedConfig,
  RO: getRoSeedConfig,
  BG: getBgSeedConfig,
  CS: getCsSeedConfig,
  YU: getYuSeedConfig,
  UKR: getUaSeedConfig,
  BLR: getBlrSeedConfig,
  BAL: getBalSeedConfig,
};

/** Minimal db double capturing statePartyOrg upserts. */
function makeDb() {
  const upserts: Array<{ _id: string; doc: Record<string, unknown> }> = [];
  const deletes: unknown[] = [];
  const db = {
    collection: (name: string) => ({
      findOne: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn(async (filter: unknown) => {
        if (name === "statePartyOrg") deletes.push(filter);
        return { deletedCount: 0 };
      }),
      updateOne: vi.fn(async (filter: { _id: string }, update: Record<string, never>) => {
        if (name === "statePartyOrg") {
          upserts.push({ _id: filter._id, doc: update.$set as Record<string, unknown> });
        }
        return { upsertedCount: 1 };
      }),
    }),
  };
  return { db: db as never, upserts, deletes };
}

describe("seedEasternBlocStatePartyOrg", () => {
  it.each(["1953-default", "1979-default"])(
    "%s: seeds one ruling-party row for every region of all nine one-party states",
    async (preset) => {
      const { db, upserts } = makeDb();
      await seedEasternBlocStatePartyOrg(db, false, () => {}, preset);

      const expected = Object.entries(CONFIGS).flatMap(([countryId, getConfig]) =>
        getConfig(preset).regions.map((r) => ({ countryId, regionId: r._id }))
      );
      expect(upserts).toHaveLength(expected.length);

      for (const { countryId, regionId } of expected) {
        const row = upserts.find((u) => u._id === `${regionId}_1`);
        expect(row, `${countryId} ${regionId} has an org row`).toBeDefined();
        expect(row!.doc.countryId).toBe(countryId);
        expect(row!.doc.stateId).toBe(regionId);
        expect(row!.doc.hasPresence).toBe(true);
      }
    }
  );

  it("mirrors registration onto organization so the ruling party is not peelable", async () => {
    const { db, upserts } = makeDb();
    await seedEasternBlocStatePartyOrg(db, false, () => {}, "1953-default");
    expect(upserts.length).toBeGreaterThan(0);
    for (const { _id, doc } of upserts) {
      expect(doc.registration, `${_id} registration`).toBe(doc.organization);
      // A one-party state's ruling party is never a marginal regional presence.
      expect(doc.organization as number, `${_id} organization`).toBeGreaterThan(30);
      expect(doc.organization as number, `${_id} organization`).toBeLessThanOrEqual(100);
    }
  });

  it.each(["1991-default", "2019-default"])("%s: no-ops outside the Cold-War eras", async (p) => {
    const { db, upserts, deletes } = makeDb();
    const logs: string[] = [];
    await seedEasternBlocStatePartyOrg(db, true, (m) => logs.push(m), p);
    expect(upserts).toHaveLength(0);
    expect(deletes).toHaveLength(0); // must not wipe successor-democracy rows either
    expect(logs.join(" ")).toContain("not a Cold-War era");
  });

  it("reset scopes its delete to the nine one-party states", async () => {
    const { db, deletes } = makeDb();
    await seedEasternBlocStatePartyOrg(db, true, () => {}, "1979-default");
    expect(deletes).toEqual([
      { countryId: { $in: ["PL", "HU", "RO", "BG", "CS", "YU", "UKR", "BLR", "BAL"] } },
    ]);
  });
});

describe("Eastern-bloc party-org table", () => {
  it("covers every region of every one-party state in both eras", () => {
    for (const [countryId, getConfig] of Object.entries(CONFIGS)) {
      for (const preset of ["1953-default", "1979-default"]) {
        const era = easternBlocOrgEra(preset);
        const table = EASTERN_BLOC_STATE_PARTY_ORG[countryId].org[era];
        const regionIds = getConfig(preset).regions.map((r) => r._id);
        expect(new Set(Object.keys(table)), `${countryId} ${era}`).toEqual(new Set(regionIds));
      }
    }
  });

  it("only Romania, Bulgaria and the union republics grow between the eras", () => {
    // Ceaușescu's PCR became the largest communist party per capita in the
    // world and the BKP kept saturating; every other SATELLITE party receded.
    // The three union republics all grow, and for a different reason: they were
    // not hollowing-out national parties but branches of a CPSU that went on
    // expanding, with Russification and in-migration adding members outright.
    const mean = (t: Record<string, number>) =>
      Object.values(t).reduce((a, b) => a + b, 0) / Object.values(t).length;
    for (const [countryId, profile] of Object.entries(EASTERN_BLOC_STATE_PARTY_ORG)) {
      const grew = mean(profile.org["1979"]) > mean(profile.org["1953"]);
      const growers = new Set(["RO", "BG", "UKR", "BLR", "BAL"]);
      expect(grew, `${countryId} grew 1953→1979`).toBe(growers.has(countryId));
    }
  });
});
