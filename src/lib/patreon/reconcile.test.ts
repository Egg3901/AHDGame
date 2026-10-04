import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { PatreonTier } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/patreon/members", () => ({ listPatreonMembers: vi.fn() }));
vi.mock("@/lib/patreon/service", () => ({
  applyPatreonStatus: vi.fn(),
  clearExpiredPatreonBenefits: vi.fn(),
  findUserByPatreonUserId: vi.fn(),
  startPatreonGracePeriod: vi.fn(),
}));

describe("runPatreonReconcile audit and retry history", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("persists only pseudonymous unmatched identity and increments retry history per apply pass", async () => {
    const providerId = "private-provider-id";
    const email = "private@example.com";
    const { listPatreonMembers } = await import("@/lib/patreon/members");
    const service = await import("@/lib/patreon/service");
    vi.mocked(listPatreonMembers)
      .mockResolvedValueOnce([
        { patreonUserId: providerId, email, tier: "supporter", active: true },
      ])
      .mockResolvedValueOnce([
        { patreonUserId: providerId, email, tier: "supporter", active: true },
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue(null);
    const users = db.collection("users");
    vi.mocked(users.find).mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) } as never);

    const { runPatreonReconcile } = await import("./reconcile");
    await runPatreonReconcile(db as unknown as Db, true);
    await runPatreonReconcile(db as unknown as Db, true);
    await runPatreonReconcile(db as unknown as Db, true);

    const reports = db.collectionMocks.patreonReconcileUnmatched!;
    expect(reports.bulkWrite).toHaveBeenCalledTimes(2);
    const [firstWrite] = vi.mocked(reports.bulkWrite).mock.calls[0] as unknown as [
      Array<{ updateOne: { filter: { _id: string }; update: Record<string, unknown> } }>,
    ];
    expect(firstWrite[0].updateOne.filter._id).toMatch(/^active_patron:[a-f0-9]{64}$/);
    expect(JSON.stringify(firstWrite)).not.toContain(providerId);
    expect(JSON.stringify(firstWrite)).not.toContain(email);
    expect(firstWrite[0].updateOne.update).toMatchObject({ $inc: { attemptCount: 1 } });
    const resolved = vi.mocked(reports.updateMany).mock.calls.find(([filter]) => {
      const idFilter = filter._id as { $nin?: unknown[] } | undefined;
      return idFilter?.$nin?.length === 0;
    });
    expect(resolved).toBeDefined();
    expect(JSON.stringify(resolved)).toContain('"$nin":[]');
    const runs = db.collectionMocks.patreonReconcileRuns!;
    expect(runs.insertOne).toHaveBeenCalledTimes(3);
    expect(runs.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(String) }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "completed", counts: expect.any(Object) }),
      })
    );
  });

  it("stores sanitized failure type and does not persist provider error text", async () => {
    const { listPatreonMembers } = await import("@/lib/patreon/members");
    vi.mocked(listPatreonMembers).mockRejectedValue(new Error("private@example.com provider body"));
    const { runPatreonReconcile } = await import("./reconcile");

    await expect(runPatreonReconcile(db as unknown as Db, true)).rejects.toThrow(
      "private@example.com provider body"
    );

    const audit = db.collectionMocks.patreonReconcileRuns!;
    const failureWrite = vi
      .mocked(audit.updateOne)
      .mock.calls.find(([, update]) => JSON.stringify(update).includes('"status":"failed"'));
    expect(failureWrite).toBeDefined();
    expect(JSON.stringify(failureWrite)).not.toContain("private@example.com");
    expect(JSON.stringify(failureWrite)).toContain('"errorType":"Error"');
  });

  it("records a skipped attempt when another worker owns the distributed apply lock", async () => {
    const duplicateKey = Object.assign(new Error("duplicate lock key"), { code: 11000 });
    const locks = db.collection("cronLocks");
    vi.mocked(locks.updateOne).mockRejectedValueOnce(duplicateKey);
    const { runPatreonReconcile, PatreonReconcileLockBusyError } = await import("./reconcile");

    await expect(runPatreonReconcile(db as unknown as Db, true)).rejects.toBeInstanceOf(
      PatreonReconcileLockBusyError
    );

    const runs = db.collectionMocks.patreonReconcileRuns!;
    const skipped = vi
      .mocked(runs.updateOne)
      .mock.calls.find(([, update]) => JSON.stringify(update).includes('"status":"skipped"'));
    expect(skipped).toBeDefined();
    expect(JSON.stringify(skipped)).toContain('"skipReason":"lock_held"');
    const { listPatreonMembers } = await import("@/lib/patreon/members");
    expect(listPatreonMembers).not.toHaveBeenCalled();
  });

  it("keeps Stripe ownership when a higher Patreon tier upgrades benefits, then protects it on lapse", async () => {
    const { listPatreonMembers } = await import("@/lib/patreon/members");
    const service = await import("@/lib/patreon/service");
    const user: {
      _id: { toString: () => string };
      username: string;
      email: string;
      patreonTier: PatreonTier;
      supporterProvider: string | null;
      patreonUserId: string;
      patreonExpiresAt: Date | null | undefined;
    } = {
      _id: { toString: () => "stripe-user" },
      username: "player",
      email: "player@example.com",
      patreonTier: "supporter",
      supporterProvider: "stripe",
      patreonUserId: "patron-1",
      patreonExpiresAt: new Date(Date.now() + 60_000),
    };
    const stripeExpiry = user.patreonExpiresAt;
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue(user as never);
    vi.mocked(service.applyPatreonStatus).mockImplementation(async (_db, input) => {
      user.patreonTier = input.tier;
      user.supporterProvider = input.provider ?? "patreon";
      user.patreonExpiresAt = input.expiresAt;
      return { supporterPlusAwarded: false };
    });
    const users = db.collection("users");
    vi.mocked(users.find).mockReturnValue({ toArray: vi.fn().mockResolvedValue([user]) } as never);
    const { runPatreonReconcile } = await import("./reconcile");

    vi.mocked(listPatreonMembers).mockResolvedValueOnce([
      { patreonUserId: "patron-1", email: user.email, tier: "supporter-plus", active: true },
    ]);
    await runPatreonReconcile(db as unknown as Db, true);

    expect(service.applyPatreonStatus).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        tier: "supporter-plus",
        provider: "stripe",
        expiresAt: stripeExpiry,
      }),
      expect.objectContaining({ supporterProvider: "stripe", patreonTier: "supporter" })
    );
    expect(user.patreonExpiresAt).toEqual(stripeExpiry);

    vi.mocked(listPatreonMembers).mockResolvedValueOnce([
      { patreonUserId: "patron-1", email: user.email, tier: null, active: false },
    ]);
    await runPatreonReconcile(db as unknown as Db, true);

    expect(user.supporterProvider).toBe("stripe");
    expect(service.startPatreonGracePeriod).not.toHaveBeenCalled();
    expect(service.clearExpiredPatreonBenefits).not.toHaveBeenCalled();
  });

  it("fails closed when its apply lease expires before a benefit write", async () => {
    const { listPatreonMembers } = await import("@/lib/patreon/members");
    const service = await import("@/lib/patreon/service");
    const user = {
      _id: { toString: () => "patreon-user" },
      username: "player",
      email: "player@example.com",
      patreonTier: null,
      supporterProvider: null,
      patreonUserId: "patron-1",
    };
    vi.mocked(listPatreonMembers).mockResolvedValue([
      { patreonUserId: "patron-1", email: user.email, tier: "supporter", active: true },
    ]);
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue(user as never);
    const locks = db.collection("cronLocks");
    vi.mocked(locks.updateOne)
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 } as never)
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 } as never);

    const { runPatreonReconcile } = await import("./reconcile");
    await expect(runPatreonReconcile(db as unknown as Db, true)).rejects.toThrow(
      "Patreon reconciliation lost its apply lease"
    );
    expect(service.applyPatreonStatus).not.toHaveBeenCalled();
    expect(locks.updateOne).toHaveBeenCalledTimes(3); // acquire, failed renewal, owner-only release
  });
});
