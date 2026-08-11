import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn(),
}));

describe("GET /api/admin/referrals/by-user/[userId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns referees with profile href for all-time mode", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    const referrerOid = { toString: () => "507f1f77bcf86cd799439011" };
    const refereeOid = { toString: () => "507f191e810c19729de860ea" };

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockImplementation((_q: unknown, opts?: { projection?: unknown }) => {
              if (opts?.projection && Object.keys(opts.projection).length === 1) {
                return Promise.resolve({ _id: referrerOid });
              }
              return Promise.resolve(null);
            }),
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnThis(),
              sort: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: refereeOid,
                  username: "carol",
                  displayName: "Carol",
                },
              ]),
            }),
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue([
                {
                  userId: refereeOid,
                  sequentialId: 42,
                  createdAt: new Date("2026-03-01"),
                },
              ]),
            }),
          };
        }
        return {};
      }),
    } as never);

    const req = new Request(
      `http://localhost/api/admin/referrals/by-user/${referrerOid.toString()}`
    );
    const res = await GET(req, {
      params: Promise.resolve({ userId: referrerOid.toString() }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.referees).toHaveLength(1);
    expect(data.referees[0].username).toBe("carol");
    expect(data.referees[0].profileHref).toBe("/character/42");
    expect(data.contestMode).toBe(false);
  });

  it("filters by character createdAt when contest mode is active", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    const referrerOid = { toString: () => "507f1f77bcf86cd799439011" };
    const oldRefOid = { toString: () => "aaaaaaaaaaaaaaaaaaaaaaaa" };
    const newRefOid = { toString: () => "bbbbbbbbbbbbbbbbbbbbbbbb" };

    const contestStart = new Date("2026-06-01T00:00:00.000Z");

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "gameConfig") {
          return {
            findOne: vi.fn().mockResolvedValue({
              referralContestStartedAt: contestStart,
            }),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({ _id: referrerOid }),
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnThis(),
              sort: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: oldRefOid,
                  username: "old",
                  displayName: "Old",
                },
                {
                  _id: newRefOid,
                  username: "new",
                  displayName: "New",
                },
              ]),
            }),
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue([
                {
                  userId: oldRefOid,
                  sequentialId: 1,
                  createdAt: new Date("2026-01-01"),
                },
                {
                  userId: newRefOid,
                  sequentialId: 2,
                  createdAt: new Date("2026-07-01"),
                },
              ]),
            }),
          };
        }
        return {};
      }),
    } as never);

    const req = new Request(
      `http://localhost/api/admin/referrals/by-user/${referrerOid.toString()}?mode=contest`
    );
    const res = await GET(req, {
      params: Promise.resolve({ userId: referrerOid.toString() }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.contestMode).toBe(true);
    expect(data.referees).toHaveLength(1);
    expect(data.referees[0].username).toBe("new");
    expect(data.referees[0].profileHref).toBe("/character/2");
  });

  it("returns 404 when referrer does not exist", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        return {};
      }),
    } as never);

    const id = "507f1f77bcf86cd799439011";
    const req = new Request(`http://localhost/api/admin/referrals/by-user/${id}`);
    const res = await GET(req, { params: Promise.resolve({ userId: id }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe("User not found");
  });
});
