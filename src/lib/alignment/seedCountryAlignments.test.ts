import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("seedCountryAlignments", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // The seeder reads the existing entityIds once, up front, instead of a
    // findOne per entity. An empty world is the mock cursor's default.
    db.collection("countryAlignments").find().toArray.mockResolvedValue([]);
  });

  /** Pre-existing rows the seeder should treat as already seeded. */
  const existing = (entityIds: string[]) =>
    db
      .collection("countryAlignments")
      .find()
      .toArray.mockResolvedValue(entityIds.map((entityId) => ({ entityId })));

  // Rows are staged and written as one insertMany; flatten back to per-row.
  const inserted = () =>
    (db.collectionMocks.countryAlignments?.insertMany.mock.calls ?? []).flatMap(
      (c) =>
        c[0] as {
          entityId: string;
          shares: Record<string, number>;
          nonAligned: number;
          eraKey: string;
          previous: unknown;
          turn: number;
        }[]
    );

  it("writes a row for every country it is handed", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    await seedCountryAlignments(db as unknown as Db, "1953-default", ["US", "UK", "YU"]);
    const keys = inserted().map((r) => r.entityId);
    expect(keys).toEqual(expect.arrayContaining(["UK", "US", "YU"]));
  });

  it("also covers the sphere-macro entities the sphere system sponsors", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    // Jordan and Afghanistan are macro-tier: never playable, so never in the
    // country list, but the sphere system courts them and alignment owns the
    // number that drives it.
    await seedCountryAlignments(db as unknown as Db, "1953-default", ["US"]);
    const keys = inserted().map((r) => r.entityId);
    expect(keys).toEqual(expect.arrayContaining(["JO", "AF"]));
  });

  it("seats every organization member, whatever its tier", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    // NATO seats Canada, the Benelux, Norway, Denmark, Portugal and Iceland;
    // the Warsaw Pact seats Albania. All nine are Background Nations — never
    // playable, never sphere-macro — so the old tier test skipped them, and a
    // member with no row has no standing: it vanished from the Influence tab's
    // own member roster, and nothing could measure it against the leave gate,
    // so a bloc could not lose a member it had no standing for.
    await seedCountryAlignments(db as unknown as Db, "1953-default", ["US"]);
    const seeded = new Set(inserted().map((r) => r.entityId));
    for (const key of ["CA", "NL", "BE", "LU", "NO", "DK", "PT", "IS", "AL"]) {
      expect(seeded.has(key), key).toBe(true);
    }
  });

  it("skips rostered entities that nothing sponsors at all", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    const { WORLD_ENTITY_MANIFESTS } = await import("@/lib/world/worldEntityManifest");
    const { COUNTRY_CONFIGS } = await import("@/lib/constants/countries");
    const { INTERNATIONAL_ORGANIZATIONS } =
      await import("@/lib/constants/internationalOrganizations");
    const { resolveSeedRoster } = await import("@/lib/internationalOrganizations/founding");

    await seedCountryAlignments(db as unknown as Db, "1953-default", ["US"]);
    const seeded = new Set(inserted().map((r) => r.entityId));

    // Colonies and other historical-presence entities are carried in the roster
    // so a future country arrives pre-aligned, but nothing sponsors them, so
    // they get no document. Org members are sponsored and are excluded here.
    const orgMembers = new Set(
      Object.values(INTERNATIONAL_ORGANIZATIONS).flatMap((def) =>
        resolveSeedRoster(def, "1953-default").map(String)
      )
    );
    const inert = WORLD_ENTITY_MANIFESTS["1953-default"]!.entries.filter(
      (e) =>
        e.simulationTier === "historical-presence" &&
        !(e.entityId in COUNTRY_CONFIGS) &&
        !orgMembers.has(e.entityId)
    );
    expect(inert.length).toBeGreaterThan(0);
    expect(inert.filter((e) => seeded.has(e.entityId)).map((e) => e.entityId)).toEqual([]);
  });

  it("skips an implemented country absent from the preset roster it was handed", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    // DD is a CountryId, but 2019-default does not contain it, so the caller
    // never passes it — and nothing is written for it.
    await seedCountryAlignments(db as unknown as Db, "2019-default", ["US"]);
    expect(inserted().map((r) => r.entityId)).not.toContain("DD");
  });

  it("writes rows that satisfy the invariant and carry the era key", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    await seedCountryAlignments(db as unknown as Db, "1953-default", ["YU"]);
    const row = inserted()[0];
    const sum = Object.values(row.shares).reduce((a, b) => a + b, 0) + row.nonAligned;
    expect(sum).toBe(100);
    expect(row.eraKey).toBe("cold-war");
    expect(row.previous).toBeNull();
    expect(row.turn).toBe(0);
    // 1953 is bipolar — no NAM pole yet.
    expect(Object.keys(row.shares).sort()).toEqual(["EAST", "WEST"]);
  });

  it("uses the start's pole set, so a 2019 world gets three poles", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    await seedCountryAlignments(db as unknown as Db, "2019-default", ["US"]);
    expect(Object.keys(inserted()[0].shares).sort()).toEqual(["BEIJING", "MOSCOW", "WASHINGTON"]);
    expect(inserted()[0].eraKey).toBe("post-cold-war");
  });

  it("is idempotent — a re-run over an already-seeded world writes nothing", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    await seedCountryAlignments(db as unknown as Db, "1953-default", ["US"]);
    const firstPass = inserted().map((r) => r.entityId);
    expect(firstPass.length).toBeGreaterThan(0);

    // Feed the first pass's own output back as the existing rows.
    vi.clearAllMocks();
    db = createMockDb();
    existing(firstPass);
    const n = await seedCountryAlignments(db as unknown as Db, "1953-default", ["US"]);
    expect(n).toBe(0);
    expect(inserted()).toEqual([]);
  });

  it("leaves one existing row alone without suppressing the rest", async () => {
    // The blanket-stub version of this test could not tell "US was skipped"
    // from "nothing ran at all" — every entity read back as already present.
    existing(["US"]);
    const { seedCountryAlignments } = await import("./seedAlignment");
    const n = await seedCountryAlignments(db as unknown as Db, "1953-default", ["US", "UK"]);
    const keys = inserted().map((r) => r.entityId);
    expect(keys).not.toContain("US");
    expect(keys).toContain("UK");
    expect(n).toBe(keys.length);
  });

  it("clears rows left behind by the countryId-to-entityId re-key", async () => {
    const { seedCountryAlignments } = await import("./seedAlignment");
    await seedCountryAlignments(db as unknown as Db, "1953-default", ["US"]);
    expect(db.collection("countryAlignments").deleteMany).toHaveBeenCalledWith({
      entityId: { $exists: false },
    });
  });
});
