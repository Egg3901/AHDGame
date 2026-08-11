import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindOne = vi.fn();

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      findOne: mockFindOne,
    }),
  })),
}));

describe("isRegionalConditionsOverviewEnabled", () => {
  beforeEach(() => {
    mockFindOne.mockReset();
  });

  it("returns false when config is absent", async () => {
    mockFindOne.mockResolvedValue(null);
    const { isRegionalConditionsOverviewEnabled } = await import("./featureFlag");
    expect(await isRegionalConditionsOverviewEnabled()).toBe(false);
  });

  it("returns false when flag is undefined", async () => {
    const { isRegionalConditionsOverviewEnabled } = await import("./featureFlag");
    expect(await isRegionalConditionsOverviewEnabled({})).toBe(false);
  });

  it("returns true only when explicitly enabled", async () => {
    const { isRegionalConditionsOverviewEnabled } = await import("./featureFlag");
    expect(
      await isRegionalConditionsOverviewEnabled({ regionalConditionsOverviewEnabled: true })
    ).toBe(true);
    expect(
      await isRegionalConditionsOverviewEnabled({ regionalConditionsOverviewEnabled: false })
    ).toBe(false);
  });

  it("reads gameConfig when no preloaded config is provided", async () => {
    mockFindOne.mockResolvedValue({ regionalConditionsOverviewEnabled: true });
    const { isRegionalConditionsOverviewEnabled } = await import("./featureFlag");
    expect(await isRegionalConditionsOverviewEnabled()).toBe(true);
    expect(mockFindOne).toHaveBeenCalled();
  });
});
