import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { bulkOps, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { NATIONAL_BASELINES_1953 } from "@/lib/politicalMetrics/seeds/nationalBaselines1953";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { seedPoliticalMetrics } from "./seedPoliticalMetrics";

const STATES = [
  { _id: "MI", countryId: "US", name: "Michigan", population: 6_500_000 },
  { _id: "AL", countryId: "US", name: "Alabama", population: 3_000_000 },
  { _id: "LON", countryId: "UK", name: "London", population: 8_000_000 },
  { _id: "CEN", countryId: "RU", name: "Central Russia", population: 22_500_000 },
];

describe("seedPoliticalMetrics", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("states").find().toArray.mockResolvedValue(STATES);
  });

  it("upserts one doc per US/UK/RU/DD region with base+modifier values", async () => {
    const { regionsSeeded } = await seedPoliticalMetrics(
      db as unknown as Db,
      false,
      () => {},
      1953,
      "1953-default"
    );
    expect(regionsSeeded).toBe(4);

    const calls = bulkOps(db.collectionMocks["politicalMetrics"]!.bulkWrite);
    expect(calls).toHaveLength(4);
    const byId = new Map(
      calls.map((c) => [
        (c[0] as { _id: string })._id,
        (c[1] as { $set: PoliticalMetricsDoc }).$set,
      ])
    );

    const mi = byId.get("MI")!;
    const al = byId.get("AL")!;
    const base = NATIONAL_BASELINES_1953.US["economy.workerSecurity"].value;
    // MI carries a positive hand-authored workerSecurity modifier, and the
    // texture generator excludes any pair a modifier already covers, so MI lands
    // on base+modifier exactly.
    expect(mi.values["economy.workerSecurity"]).toBeGreaterThan(base);
    // AL has no workerSecurity modifier, so since ticket #1129 it takes derived
    // TEXTURE there instead of sitting on the bare anchor. The "lands exactly on
    // the anchor" property now belongs to a family with neither, which is what
    // the defense block is: national by nature, no regional variation.
    expect(al.values["economy.workerSecurity"]).not.toBe(base);
    expect(al.values["defense.armedForces"]).toBe(
      NATIONAL_BASELINES_1953.US["defense.armedForces"].value
    );
    expect(mi.countryId).toBe("US");
    expect(Object.keys(mi.values)).toHaveLength(63);
    for (const v of Object.values(mi.values)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    // Deep-South integration penalty lands.
    expect(al.values["society.integration"]).toBeLessThan(
      NATIONAL_BASELINES_1953.US["society.integration"].value
    );
    // Upsert semantics — re-running cannot duplicate docs. Read off the bulk
    // ops themselves: `upsert` is a property of the op, not a third argument.
    const ops = db.collectionMocks["politicalMetrics"]!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { upsert?: boolean };
    }>;
    expect(ops).toHaveLength(4);
    for (const op of ops) expect(op.updateOne.upsert).toBe(true);
    // And in one round trip, not four.
    expect(db.collectionMocks["politicalMetrics"]!.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("seeds the 1953 authored values when given year 1953", async () => {
    await seedPoliticalMetrics(db as unknown as Db, false, () => {}, 1953, "1953-default");
    const calls = bulkOps(db.collectionMocks["politicalMetrics"]!.bulkWrite);
    const al = calls.find((c) => (c[0] as { _id: string })._id === "AL")!;
    const values = (al[1] as { $set: PoliticalMetricsDoc }).$set.values;
    // AL carries neither a modifier nor texture on the defense block, so the
    // year-resolved anchor is exactly what lands. (Before ticket #1129 this
    // asserted on economy.workerSecurity, which now takes derived texture.)
    expect(values["defense.armedForces"]).toBe(
      NATIONAL_BASELINES_1953.US["defense.armedForces"].value
    );
  });

  it("seeds non-playable regions from the committed board file", async () => {
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        ...STATES,
        { _id: "BY", countryId: "DE", name: "Bavaria", population: 9_000_000 },
      ]);
    const { regionsSeeded } = await seedPoliticalMetrics(
      db as unknown as Db,
      false,
      () => {},
      1953,
      "1953-default"
    );
    expect(regionsSeeded).toBe(5);
    const calls = bulkOps(db.collectionMocks["politicalMetrics"]!.bulkWrite);
    const by = calls.find((c) => (c[0] as { _id: string })._id === "BY")!;
    const doc = (by[1] as { $set: PoliticalMetricsDoc }).$set;
    expect(doc.countryId).toBe("DE");
    // A full board, including the hand-authored defense block.
    expect(Object.keys(doc.values)).toHaveLength(63);
    expect(doc.values["defense.armedForces"]).toBeGreaterThanOrEqual(0);
    for (const v of Object.values(doc.values)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("gives each non-playable region its own board, not a national copy", async () => {
    // The Phase 0 property. The legacy seeds vary per region across most of the
    // political half (DE differs on 35 of 63 families), and replicating one
    // national board would flatten regional approval, corp margins, crises and
    // demographics for every non-playable country.
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "BY", countryId: "DE", name: "Bavaria", population: 9_000_000 },
        { _id: "NW", countryId: "DE", name: "North Rhine-Westphalia", population: 17_000_000 },
      ]);
    await seedPoliticalMetrics(db as unknown as Db, false, () => {}, 1953, "1953-default");
    const calls = bulkOps(db.collectionMocks["politicalMetrics"]!.bulkWrite);
    const get = (id: string) =>
      (calls.find((c) => (c[0] as { _id: string })._id === id)![1] as { $set: PoliticalMetricsDoc })
        .$set.values;
    const by = get("BY");
    const nw = get("NW");
    expect(by).not.toEqual(nw);
    // But the defense block is national by nature, so it must NOT vary.
    expect(by["defense.armedForces"]).toBe(nw["defense.armedForces"]);
    expect(by["defense.projection"]).toBe(nw["defense.projection"]);
  });

  it("skips a non-playable region absent from the board rather than falling back", async () => {
    // A region with no board entry must be skipped exactly like an unknown
    // country — never handed its country's board, which would look authored
    // while meaning nothing for that region.
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "BY", countryId: "DE", name: "Bavaria", population: 9_000_000 },
        { _id: "NOWHERE", countryId: "DE", name: "Nowhere", population: 1 },
      ]);
    const { regionsSeeded } = await seedPoliticalMetrics(
      db as unknown as Db,
      false,
      () => {},
      1953,
      "1953-default"
    );
    expect(regionsSeeded).toBe(1);
    const calls = bulkOps(db.collectionMocks["politicalMetrics"]!.bulkWrite);
    expect(calls.find((c) => (c[0] as { _id: string })._id === "NOWHERE")).toBeUndefined();
  });

  it("still seeds playable regions from the anchors, not the board file", async () => {
    await seedPoliticalMetrics(db as unknown as Db, false, () => {}, 1953, "1953-default");
    const calls = bulkOps(db.collectionMocks["politicalMetrics"]!.bulkWrite);
    const al = calls.find((c) => (c[0] as { _id: string })._id === "AL")!;
    const values = (al[1] as { $set: PoliticalMetricsDoc }).$set.values;
    // An untextured, unmodified family proves the value came from the anchor
    // table rather than NON_PLAYABLE_BOARDS. (Before ticket #1129 this asserted
    // on economy.workerSecurity, which now takes derived texture.)
    expect(values["defense.armedForces"]).toBe(
      NATIONAL_BASELINES_1953.US["defense.armedForces"].value
    );
  });

  it("never writes a region whose country has neither anchors nor a board", async () => {
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        ...STATES,
        { _id: "ZZZ", countryId: "ZZ" as never, name: "Nowhere", population: 1 },
      ]);
    const { regionsSeeded } = await seedPoliticalMetrics(
      db as unknown as Db,
      false,
      () => {},
      1953,
      "1953-default"
    );
    // The 4 playables only — an unknown country must be skipped, not seeded
    // with a neutral board, which would look authored but mean nothing.
    expect(regionsSeeded).toBe(4);
    const written = bulkOps(db.collectionMocks["politicalMetrics"]!.bulkWrite).map(
      (c) => (c[0] as { _id: string })._id
    );
    expect(written).not.toContain("ZZZ");
  });
});

