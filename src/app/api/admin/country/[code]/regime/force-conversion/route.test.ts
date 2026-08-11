import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();
const mockRequireAdmin = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockTrigger = vi.fn();
const mockGetRegimeColl = vi.fn();
const mockRegimeFindOneAndUpdate = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));
vi.mock("@/lib/onePartyState/systemConversion", () => ({
  triggerSystemConversion: (...args: unknown[]) => mockTrigger(...args),
}));
vi.mock("@/lib/db/collections/regimeEscalation", () => ({
  getRegimeEscalationCollection: (...args: unknown[]) => mockGetRegimeColl(...args),
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/admin/country/CN/regime/force-conversion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/country/[code]/regime/force-conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockRequireAdmin.mockResolvedValue({
      ok: true,
      admin: {
        userId: "u1",
        username: "root",
        email: "root@example.com",
        role: "admin",
        isAdmin: true,
      },
    });
    mockGetCurrentTurn.mockResolvedValue(900);
    mockTrigger.mockResolvedValue(undefined);
    mockGetRegimeColl.mockReturnValue({ findOneAndUpdate: mockRegimeFindOneAndUpdate });
    mockRegimeFindOneAndUpdate.mockResolvedValue(null);
  });

  it("returns 403 for non-admin", async () => {
    mockRequireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    const res = await POST(
      request({ targetSystem: "parliamentaryRepublic", legacyReservation: 5 }),
      { params: Promise.resolve({ code: "CN" }) }
    );
    expect(res.status).toBe(403);
  });

  it("rejects targetSystem 'onePartyState' (conversion is one-way)", async () => {
    const res = await POST(request({ targetSystem: "onePartyState", legacyReservation: 5 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(400);
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it("returns 400 for legacyReservation out of range", async () => {
    const res = await POST(
      request({ targetSystem: "parliamentaryRepublic", legacyReservation: 50 }),
      { params: Promise.resolve({ code: "CN" }) }
    );
    expect(res.status).toBe(400);
  });

  it("invokes triggerSystemConversion with the admin params (defaults path to forced)", async () => {
    const res = await POST(
      request({ targetSystem: "parliamentaryRepublic", legacyReservation: 5 }),
      { params: Promise.resolve({ code: "CN" }) }
    );
    expect(res.status).toBe(200);
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    const [, country, turn, inputs] = mockTrigger.mock.calls[0] as [
      unknown,
      string,
      number,
      { targetSystem: string; legacyReservation: number; path: string; electionAtTurn: number },
    ];
    expect(country).toBe("CN");
    expect(turn).toBe(900);
    expect(inputs.targetSystem).toBe("parliamentaryRepublic");
    expect(inputs.legacyReservation).toBe(5);
    expect(inputs.path).toBe("forced");
    expect(inputs.electionAtTurn).toBe(900);
  });

  it("honours explicit path and electionAtTurn overrides", async () => {
    await POST(
      request({
        targetSystem: "presidential",
        legacyReservation: 20,
        path: "voluntary",
        electionAtTurn: 950,
      }),
      { params: Promise.resolve({ code: "CN" }) }
    );
    const [, , , inputs] = mockTrigger.mock.calls[0] as [
      unknown,
      string,
      number,
      { path: string; electionAtTurn: number },
    ];
    expect(inputs.path).toBe("voluntary");
    expect(inputs.electionAtTurn).toBe(950);
  });
});
