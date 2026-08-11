import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("isIntOrgAlignmentEnabled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the preloaded projection without touching the database", async () => {
    const { isIntOrgAlignmentEnabled } = await import("./featureFlag");
    const { getDb } = await import("@/lib/mongodb");
    expect(await isIntOrgAlignmentEnabled({ intOrgAlignmentEnabled: true })).toBe(true);
    expect(await isIntOrgAlignmentEnabled({ intOrgAlignmentEnabled: false })).toBe(false);
    expect(await isIntOrgAlignmentEnabled({})).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("reads gameState when nothing is preloaded", async () => {
    const findOne = vi.fn().mockResolvedValue({ intOrgAlignmentEnabled: true });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({ collection: () => ({ findOne }) } as never);
    const { isIntOrgAlignmentEnabled } = await import("./featureFlag");
    expect(await isIntOrgAlignmentEnabled()).toBe(true);
  });

  it("fails closed for a missing flag, a missing doc, and a truthy non-true value", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { isIntOrgAlignmentEnabled } = await import("./featureFlag");

    for (const doc of [
      null,
      {},
      { intOrgAlignmentEnabled: "yes" },
      { intOrgAlignmentEnabled: 1 },
    ]) {
      const findOne = vi.fn().mockResolvedValue(doc);
      vi.mocked(getDb).mockResolvedValue({ collection: () => ({ findOne }) } as never);
      expect(await isIntOrgAlignmentEnabled()).toBe(false);
    }
  });
});
