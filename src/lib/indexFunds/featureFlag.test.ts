import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("index funds feature flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getIndexFundsMode", () => {
    it("defaults to 'off' for absent preloaded config", async () => {
      const { getIndexFundsMode } = await import("./featureFlag");
      await expect(getIndexFundsMode(null)).resolves.toBe("off");
    });

    it("returns the mode from a preloaded config without reading the database", async () => {
      const { getDb } = await import("@/lib/mongodb");
      const { getIndexFundsMode } = await import("./featureFlag");

      await expect(getIndexFundsMode({ indexFundsMode: "partial" })).resolves.toBe("partial");
      await expect(getIndexFundsMode({ indexFundsMode: "full" })).resolves.toBe("full");
      await expect(getIndexFundsMode({ indexFundsMode: "off" })).resolves.toBe("off");
      expect(getDb).not.toHaveBeenCalled();
    });

    it("maps legacy indexFundsEnabled=true to full when mode is absent", async () => {
      const { getIndexFundsMode } = await import("./featureFlag");
      await expect(getIndexFundsMode({ indexFundsEnabled: true })).resolves.toBe("full");
    });

    it("reads gameConfig when no preloaded config is provided", async () => {
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: () => ({
          findOne: vi.fn().mockResolvedValue({ _id: "default", indexFundsMode: "full" }),
        }),
      } as never);

      const { getIndexFundsMode } = await import("./featureFlag");
      await expect(getIndexFundsMode()).resolves.toBe("full");
    });
  });

  describe("isIndexFundsEnabled", () => {
    it("returns false for 'off'", async () => {
      const { isIndexFundsEnabled } = await import("./featureFlag");
      await expect(isIndexFundsEnabled({ indexFundsMode: "off" })).resolves.toBe(false);
    });

    it("returns true for 'partial'", async () => {
      const { isIndexFundsEnabled } = await import("./featureFlag");
      await expect(isIndexFundsEnabled({ indexFundsMode: "partial" })).resolves.toBe(true);
    });

    it("returns true for 'full'", async () => {
      const { isIndexFundsEnabled } = await import("./featureFlag");
      await expect(isIndexFundsEnabled({ indexFundsMode: "full" })).resolves.toBe(true);
    });
  });

  describe("isIndexFundsFullMode", () => {
    it("returns false for 'off'", async () => {
      const { isIndexFundsFullMode } = await import("./featureFlag");
      await expect(isIndexFundsFullMode({ indexFundsMode: "off" })).resolves.toBe(false);
    });

    it("returns false for 'partial'", async () => {
      const { isIndexFundsFullMode } = await import("./featureFlag");
      await expect(isIndexFundsFullMode({ indexFundsMode: "partial" })).resolves.toBe(false);
    });

    it("returns true for 'full'", async () => {
      const { isIndexFundsFullMode } = await import("./featureFlag");
      await expect(isIndexFundsFullMode({ indexFundsMode: "full" })).resolves.toBe(true);
    });
  });
});
