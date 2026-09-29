import { describe, it, expect, vi } from "vitest";
import { getDb } from "@/lib/mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { GET } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
describe("world campaign pricing flag", () => {
  it.each([true, false, undefined])(
    "exposes the effective price scalar for flag %s",
    async (enabled) => {
      const db = createMockDb();
      db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
      db.collection("gameConfig").findOne.mockResolvedValue({
        campaignEraPriceLevelEnabled: enabled,
      });
      vi.mocked(getDb).mockResolvedValue(db as never);
      const data = await (await GET()).json();
      expect(data.campaignPriceLevel).toBe(enabled ? 0.35808 : 1);
    }
  );
});
