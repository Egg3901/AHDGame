import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMongoClientMock } = vi.hoisted(() => ({
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
}));

function makeMongoError(code: number): { code: number; message: string } {
  return { code, message: `MongoError ${code}` };
}

describe("runTransactionWithSessionRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits the transaction when it succeeds on the first session", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (cb: () => Promise<string>) => cb());
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction, endSession }),
    });

    const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");
    const run = vi.fn().mockResolvedValue("result");

    await expect(runTransactionWithSessionRetry(() => getMongoClientMock(), run)).resolves.toBe(
      "result"
    );

    expect(getMongoClientMock).toHaveBeenCalledOnce();
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("retries code 117 on a fresh session and resolves", async () => {
    const withTransactionFail = vi.fn().mockRejectedValue(makeMongoError(117));
    const withTransactionOk = vi.fn(async (cb: () => Promise<string>) => cb());
    const sessions = [
      { withTransaction: withTransactionFail, endSession: vi.fn().mockResolvedValue(undefined) },
      { withTransaction: withTransactionOk, endSession: vi.fn().mockResolvedValue(undefined) },
    ];
    let call = 0;
    getMongoClientMock.mockImplementation(async () => ({
      startSession: () => sessions[Math.min(call++, sessions.length - 1)],
    }));

    const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");
    const run = vi.fn().mockResolvedValue("recovered");

    await expect(runTransactionWithSessionRetry(() => getMongoClientMock(), run)).resolves.toBe(
      "recovered"
    );

    expect(sessions[0].endSession).toHaveBeenCalledOnce();
    expect(withTransactionOk).toHaveBeenCalledOnce();
  });

  it("retries code 117 up to maxAttempts then rethrows", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransactionFail = vi.fn().mockRejectedValue(makeMongoError(117));
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction: withTransactionFail, endSession }),
    });

    const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");
    const run = vi.fn().mockResolvedValue("unused");
    const onRetry = vi.fn();

    await expect(
      runTransactionWithSessionRetry(() => getMongoClientMock(), run, {
        maxAttempts: 3,
        sleep: () => Promise.resolve(),
        onRetry,
      })
    ).rejects.toMatchObject({ code: 117 });

    expect(withTransactionFail).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(endSession).toHaveBeenCalledTimes(3);
  });

  it("propagates non-117 errors immediately", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransactionFail = vi.fn().mockRejectedValue(makeMongoError(112));
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction: withTransactionFail, endSession }),
    });

    const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");

    await expect(
      runTransactionWithSessionRetry(
        () => getMongoClientMock(),
        async () => {
          throw new Error("unrelated failure");
        }
      )
    ).rejects.toMatchObject({ code: 112 });

    expect(getMongoClientMock).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("ends the session on a callback throw covered by retry", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransactionFail = vi.fn().mockRejectedValue(new Error("boom"));
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction: withTransactionFail, endSession }),
    });

    const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");

    await expect(
      runTransactionWithSessionRetry(
        () => getMongoClientMock(),
        async () => {
          throw new Error("boom");
        }
      )
    ).rejects.toThrow("boom");

    expect(endSession).toHaveBeenCalledOnce();
  });
});
