import { expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({ cast: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: mocks.auth }));
vi.mock("@/lib/mongodb", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/monetaryGovernance/jurisdiction", () => ({
  resolveJurisdiction: async () => ({ institutionId: "US" }),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: async () => ({ currentTurn: 109, currentYear: 1960 }),
}));
vi.mock("@/lib/turn/fomcMeetingTurn", () => ({ castFomcBallot: mocks.cast }));
import { POST } from "./route";

it("passes the game year into execution policy and reports a resolved but unchanged rate", async () => {
  const characterId = new ObjectId();
  mocks.auth.mockResolvedValue({
    ok: true,
    user: { userId: "test-user", character: { _id: characterId } },
  });
  mocks.cast.mockResolvedValue({ ok: true, resolved: true, moved: false, motion: "hike" });
  const response = await POST(
    new Request("http://localhost/api/country/US/fomc/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "hike" }),
    }),
    { params: Promise.resolve({ code: "US" }) }
  );
  expect(response.status).toBe(200);
  expect(mocks.cast).toHaveBeenCalledWith(
    {},
    "US",
    characterId,
    "hike",
    109,
    expect.any(Date),
    1960
  );
  expect(await response.json()).toMatchObject({ resolved: true, rateChanged: false });
});
