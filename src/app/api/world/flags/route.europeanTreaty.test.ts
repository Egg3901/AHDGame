import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
const getDb = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mongodb", () => ({ getDb }));
import { GET } from "./route";
let db: ReturnType<typeof createMockDb>;
beforeEach(() => {
  db = createMockDb();
  getDb.mockResolvedValue(db);
  db.collection("organizationMemberships").find.mockReturnValue({
    toArray: async () => [{ countryId: "DE" }, { countryId: "UK" }],
  });
});
describe("Maastricht availability in world flags", () => {
  it.each([
    [1, "community", []],
    [55, "community", ["DE", "UK"]],
    [200, "union", []],
  ])("uses live date and treaty stage at turn %s", async (currentTurn, stage, expected) => {
    db.collection("gameState").findOne.mockResolvedValue({
      preset: "1991-default",
      startingYear: 1991,
      currentTurn,
      europeanIntegration: {
        stage,
        source: "historical-seed",
        establishedTurn: 1,
        ratifications: {},
      },
    });
    const response = await GET();
    expect((await response.json()).maastrichtEligibleCountries).toEqual(expected);
  });
});
