import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { regionalDefaultLaws } from "@/lib/politicalLegislation/regionalDefaults";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

async function get(stateId: string): Promise<Record<string, number>> {
  const { getDb } = await import("@/lib/mongodb");
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  const { GET } = await import("./route");
  const res = await GET(
    new Request(`http://localhost/api/game/current-policies?stateId=${stateId}`)
  );
  return (await res.json()) as Record<string, number>;
}

describe("GET /api/game/current-policies — regional defaults for new-generation `both` laws", () => {
  const bothLaw = getCatalog("RU").find(
    (law) => law.kind !== "tax" && law.allowedScope === "both"
  )!;
  const nationalLaw = getCatalog("RU").find((law) => law.allowedScope === "national")!;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    db = createMockDb();
    db.collection("statePolicies").find.mockReturnValue({ toArray: async () => [] });
    db.collection("governorExecutiveOrders").find.mockReturnValue({ toArray: async () => [] });
    db.collection("states").findOne.mockResolvedValue({ _id: "MOW", countryId: "RU" });
  });

  it("fills level 0 for every `both` law of the region's country when no row exists", async () => {
    const out = await get("MOW");
    for (const law of regionalDefaultLaws("RU")) {
      expect(out[law.id], `${law.id} missing from the region's current-policy map`).toBe(0);
    }
  });

  it("does not invent entries for national-only laws", async () => {
    const out = await get("MOW");
    expect(out[nationalLaw.id]).toBeUndefined();
  });

  it("does not override a real statePolicies row", async () => {
    db.collection("statePolicies").find.mockReturnValue({
      toArray: async () => [{ legislationTypeId: bothLaw.id, policyOptionIndex: 3 }],
    });
    const out = await get("MOW");
    expect(out[bothLaw.id]).toBe(3);
  });

  it("adds nothing for a national pseudo-stateId — the national rows are seeded", async () => {
    db.collection("states").findOne.mockResolvedValue(null);
    const out = await get("federal");
    expect(Object.keys(out)).toEqual([]);
  });

  it("adds nothing for a country with no new-generation catalog", async () => {
    db.collection("states").findOne.mockResolvedValue({ _id: "IE-D", countryId: "IE" });
    const out = await get("IE-D");
    expect(Object.keys(out)).toEqual([]);
  });
});
