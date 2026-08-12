import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/unions/commands/bargaining", () => ({
  actOnBargainingCampaignAsUnion: vi.fn(),
}));

const unionId = new ObjectId().toString();
const campaignId = new ObjectId().toString();
const character = { _id: new ObjectId(), name: "Union Leader" };

function request(body: unknown) {
  return new Request(`http://localhost/api/unions/${unionId}/bargaining/${campaignId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({} as never);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user-1" },
  } as never);
  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
  const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
  vi.mocked(getCharacterByUserId).mockResolvedValue(character as never);
  const { isLabourFullMode } = await import("@/lib/labour/featureFlag");
  vi.mocked(isLabourFullMode).mockResolvedValue(true);
  const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
  vi.mocked(getCurrentTurn).mockResolvedValue(411);
});

describe("PATCH /api/unions/[id]/bargaining/[campaignId]", () => {
  it("returns the authentication response before dispatch", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "accept" }), {
      params: Promise.resolve({ id: unionId, campaignId }),
    });

    expect(response.status).toBe(401);
    const { actOnBargainingCampaignAsUnion } = await import("@/lib/unions/commands/bargaining");
    expect(actOnBargainingCampaignAsUnion).not.toHaveBeenCalled();
  });

  it("rejects a counteroffer without terms", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "counter" }), {
      params: Promise.resolve({ id: unionId, campaignId }),
    });

    expect(response.status).toBe(400);
    const { actOnBargainingCampaignAsUnion } = await import("@/lib/unions/commands/bargaining");
    expect(actOnBargainingCampaignAsUnion).not.toHaveBeenCalled();
  });

  it("dispatches a validated counteroffer with union identity", async () => {
    const terms = {
      action: "counter" as const,
      wageLevel: 1.09,
      agreementDurationTurns: 72,
      noStrikeTurns: 30,
    };
    const { actOnBargainingCampaignAsUnion } = await import("@/lib/unions/commands/bargaining");
    vi.mocked(actOnBargainingCampaignAsUnion).mockResolvedValue({
      ok: true,
      status: 200,
      campaignId,
      campaignStatus: "negotiating",
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(request(terms), {
      params: Promise.resolve({ id: unionId, campaignId }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ success: true, campaignStatus: "negotiating" });
    expect(actOnBargainingCampaignAsUnion).toHaveBeenCalledWith(
      expect.anything(),
      character,
      unionId,
      campaignId,
      "counter",
      411,
      terms
    );
  });

  it("maps an ownership failure returned by the union command", async () => {
    const { actOnBargainingCampaignAsUnion } = await import("@/lib/unions/commands/bargaining");
    vi.mocked(actOnBargainingCampaignAsUnion).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Only the union leader can take this action.",
    });

    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "escalate" }), {
      params: Promise.resolve({ id: unionId, campaignId }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only the union leader can take this action.",
    });
  });
});
