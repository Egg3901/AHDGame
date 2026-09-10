/**
 * /api/auth/me derives staff flags from the current DB account record only.
 * A correctly signed token carrying stale admin claims must not re-grant
 * after demotion.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { GET } from "./route";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyAuth: vi.fn(),
  clearAuthCookie: vi.fn(),
  getTrackingCookieOptions: vi.fn(async () => ({})),
}));

vi.mock("@/lib/singleplayer", () => ({
  isSingleplayer: () => false,
}));

vi.mock("@/lib/auth/characterGate", () => ({
  needsCharacterHint: () => false,
}));

vi.mock("@/lib/auth/characterGateCookie", () => ({
  setCharacterGateCookie: vi.fn(),
}));

vi.mock("@/lib/api/errors", () => ({
  handleRouteError: (error: unknown) => {
    throw error;
  },
}));

vi.mock("@/lib/db/types", () => ({
  isPatreonActive: () => false,
}));

vi.mock("@/lib/imperial", () => ({
  getImperialTitle: () => "Emperor",
}));

vi.mock("@/lib/currency/characterFunds", () => ({
  getTotalPersonalLiquidWealth: () => 0,
  getHomeCurrency: () => "USD",
}));

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: async () => false,
}));

vi.mock("@/lib/stats/featureFlag", () => ({
  isRpgStatsEnabled: async () => false,
}));

vi.mock("@/lib/gameState", () => ({
  getGameState: async () => ({}),
}));

vi.mock("@/lib/redistricting/flag", () => ({
  isRedistrictingEnabled: () => false,
}));

vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesRecord: vi.fn(),
}));

vi.mock("@/lib/notifications/notificationBundle", () => ({
  getNotificationBundleUserIds: (user: { _id: ObjectId }) => [user._id],
}));

const USER_ID = "507f1f77bcf86cd799439011";

describe("GET /api/auth/me privilege flags", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => (name === "__ahd_track" ? undefined : { value: "signed-token" }),
      set: vi.fn(),
    } as never);
  });

  async function getMe(payload: Record<string, unknown>, user: Record<string, unknown>) {
    const { verifyAuth } = await import("@/lib/auth");
    vi.mocked(verifyAuth).mockResolvedValue(payload as never);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: (name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue(user),
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
            updateOne: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "characters") {
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
        return { countDocuments: vi.fn().mockResolvedValue(0) };
      },
    } as never);
    return GET();
  }

  it("ignores stale admin claims on a demoted player account", async () => {
    const res = await getMe(
      { userId: USER_ID, email: "p@example.com", username: "player", role: "admin", isAdmin: true },
      {
        _id: new ObjectId(USER_ID),
        email: "p@example.com",
        username: "player",
        role: "player",
      }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { isAdmin: boolean; isModerator: boolean; role: string };
    };
    expect(body.user.isAdmin).toBe(false);
    expect(body.user.isModerator).toBe(false);
    expect(body.user.role).toBe("player");
  });

  it("reflects a current moderator holding an old player-claim token", async () => {
    const res = await getMe(
      { userId: USER_ID, email: "p@example.com", username: "player", role: "player" },
      {
        _id: new ObjectId(USER_ID),
        email: "p@example.com",
        username: "player",
        role: "moderator",
      }
    );

    const body = (await res.json()) as {
      user: { isAdmin: boolean; isModerator: boolean; role: string };
    };
    expect(body.user.isAdmin).toBe(false);
    expect(body.user.isModerator).toBe(true);
    expect(body.user.role).toBe("moderator");
  });
});
