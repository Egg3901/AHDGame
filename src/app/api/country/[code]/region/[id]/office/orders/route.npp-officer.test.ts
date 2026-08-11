import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockCanManageOffice = vi.fn();
const mockIssueOrder = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: (...args: unknown[]) => mockRequireAuth(...args),
}));
vi.mock("@/lib/governorOffice/access", () => ({
  canManageOffice: (...args: unknown[]) => mockCanManageOffice(...args),
}));
vi.mock("@/lib/governorOffice/orders/issueOrder", () => ({
  issueOrder: (...args: unknown[]) => mockIssueOrder(...args),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/country/US/region/AZ/office/orders", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const validBody = { legislationTypeId: "leg-1", effectDirection: 1 as const };

describe("POST /api/country/[code]/region/[id]/office/orders — NPP party-officer access", () => {
  const characterId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: characterId, name: "Jane Chair" } },
    });
    mockIssueOrder.mockResolvedValue({ status: 200, body: { ok: true } });
  });

  it("lets an authorized party officer issue an order (canManage=true → 200)", async () => {
    mockCanManageOffice.mockResolvedValue(true);
    const res = await POST(request(validBody), {
      params: Promise.resolve({ code: "US", id: "AZ" }),
    });
    expect(res.status).toBe(200);
    expect(mockIssueOrder).toHaveBeenCalledTimes(1);
    // Attribution: the acting officer is recorded as the actor.
    const [, args] = mockIssueOrder.mock.calls[0] as [unknown, { characterId: ObjectId }];
    expect(args.characterId).toBe(characterId);
  });

  it("rejects a non-officer viewer (canManage=false, not admin → 403)", async () => {
    mockCanManageOffice.mockResolvedValue(false);
    const res = await POST(request(validBody), {
      params: Promise.resolve({ code: "US", id: "AZ" }),
    });
    expect(res.status).toBe(403);
    expect(mockIssueOrder).not.toHaveBeenCalled();
  });

  it("still allows admin override when not an officer", async () => {
    mockCanManageOffice.mockResolvedValue(false);
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: { isAdmin: true, character: { _id: characterId, name: "Mod" } },
    });
    const res = await POST(request({ ...validBody, adminOverride: true }), {
      params: Promise.resolve({ code: "US", id: "AZ" }),
    });
    expect(res.status).toBe(200);
    expect(mockIssueOrder).toHaveBeenCalledTimes(1);
  });
});
