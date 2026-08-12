import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/unions/commands/bargaining", () => ({
  actOnBargainingCampaignAsEmployer: vi.fn(),
}));

const corporationId = new ObjectId().toString();
const campaignId = new ObjectId().toString();

function request(body: unknown) {
  return new Request(
    `http://localhost/api/corporations/${corporationId}/bargaining/${campaignId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({} as never);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "ceo-user" },
  } as never);
  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
  const { isLabourFullMode } = await import("@/lib/labour/featureFlag");
  vi.mocked(isLabourFullMode).mockResolvedValue(true);
  const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
  vi.mocked(getCurrentTurn).mockResolvedValue(421);
});

describe("PATCH /api/corporations/[id]/bargaining/[campaignId]", () => {
  it("returns the authentication response before dispatch", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "accept" }), {
      params: Promise.resolve({ id: corporationId, campaignId }),
    });

    expect(response.status).toBe(401);
    const { actOnBargainingCampaignAsEmployer } = await import("@/lib/unions/commands/bargaining");
    expect(actOnBargainingCampaignAsEmployer).not.toHaveBeenCalled();
  });

  it("rejects an unknown employer action", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "escalate" }), {
      params: Promise.resolve({ id: corporationId, campaignId }),
    });

    expect(response.status).toBe(400);
    const { actOnBargainingCampaignAsEmployer } = await import("@/lib/unions/commands/bargaining");
    expect(actOnBargainingCampaignAsEmployer).not.toHaveBeenCalled();
  });

  it("dispatches a validated counteroffer with CEO identity", async () => {
    const terms = {
      action: "counter" as const,
      wageLevel: 1.06,
      agreementDurationTurns: 60,
      noStrikeTurns: 30,
    };
    const { actOnBargainingCampaignAsEmployer } = await import("@/lib/unions/commands/bargaining");
    vi.mocked(actOnBargainingCampaignAsEmployer).mockResolvedValue({
      ok: true,
      status: 200,
      campaignId,
      campaignStatus: "negotiating",
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(request(terms), {
      params: Promise.resolve({ id: corporationId, campaignId }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ success: true, campaignStatus: "negotiating" });
    expect(actOnBargainingCampaignAsEmployer).toHaveBeenCalledWith(
      expect.anything(),
      "ceo-user",
      corporationId,
      campaignId,
      "counter",
      421,
      terms
    );
  });

  it("maps a CEO authorization failure returned by the employer command", async () => {
    const { actOnBargainingCampaignAsEmployer } = await import("@/lib/unions/commands/bargaining");
    vi.mocked(actOnBargainingCampaignAsEmployer).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Only the employer's CEO can answer this campaign.",
    });

    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "reject" }), {
      params: Promise.resolve({ id: corporationId, campaignId }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only the employer's CEO can answer this campaign.",
    });
  });
});
