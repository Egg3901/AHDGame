import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  getAuthUserWithCharacter: vi.fn(),
  clearAuthCookie: vi.fn(),
}));
vi.mock("@/lib/api/accessLog", () => ({ logApiAccess: vi.fn() }));
vi.mock("@/lib/api/assertSameOrigin", () => ({ assertSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/observability/context", () => ({
  setUserContext: vi.fn(),
  setAuditRequestContext: vi.fn(),
}));
vi.mock("@/lib/observability/gameContext", () => ({ setGameContext: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const userId = new ObjectId().toString();

function authUser(character?: { isSynthetic?: boolean }) {
  return {
    userId,
    email: "harness@example.com",
    username: "harness",
    role: "user",
    isAdmin: false,
    hasCharacter: !!character,
    character: character ? { _id: new ObjectId(), ...character } : undefined,
  };
}

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/actions/execute", { method: "POST", headers });
}

describe("synthetic sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The property the whole design rests on. A valid session with no bot header
   * already passes these guards, so the header cannot be what grants access —
   * if a claimed run were simply believed, any real account could send it and
   * opt out of being treated as a person.
   */
  it("refuses a claimed run when the character is not marked synthetic", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAuthUser).mockResolvedValue(authUser() as never);
    vi.mocked(auth.getAuthUserWithCharacter).mockResolvedValue(
      authUser({ isSynthetic: false }) as never
    );

    const { requireHumanSession } = await import("./requireAuth");
    const result = await requireHumanSession(request({ "X-Synthetic-Run": "run-1" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows a claimed run when the character is marked synthetic", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAuthUser).mockResolvedValue(authUser() as never);
    vi.mocked(auth.getAuthUserWithCharacter).mockResolvedValue(
      authUser({ isSynthetic: true }) as never
    );

    const { requireHumanSession } = await import("./requireAuth");
    const result = await requireHumanSession(request({ "X-Synthetic-Run": "run-1" }));

    expect(result.ok).toBe(true);
  });

  it("records the run id, so a harness run is separable from a person afterwards", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAuthUser).mockResolvedValue(authUser() as never);
    vi.mocked(auth.getAuthUserWithCharacter).mockResolvedValue(
      authUser({ isSynthetic: true }) as never
    );

    const { requireHumanSession } = await import("./requireAuth");
    await requireHumanSession(request({ "X-Synthetic-Run": "run-42" }));

    const { logApiAccess } = await import("@/lib/api/accessLog");
    expect(vi.mocked(logApiAccess)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ authType: "synthetic", syntheticRunId: "run-42" })
    );
  });

  /**
   * Ordinary traffic must be untouched, including the cost: the character
   * lookup only happens when a run is actually claimed.
   */
  it("leaves an ordinary session alone and does not resolve a character for it", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAuthUser).mockResolvedValue(authUser() as never);

    const { requireHumanSession } = await import("./requireAuth");
    const result = await requireHumanSession(request());

    expect(result.ok).toBe(true);
    expect(vi.mocked(auth.getAuthUserWithCharacter)).not.toHaveBeenCalled();

    const { logApiAccess } = await import("@/lib/api/accessLog");
    expect(vi.mocked(logApiAccess)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ authType: "session" })
    );
  });

  /**
   * The bot-token rejection predates this and must keep winning. A caller that
   * sends both is still automation of the kind the guard was built to refuse.
   */
  it("still refuses a bot token even when a synthetic run is claimed", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAuthUser).mockResolvedValue(authUser() as never);
    vi.mocked(auth.getAuthUserWithCharacter).mockResolvedValue(
      authUser({ isSynthetic: true }) as never
    );

    const { requireHumanSession } = await import("./requireAuth");
    const result = await requireHumanSession(
      request({ "X-Bot-Token": "ahd_bot_x", "X-Synthetic-Run": "run-1" })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});
