import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("seedInternationalOrganizations — founding-year gate", () => {
  let db: MockDb;

  function freshDb(): MockDb {
    const next = createMockDb();
    // No existing rows anywhere → the seeder would insert everything it wants.
    // The seeder reads both existence sets with a single find() per collection,
    // and the mock cursor's toArray() already resolves to [], so an empty world
    // is the default; these stubs just say so explicitly.
    next.collection("organizationMemberships").find().toArray.mockResolvedValue([]);
    next.collection("organizationLeadership").find().toArray.mockResolvedValue([]);
    return next;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = freshDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  // Rows are staged and written with one insertMany per collection, so this
  // flattens the batches back into the per-row shape the assertions below use.
  // Pointed at insertMany deliberately rather than teaching the mock to fan
  // insertMany out into insertOne — that would keep these assertions green
  // whether or not anyone had re-read them.
  function inserted(col: "organizationMemberships" | "organizationLeadership") {
    return db.collectionMocks[col]!.insertMany.mock.calls.flatMap(
      (c) => c[0] as { organizationId: string; countryId?: string }[]
    );
  }

  it("skips the EU entirely for the 1953 preset (memberships AND leadership)", async () => {
    const { seedInternationalOrganizations } = await import("./seedInternationalOrganizations");
    await seedInternationalOrganizations(db as unknown as Db, vi.fn(), "1953-default");

    expect(inserted("organizationMemberships").some((r) => r.organizationId === "EU")).toBe(false);
    expect(inserted("organizationLeadership").some((r) => r.organizationId === "EU")).toBe(false);
    // NATO still seeds its 1953 era roster.
    const nato = inserted("organizationMemberships").filter((r) => r.organizationId === "NATO");
    expect(nato.map((r) => r.countryId).sort()).toEqual([
      "BE",
      "CA",
      "DK",
      "FR",
      "GR",
      "IS",
      "IT",
      "LU",
      "NL",
      "NO",
      "PT",
      "TR",
      "UK",
      "US",
    ]);
  });

  it("skips the EU for 1979 and 1991 presets", async () => {
    const { seedInternationalOrganizations } = await import("./seedInternationalOrganizations");
    for (const preset of ["1979-default", "1991-default"]) {
      db = freshDb();
      await seedInternationalOrganizations(db as unknown as Db, vi.fn(), preset);
      expect(inserted("organizationMemberships").some((r) => r.organizationId === "EU")).toBe(
        false
      );
      expect(inserted("organizationLeadership").some((r) => r.organizationId === "EU")).toBe(false);
    }
  });

  it("seeds Commonwealth (UK, NG) at every preset", async () => {
    const { seedInternationalOrganizations } = await import("./seedInternationalOrganizations");
    for (const preset of ["1953-default", "1979-default", "1991-default", "2019-default"]) {
      db = freshDb();
      await seedInternationalOrganizations(db as unknown as Db, vi.fn(), preset);
      const cw = inserted("organizationMemberships").filter(
        (r) => r.organizationId === "COMMONWEALTH"
      );
      expect(cw.map((r) => r.countryId).sort()).toEqual(["NG", "UK"]);
    }
  });

  it("seeds the Warsaw Pact bloc at 1953/1979 and skips it at 1991/2019 (dissolved)", async () => {
    const { seedInternationalOrganizations } = await import("./seedInternationalOrganizations");
    for (const preset of ["1953-default", "1979-default"]) {
      db = freshDb();
      await seedInternationalOrganizations(db as unknown as Db, vi.fn(), preset);
      const wp = inserted("organizationMemberships").filter(
        (r) => r.organizationId === "WARSAW_PACT"
      );
      // Albania signed in 1955 and had withdrawn by 1968, so it belongs to the
      // 1953 roster and not the 1979 one.
      const core = ["BG", "CS", "DD", "HU", "PL", "RO", "RU"];
      expect(wp.map((r) => r.countryId).sort()).toEqual(
        preset === "1953-default" ? ["AL", ...core] : core
      );
    }
    for (const preset of ["1991-default", "2019-default"]) {
      db = freshDb();
      await seedInternationalOrganizations(db as unknown as Db, vi.fn(), preset);
      expect(
        inserted("organizationMemberships").some((r) => r.organizationId === "WARSAW_PACT")
      ).toBe(false);
      expect(
        inserted("organizationLeadership").some((r) => r.organizationId === "WARSAW_PACT")
      ).toBe(false);
    }
  });

  it("seeds COMECON at 1953/1979 and skips it at 1991/2019 (dissolved)", async () => {
    const { seedInternationalOrganizations } = await import("./seedInternationalOrganizations");
    for (const preset of ["1953-default", "1979-default"]) {
      db = freshDb();
      await seedInternationalOrganizations(db as unknown as Db, vi.fn(), preset);
      const cc = inserted("organizationMemberships").filter((r) => r.organizationId === "COMECON");
      // Jan 1949 founders + DD (joined 1950). Same roster at both cold-war presets.
      expect(cc.map((r) => r.countryId).sort()).toEqual(["BG", "CS", "DD", "HU", "PL", "RO", "RU"]);
      expect(inserted("organizationLeadership").some((r) => r.organizationId === "COMECON")).toBe(
        true
      );
    }
    for (const preset of ["1991-default", "2019-default"]) {
      db = freshDb();
      await seedInternationalOrganizations(db as unknown as Db, vi.fn(), preset);
      expect(inserted("organizationMemberships").some((r) => r.organizationId === "COMECON")).toBe(
        false
      );
      expect(inserted("organizationLeadership").some((r) => r.organizationId === "COMECON")).toBe(
        false
      );
    }
  });

  it("leaves rows that already exist alone, and still seeds the rest", async () => {
    // Idempotency now rests on one up-front read rather than a findOne per
    // member, so it needs its own coverage: if the existence set were ignored,
    // or read into the wrong key shape, a re-seed would duplicate every row.
    db.collectionMocks
      .organizationMemberships!.find()
      .toArray.mockResolvedValue([{ organizationId: "NATO", countryId: "US" }]);
    db.collectionMocks
      .organizationLeadership!.find()
      .toArray.mockResolvedValue([{ organizationId: "NATO" }]);

    const { seedInternationalOrganizations } = await import("./seedInternationalOrganizations");
    const result = await seedInternationalOrganizations(
      db as unknown as Db,
      vi.fn(),
      "1953-default"
    );

    const nato = inserted("organizationMemberships").filter((r) => r.organizationId === "NATO");
    expect(nato.map((r) => r.countryId)).not.toContain("US");
    expect(nato.map((r) => r.countryId)).toContain("UK");
    expect(inserted("organizationLeadership").some((r) => r.organizationId === "NATO")).toBe(false);
    // The reported counts must describe what was actually written.
    expect(result.membershipsInserted).toBe(inserted("organizationMemberships").length);
    expect(result.leadershipInserted).toBe(inserted("organizationLeadership").length);
  });

  it("seeds the EU (DE, IE) plus leadership for the 2019 preset", async () => {
    const { seedInternationalOrganizations } = await import("./seedInternationalOrganizations");
    await seedInternationalOrganizations(db as unknown as Db, vi.fn(), "2019-default");

    const eu = inserted("organizationMemberships").filter((r) => r.organizationId === "EU");
    expect(eu.map((r) => r.countryId).sort()).toEqual(["DE", "IE"]);
    expect(inserted("organizationLeadership").some((r) => r.organizationId === "EU")).toBe(true);
  });

  it("seeds the Non-Aligned Movement per era: skipped at 1953, YU+NG at 1979, empty after", async () => {
    const { seedInternationalOrganizations } = await import("./seedInternationalOrganizations");

    // 1953 predates the 1961 founding — not seeded at all.
    db = freshDb();
    await seedInternationalOrganizations(db as unknown as Db, vi.fn(), "1953-default");
    expect(
      inserted("organizationMemberships").some((r) => r.organizationId === "NON_ALIGNED")
    ).toBe(false);
    expect(inserted("organizationLeadership").some((r) => r.organizationId === "NON_ALIGNED")).toBe(
      false
    );

    // 1979 seats the movement's two in-game members.
    db = freshDb();
    await seedInternationalOrganizations(db as unknown as Db, vi.fn(), "1979-default");
    const nam = inserted("organizationMemberships").filter(
      (r) => r.organizationId === "NON_ALIGNED"
    );
    expect(nam.map((r) => r.countryId).sort()).toEqual(["NG", "YU"]);
    expect(inserted("organizationLeadership").some((r) => r.organizationId === "NON_ALIGNED")).toBe(
      true
    );

    // The modern presets contain no member — the org exists but seats nobody.
    for (const preset of ["1991-default", "2019-default", "2023-default"]) {
      db = freshDb();
      await seedInternationalOrganizations(db as unknown as Db, vi.fn(), preset);
      expect(
        inserted("organizationMemberships").some((r) => r.organizationId === "NON_ALIGNED")
      ).toBe(false);
      // ...but it IS founded, so it gets a leadership row and is joinable.
      expect(
        inserted("organizationLeadership").some((r) => r.organizationId === "NON_ALIGNED")
      ).toBe(true);
    }
  });
});
