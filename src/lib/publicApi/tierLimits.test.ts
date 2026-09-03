import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const USER_ID = new ObjectId().toHexString();

const findOne = vi.fn();

async function mockDb() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: () => ({ findOne }),
  } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { clearPublicApiTierCache } = await import("./tierLimits");
  clearPublicApiTierCache();
  await mockDb();
});

describe("publicApiMaxRequests", () => {
  it("leaves non-supporters and plain Supporter on the base allowance", async () => {
    const { publicApiMaxRequests } = await import("./tierLimits");
    expect(publicApiMaxRequests(null)).toBe(60);
    expect(publicApiMaxRequests("supporter")).toBe(60);
  });

  it("gives Supporter+ 1.5x and Supporter++ 3x", async () => {
    const { publicApiMaxRequests } = await import("./tierLimits");
    expect(publicApiMaxRequests("supporter-plus")).toBe(90);
    expect(publicApiMaxRequests("supporter-plus-plus")).toBe(180);
  });
});

describe("resolvePublicApiTier", () => {
  it("returns the stored tier for an active pledge", async () => {
    findOne.mockResolvedValue({ patreonTier: "supporter-plus-plus", patreonExpiresAt: null });
    const { resolvePublicApiTier } = await import("./tierLimits");
    await expect(resolvePublicApiTier(USER_ID)).resolves.toBe("supporter-plus-plus");
  });

  it("drops a lapsed pledge back to the base allowance", async () => {
    findOne.mockResolvedValue({
      patreonTier: "supporter-plus",
      patreonExpiresAt: new Date(Date.now() - 1_000),
    });
    const { publicApiMaxRequests, resolvePublicApiTier } = await import("./tierLimits");
    const tier = await resolvePublicApiTier(USER_ID);
    expect(tier).toBeNull();
    expect(publicApiMaxRequests(tier)).toBe(60);
  });

  it("returns null for a user with no pledge", async () => {
    findOne.mockResolvedValue({});
    const { resolvePublicApiTier } = await import("./tierLimits");
    await expect(resolvePublicApiTier(USER_ID)).resolves.toBeNull();
  });

  it("memoises the lookup so a busy key does not re-read the user per request", async () => {
    findOne.mockResolvedValue({ patreonTier: "supporter-plus", patreonExpiresAt: null });
    const { resolvePublicApiTier } = await import("./tierLimits");
    await resolvePublicApiTier(USER_ID);
    await resolvePublicApiTier(USER_ID);
    await resolvePublicApiTier(USER_ID);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("fails closed to the base allowance when the database is unavailable", async () => {
    findOne.mockRejectedValue(new Error("mongo down"));
    const { resolvePublicApiTier } = await import("./tierLimits");
    await expect(resolvePublicApiTier(USER_ID)).resolves.toBeNull();
  });

  it("does not cache a failed lookup as a real answer", async () => {
    findOne.mockRejectedValueOnce(new Error("mongo down"));
    findOne.mockResolvedValue({ patreonTier: "supporter-plus-plus", patreonExpiresAt: null });
    const { resolvePublicApiTier } = await import("./tierLimits");
    await expect(resolvePublicApiTier(USER_ID)).resolves.toBeNull();
    await expect(resolvePublicApiTier(USER_ID)).resolves.toBe("supporter-plus-plus");
  });

  it("never queries on a malformed owner id", async () => {
    const { resolvePublicApiTier } = await import("./tierLimits");
    await expect(resolvePublicApiTier("not-an-object-id")).resolves.toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
});
