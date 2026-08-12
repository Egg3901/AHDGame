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
  proposeBargainingCampaign: vi.fn(),
}));

const unionId = new ObjectId().toString();
const employerId = new ObjectId().toString();
const character = { _id: new ObjectId(), name: "Union Leader" };
const validProposal = {
  employerCorporationId: employerId,
  wageLevel: 1.12,
  agreementDurationTurns: 48,
  noStrikeTurns: 24,
};

function request(body: unknown) {
  return new Request(`http://localhost/api/unions/${unionId}/bargaining`, {
    method: "POST",
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
  vi.mocked(getCurrentTurn).mockResolvedValue(410);
});

describe("POST /api/unions/[id]/bargaining", () => {
  it("returns the authentication response before reading the request", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const { POST } = await import("./route");
    const response = await POST(request(validProposal), {
      params: Promise.resolve({ id: unionId }),
    });

    expect(response.status).toBe(401);
    const { proposeBargainingCampaign } = await import("@/lib/unions/commands/bargaining");
    expect(proposeBargainingCampaign).not.toHaveBeenCalled();
  });

  it("rejects an incomplete proposal", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ employerCorporationId: employerId, wageLevel: 1.12 }), {
      params: Promise.resolve({ id: unionId }),
    });

    expect(response.status).toBe(400);
    const { proposeBargainingCampaign } = await import("@/lib/unions/commands/bargaining");
    expect(proposeBargainingCampaign).not.toHaveBeenCalled();
  });

  it("opens a campaign through the union command", async () => {
    const { proposeBargainingCampaign } = await import("@/lib/unions/commands/bargaining");
    vi.mocked(proposeBargainingCampaign).mockResolvedValue({
      ok: true,
      status: 200,
      campaignId: "campaign-1",
      campaignStatus: "negotiating",
    } as never);

    const { POST } = await import("./route");
    const response = await POST(request(validProposal), {
      params: Promise.resolve({ id: unionId }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      campaignId: "campaign-1",
      campaignStatus: "negotiating",
    });
    expect(proposeBargainingCampaign).toHaveBeenCalledWith(
      expect.anything(),
      character,
      unionId,
      employerId,
      validProposal,
      410
    );
  });

  it("maps a command conflict to the command status and error", async () => {
    const { proposeBargainingCampaign } = await import("@/lib/unions/commands/bargaining");
    vi.mocked(proposeBargainingCampaign).mockResolvedValue({
      ok: false,
      status: 409,
      error: "An open bargaining campaign already exists with this employer.",
    });

    const { POST } = await import("./route");
    const response = await POST(request(validProposal), {
      params: Promise.resolve({ id: unionId }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An open bargaining campaign already exists with this employer.",
    });
  });
});
