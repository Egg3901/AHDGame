import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertTransactionSupportMock, getMongoClientMock } = vi.hoisted(() => ({
  assertTransactionSupportMock: vi.fn(),
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: assertTransactionSupportMock,
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
}));

describe("runWithOptionalTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips creating a session when transactions are unsupported", async () => {
    assertTransactionSupportMock.mockResolvedValue(false);
    const runInTransaction = vi.fn();
    const runWithoutTransaction = vi.fn().mockResolvedValue("sequential-result");
    const { runWithOptionalTransaction } = await import("./runWithOptionalTransaction");

    await expect(runWithOptionalTransaction(runInTransaction, runWithoutTransaction)).resolves.toBe(
      "sequential-result"
    );
    expect(getMongoClientMock).not.toHaveBeenCalled();
    expect(runInTransaction).not.toHaveBeenCalled();
    expect(runWithoutTransaction).toHaveBeenCalledOnce();
  });

  it("preserves the transaction path when transactions are supported", async () => {
    assertTransactionSupportMock.mockResolvedValue(true);
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (callback: () => Promise<string>) => callback());
    const startSession = vi.fn(() => ({ withTransaction, endSession }));
    getMongoClientMock.mockResolvedValue({ startSession });
    const runInTransaction = vi.fn().mockResolvedValue("transaction-result");
    const runWithoutTransaction = vi.fn();
    const { runWithOptionalTransaction } = await import("./runWithOptionalTransaction");

    await expect(runWithOptionalTransaction(runInTransaction, runWithoutTransaction)).resolves.toBe(
      "transaction-result"
    );
    expect(startSession).toHaveBeenCalledOnce();
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(runInTransaction).toHaveBeenCalledOnce();
    expect(runWithoutTransaction).not.toHaveBeenCalled();
    expect(endSession).toHaveBeenCalledOnce();
  });
});
