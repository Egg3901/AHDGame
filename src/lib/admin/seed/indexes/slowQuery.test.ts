import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureIndexMock } = vi.hoisted(() => ({
  ensureIndexMock: vi.fn(),
}));

vi.mock("./helpers", () => ({
  ensureIndex: ensureIndexMock,
}));

import { seedSlowQueryIndexes } from "./slowQuery";

describe("seedSlowQueryIndexes", () => {
  beforeEach(() => {
    ensureIndexMock.mockReset();
  });

  it("creates the GlitchTip slow-query field-filter indexes (issue #3343)", async () => {
    const db = {} as unknown as Db;
    await seedSlowQueryIndexes(db, vi.fn());

    const created = ensureIndexMock.mock.calls.map((call) => ({
      collection: call[1],
      key: call[2],
      name: call[3]?.name,
    }));

    // federalBudget.findOne({ countryId }) — per-turn envelope calculators
    expect(created).toContainEqual({
      collection: "federalBudget",
      key: { countryId: 1 },
      name: "federalBudget_countryId",
    });

    // governmentApprovals.findOne({ countryId }).sort({ updatedAt: -1 })
    expect(created).toContainEqual({
      collection: "governmentApprovals",
      key: { countryId: 1, updatedAt: -1 },
      name: "governmentApprovals_countryId_updatedAt",
    });

    // exchangeRates.findOne({ countryId }) — national crisis snapshot
    expect(created).toContainEqual({
      collection: "exchangeRates",
      key: { countryId: 1 },
      name: "exchangeRates_countryId",
    });

    // countryGameStates.find({ status: "active" }) — registered-country fanout
    expect(created).toContainEqual({
      collection: "countryGameStates",
      key: { status: 1 },
      name: "countryGameStates_status",
    });
  });
});
