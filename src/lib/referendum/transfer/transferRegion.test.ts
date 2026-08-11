import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./evacuateRegionPolitics", () => ({
  evacuateRegionPolitics: vi.fn().mockResolvedValue({
    nppsRelocated: 6,
    corpsFollowedCeo: 1,
    playersToIndependent: 2,
    partyDocsDeleted: 14,
    officialsDissolved: 11,
    seatsDissolved: 18,
    corpsToTarget: 0,
  }),
}));
vi.mock("./regionScopedCollections", () => ({
  rescopeRegionToCountry: vi.fn().mockResolvedValue([{ collection: "characters", matched: 40 }]),
}));
vi.mock("./convertRegionDoc", () => ({ convertRegionDoc: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/nationalMetrics", () => ({
  computeNationalMetrics: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));

import { transferRegion } from "./transferRegion";
import { evacuateRegionPolitics } from "./evacuateRegionPolitics";
import { convertRegionDoc } from "./convertRegionDoc";
import { computeNationalMetrics } from "@/lib/nationalMetrics";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";

const ARGS = {
  regionId: "NIR",
  fromCountryId: "UK" as const,
  toCountryId: "IE" as const,
  province: "Ulster",
  relocateToRegionId: "LON",
  currentTurn: 300,
};

describe("transferRegion", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("evacuates the region, recomputes metrics, and records both events", async () => {
    db.collection("states").findOne.mockResolvedValue({ _id: "NIR", countryId: "UK" });
    const res = await transferRegion(db as unknown as Db, ARGS);

    expect(res.ok).toBe(true);
    expect(res.skipped).toBeUndefined();
    // Evacuation runs with the relocation target.
    expect(vi.mocked(evacuateRegionPolitics).mock.calls[0][1]).toMatchObject({
      regionId: "NIR",
      relocateToRegionId: "LON",
    });
    expect(convertRegionDoc).toHaveBeenCalledOnce();
    expect(computeNationalMetrics).toHaveBeenCalledOnce();
    // One history event per country.
    const eventCountries = vi.mocked(recordCountryEvent).mock.calls.map((c) => c[1].countryId);
    expect(eventCountries).toContain("UK");
    expect(eventCountries).toContain("IE");
    expect(vi.mocked(recordCountryEvent).mock.calls[0][1].eventType).toBe("region_transferred");
    expect(res.report?.evacuated.officialsDissolved).toBe(11);
  });

  it("is idempotent: a region already in the target country is a no-op", async () => {
    db.collection("states").findOne.mockResolvedValue({ _id: "NIR", countryId: "IE" });
    const res = await transferRegion(db as unknown as Db, ARGS);
    expect(res).toEqual({ ok: true, skipped: "already-transferred" });
    expect(evacuateRegionPolitics).not.toHaveBeenCalled();
    expect(computeNationalMetrics).not.toHaveBeenCalled();
  });

  it("returns region-not-found when the region doc is missing", async () => {
    db.collection("states").findOne.mockResolvedValue(null);
    const res = await transferRegion(db as unknown as Db, ARGS);
    expect(res).toEqual({ ok: false, skipped: "region-not-found" });
    expect(evacuateRegionPolitics).not.toHaveBeenCalled();
  });
});
