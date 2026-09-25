import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";
import { seedMoneyFlowIndexes } from "./moneyFlow";

vi.mock("./helpers", () => ({ ensureIndex: vi.fn().mockResolvedValue(undefined) }));

describe("seedMoneyFlowIndexes", () => {
  it("never expires an in-progress receipt before money flow recovery", async () => {
    await seedMoneyFlowIndexes({} as Db, () => {});

    expect(vi.mocked(ensureIndex)).toHaveBeenCalledWith(
      expect.anything(),
      "nonAtomicMoneyFlowReceipts",
      { updatedAt: 1 },
      expect.objectContaining({
        expireAfterSeconds: 30 * 24 * 60 * 60,
        partialFilterExpression: {
          status: { $in: ["completed", "failed", "compensated"] },
        },
      }),
      expect.any(Function)
    );
  });
});
