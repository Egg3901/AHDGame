import { beforeEach, describe, expect, it, vi } from "vitest";

const { commandMock, getMongoClientMock } = vi.hoisted(() => ({
  commandMock: vi.fn(),
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
}));

describe("assertTransactionSupportAtBoot", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    commandMock.mockResolvedValue({});
    getMongoClientMock.mockResolvedValue({
      db: vi.fn(() => ({ command: commandMock })),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("probes the deployment once and caches the result", async () => {
    const { assertTransactionSupportAtBoot } = await import("./transactionSupport");

    const results = await Promise.all([
      assertTransactionSupportAtBoot(),
      assertTransactionSupportAtBoot(),
    ]);

    expect(results).toEqual([false, false]);
    expect(getMongoClientMock).toHaveBeenCalledTimes(1);
    expect(commandMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a rejected probe instead of caching the failure", async () => {
    getMongoClientMock.mockRejectedValueOnce(new Error("connection refused"));
    const { assertTransactionSupportAtBoot } = await import("./transactionSupport");

    await expect(assertTransactionSupportAtBoot()).rejects.toThrow("connection refused");

    getMongoClientMock.mockResolvedValue({
      db: vi.fn(() => ({ command: commandMock })),
    });
    await expect(assertTransactionSupportAtBoot()).resolves.toBe(false);
    expect(getMongoClientMock).toHaveBeenCalledTimes(2);
  });
});
