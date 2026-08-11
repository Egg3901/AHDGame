import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { PatreonMemberRecord } from "@/lib/patreon/members";

vi.mock("@/lib/patreon/members", () => ({ listPatreonMembers: vi.fn() }));
vi.mock("@/lib/patreon/service", () => ({
  applyPatreonStatus: vi.fn(),
  clearExpiredPatreonBenefits: vi.fn(),
  findUserByPatreonUserId: vi.fn(),
  startPatreonGracePeriod: vi.fn(),
}));

const DAY = 24 * 60 * 60 * 1000;

function setMembers(members: PatreonMemberRecord[]) {
  return import("@/lib/patreon/members").then(({ listPatreonMembers }) =>
    vi.mocked(listPatreonMembers).mockResolvedValue(members)
  );
}
function setSupporters(db: MockDb, supporters: unknown[]) {
  db.collectionMocks["users"] = db.collectionMocks["users"] ?? undefined;
  const users = db.collection("users");
  vi.mocked(users.find).mockReturnValue({
    toArray: vi.fn().mockResolvedValue(supporters),
  } as never);
  return users;
}

describe("runReconcile", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("grants a new active patron matched by patreonUserId and backfills id", async () => {
    const userId = new ObjectId();
    await setMembers([
      { patreonUserId: "p1", email: "new@example.com", tier: "supporter", active: true },
    ]);
    const service = await import("@/lib/patreon/service");
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue({
      _id: userId,
      username: "newbie",
      email: "new@example.com",
      patreonTier: null,
    } as never);
    setSupporters(db, []);

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.toGrant).toEqual([
      { username: "newbie", email: "new@example.com", from: null, to: "supporter" },
    ]);
    expect(service.applyPatreonStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId, tier: "supporter", patreonUserId: "p1" })
    );
  });

  it("ignores free-tier patrons (not active, not granted)", async () => {
    await setMembers([
      { patreonUserId: "pf", email: "free@example.com", tier: null, active: false },
    ]);
    setSupporters(db, []);
    const service = await import("@/lib/patreon/service");

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.toGrant).toHaveLength(0);
    expect(res.counts.activePaidPatrons).toBe(0);
    expect(service.applyPatreonStatus).not.toHaveBeenCalled();
  });

  it("reports an active patron with no AHD user (unmatched), no write", async () => {
    await setMembers([
      { patreonUserId: "px", email: "ghost@example.com", tier: "supporter-plus", active: true },
    ]);
    const service = await import("@/lib/patreon/service");
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue(null);
    // email lookup also misses
    const users = setSupporters(db, []);
    vi.mocked(users.findOne).mockResolvedValue(null);

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.unmatchedActivePatrons).toEqual([
      { email: "ghost@example.com", tier: "supporter-plus" },
    ]);
    expect(res.toGrant).toHaveLength(0);
    expect(service.applyPatreonStatus).not.toHaveBeenCalled();
  });

  it("starts grace for a lapsed supporter matched by email", async () => {
    const userId = new ObjectId();
    await setMembers([
      { patreonUserId: "p2", email: "lapsed@example.com", tier: null, active: false },
    ]);
    setSupporters(db, [
      {
        _id: userId,
        username: "lapser",
        email: "lapsed@example.com",
        patreonTier: "supporter",
        patreonExpiresAt: null,
      },
    ]);
    const service = await import("@/lib/patreon/service");

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.toDerole).toEqual([
      { username: "lapser", email: "lapsed@example.com", tier: "supporter" },
    ]);
    expect(service.startPatreonGracePeriod).toHaveBeenCalledWith(expect.anything(), userId);
  });

  it("NEVER deroles an AHD supporter absent from Patreon data", async () => {
    const userId = new ObjectId();
    await setMembers([]); // nobody in Patreon
    setSupporters(db, [
      {
        _id: userId,
        username: "manual",
        email: "manual@example.com",
        patreonTier: "supporter",
        patreonExpiresAt: null,
      },
    ]);
    const service = await import("@/lib/patreon/service");

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.unmatchedAhdSupporters).toEqual([
      { username: "manual", email: "manual@example.com", tier: "supporter" },
    ]);
    expect(res.toDerole).toHaveLength(0);
    expect(service.startPatreonGracePeriod).not.toHaveBeenCalled();
  });

  it("expires a supporter whose grace has elapsed", async () => {
    const userId = new ObjectId();
    await setMembers([]);
    setSupporters(db, [
      {
        _id: userId,
        username: "expired",
        email: "expired@example.com",
        patreonTier: "supporter",
        patreonExpiresAt: new Date(Date.now() - DAY),
      },
    ]);
    const service = await import("@/lib/patreon/service");

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.expired).toHaveLength(1);
    expect(service.clearExpiredPatreonBenefits).toHaveBeenCalledWith(expect.anything(), userId);
    // Expiry takes priority: not double-counted as a derole.
    expect(res.toDerole).toHaveLength(0);
  });

  it("SKIPS a Stripe subscriber absent from Patreon: no derole, no grace, no expiry", async () => {
    const userId = new ObjectId();
    await setMembers([]); // Stripe subscribers never appear in Patreon's member list
    setSupporters(db, [
      {
        _id: userId,
        username: "stripey",
        email: "stripe@example.com",
        patreonTier: "supporter-plus",
        supporterProvider: "stripe",
        patreonExpiresAt: null,
      },
    ]);
    const service = await import("@/lib/patreon/service");

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.toDerole).toHaveLength(0);
    expect(res.unmatchedAhdSupporters).toHaveLength(0);
    expect(res.expired).toHaveLength(0);
    expect(service.startPatreonGracePeriod).not.toHaveBeenCalled();
    expect(service.clearExpiredPatreonBenefits).not.toHaveBeenCalled();
  });

  it("does NOT downgrade a Stripe subscriber when Patreon reports a lower tier", async () => {
    const userId = new ObjectId();
    await setMembers([
      { patreonUserId: "ps", email: "stripe@example.com", tier: "supporter", active: true },
    ]);
    const service = await import("@/lib/patreon/service");
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue({
      _id: userId,
      username: "stripey",
      email: "stripe@example.com",
      patreonTier: "supporter-plus",
      supporterProvider: "stripe",
    } as never);
    setSupporters(db, []);

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.toGrant).toHaveLength(0);
    expect(service.applyPatreonStatus).not.toHaveBeenCalled();
  });

  it("UPGRADES a Stripe subscriber when Patreon reports a higher tier (higher tier wins)", async () => {
    const userId = new ObjectId();
    await setMembers([
      { patreonUserId: "ps", email: "stripe@example.com", tier: "supporter-plus", active: true },
    ]);
    const service = await import("@/lib/patreon/service");
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue({
      _id: userId,
      username: "stripey",
      email: "stripe@example.com",
      patreonTier: "supporter",
      supporterProvider: "stripe",
    } as never);
    setSupporters(db, []);

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, true);

    expect(res.toGrant).toEqual([
      { username: "stripey", email: "stripe@example.com", from: "supporter", to: "supporter-plus" },
    ]);
    expect(service.applyPatreonStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId, tier: "supporter-plus" })
    );
  });

  it("dry run computes lists but writes nothing", async () => {
    const userId = new ObjectId();
    await setMembers([
      { patreonUserId: "p1", email: "new@example.com", tier: "supporter", active: true },
    ]);
    const service = await import("@/lib/patreon/service");
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue({
      _id: userId,
      username: "newbie",
      email: "new@example.com",
      patreonTier: null,
    } as never);
    setSupporters(db, []);

    const { runReconcile } = await import("./route");
    const res = await runReconcile(db as unknown as Db, false);

    expect(res.dryRun).toBe(true);
    expect(res.toGrant).toHaveLength(1);
    expect(service.applyPatreonStatus).not.toHaveBeenCalled();
  });
});
