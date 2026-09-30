import { expect, it, vi } from "vitest";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCharacter } from "@/lib/test-utils/factories";
import { GET } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/unions/unionContributionIncome", () => ({
  unionContributionIncomePerTurn: async () => 0,
}));
it("projects 1991 income from the same era basis as campaign prices", async () => {
  const db = createMockDb();
  const character = makeCharacter({ countryId: "US", donorBaseLevel: 10 });
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { userId: character.userId.toString() },
  } as never);
  db.collection("characters").findOne.mockResolvedValue(character);
  db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
  const beforeResponse = await GET();
  expect(beforeResponse.status).toBe(200);
  const before = await beforeResponse.json();
  db.collection("gameConfig").findOne.mockResolvedValue({ campaignEraPriceLevelEnabled: true });
  const afterResponse = await GET();
  expect(afterResponse.status).toBe(200);
  const after = await afterResponse.json();
  expect(
    Math.abs(after.income.netPerTurn - before.income.netPerTurn * 0.35808)
  ).toBeLessThanOrEqual(1);
});