/**
 * Ticket #1129. Playable regions used to take ONE national value each, so 47 of
 * 63 US families were byte-identical across all 51 states on prod - including
 * every order.* family, which is the whole Attorney General portfolio and the
 * page the ticket screenshotted.
 *
 * REGIONAL_TEXTURE_1953 supplies the per-region deviation the sparse
 * hand-authored modifier table never covered, without moving the authored
 * national level.
 */
describe("seedPoliticalMetrics - per-region texture (ticket #1129)", () => {
  const US_STATES = [
    "AK",
    "AL",
    "AR",
    "AZ",
    "CA",
    "CO",
    "DC",
    "DE",
    "FL",
    "GA",
    "HI",
    "IA",
    "ID",
    "IL",
    "IN",
    "MI",
    "MS",
    "NY",
    "TX",
    "WV",
  ].map((id) => ({ _id: id, countryId: "US", name: id, population: 1_000_000 }));

  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("states").find().toArray.mockResolvedValue(US_STATES);
  });

  async function seededValues(): Promise<Map<string, Record<string, number>>> {
    await seedPoliticalMetrics(db as unknown as Db, false, () => {}, 1953, "1953-default");
    const calls = bulkOps(db.collectionMocks["politicalMetrics"]!.bulkWrite);
    return new Map(
      calls.map((c) => [
        (c[0] as { _id: string })._id,
        (c[1] as { $set: PoliticalMetricsDoc }).$set.values as unknown as Record<string, number>,
      ])
    );
  }

  it("no longer gives every US region the same order.safety", async () => {
    const values = await seededValues();
    const safety = [...values.values()].map((v) => v["order.safety"]);
    expect(new Set(safety.map((s) => s.toFixed(3))).size).toBeGreaterThan(3);
  });

  it("keeps the country mean on the authored national baseline", async () => {
    const values = await seededValues();
    const safety = [...values.values()].map((v) => v["order.safety"]);
    const mean = safety.reduce((a, b) => a + b, 0) / safety.length;
    // Texture is mean-centred, so seeding it must not move the authored level.
    // Not exact: the noise floor drops small deviations (see playableTexture).
    expect(Math.abs(mean - NATIONAL_BASELINES_1953.US["order.safety"].value)).toBeLessThan(1.5);
  });

  it("lets a hand-authored modifier win over texture", async () => {
    const values = await seededValues();
    // MS carries a deliberate society.integration -18 (Jim Crow). The generator
    // excludes that pair, so the authored value is what lands - undiluted.
    const authored = NATIONAL_BASELINES_1953.US["society.integration"].value;
    expect(values.get("MS")!["society.integration"]).toBeCloseTo(
      Math.max(0, Math.min(100, authored - 18)),
      6
    );
  });

  it("still lands exactly on the anchor where there is neither modifier nor texture", async () => {
    const values = await seededValues();
    // The defense block is national by nature and carries no regional variation,
    // so every region must agree with the anchor to the last decimal.
    const anchor = NATIONAL_BASELINES_1953.US["defense.armedForces"].value;
    for (const v of values.values()) expect(v["defense.armedForces"]).toBe(anchor);
  });

  it("keeps every seeded value inside 0-100", async () => {
    const values = await seededValues();
    for (const v of values.values()) {
      for (const score of Object.values(v)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });
});
