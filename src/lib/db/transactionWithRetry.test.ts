import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMongoClientMock, assertTransactionSupportMock } = vi.hoisted(() => ({
  getMongoClientMock: vi.fn(),
  assertTransactionSupportMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
}));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: assertTransactionSupportMock,
}));

function makeMongoError(code: number): { code: number; message: string } {
  return { code, message: `MongoError ${code}` };
}

describe("runTransactionWithSessionRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertTransactionSupportMock.mockResolvedValue(true);
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
  it("runs the body with NO session when the deployment has no transaction support", async () => {
    // Ticket #1239: production Mongo is standalone, so starting a transaction
    // fails outright. The body must still run rather than 500 the player.
    assertTransactionSupportMock.mockResolvedValue(false);
    const startSession = vi.fn();
    getMongoClientMock.mockResolvedValue({ startSession });

    const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");
    const run = vi.fn().mockResolvedValue("sequential");
    const onNonAtomic = vi.fn();

    await expect(
      runTransactionWithSessionRetry(() => getMongoClientMock(), run, { onNonAtomic })
    ).resolves.toBe("sequential");

    expect(startSession).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(undefined);
    expect(onNonAtomic).toHaveBeenCalledOnce();
  });

  it.each([20, 263])(
    "propagates code %i instead of re-running the body sequentially",
    async (code) => {
      // withTransaction can fail at COMMIT with the body's writes already
      // applied, so a sequential re-run here would double-apply them. Only the
      // upfront probe may choose the sequential path.
      const endSession = vi.fn().mockResolvedValue(undefined);
      const withTransaction = vi.fn().mockRejectedValue(makeMongoError(code));
      getMongoClientMock.mockResolvedValue({
        startSession: () => ({ withTransaction, endSession }),
      });

      const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");
      const run = vi.fn().mockResolvedValue("unused");
      const onNonAtomic = vi.fn();

      await expect(
        runTransactionWithSessionRetry(() => getMongoClientMock(), run, { onNonAtomic })
      ).rejects.toMatchObject({ code });

      expect(withTransaction).toHaveBeenCalledOnce();
      expect(run).not.toHaveBeenCalled();
      expect(onNonAtomic).not.toHaveBeenCalled();
      expect(endSession).toHaveBeenCalledOnce();
    }
  );

  it("still attempts the transaction when the support probe itself throws", async () => {
    assertTransactionSupportMock.mockRejectedValue(new Error("probe unavailable"));
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (cb: () => Promise<string>) => cb());
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction, endSession }),
    });

    const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");
    const run = vi.fn().mockResolvedValue("atomic");

    await expect(runTransactionWithSessionRetry(() => getMongoClientMock(), run)).resolves.toBe(
      "atomic"
    );

    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
  });
  it("propagates a body error from the sequential path without re-running it", async () => {
    // Regression: the sequential run once sat inside the probe's try/catch, so
    // a body error was swallowed and the body re-ran as a transaction,
    // double-applying every write it had already made.
    assertTransactionSupportMock.mockResolvedValue(false);
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (cb: () => Promise<string>) => cb());
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction, endSession }),
    });

    const { runTransactionWithSessionRetry } = await import("./transactionWithRetry");
    const run = vi.fn().mockRejectedValue(new Error("body failed"));

    await expect(runTransactionWithSessionRetry(() => getMongoClientMock(), run)).rejects.toThrow(
      "body failed"
    );

    expect(run).toHaveBeenCalledOnce();
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
