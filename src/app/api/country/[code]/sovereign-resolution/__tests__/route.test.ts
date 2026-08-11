import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));
// buildInitialLegislativePhases needs the current turn for endsOnTurn.
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn(async () => 0),
}));

import { POST } from "../route";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";

const PRESIDENT = {
  _id: new ObjectId(),
  countryId: "US",
  currentOffice: { type: "president" },
};

function mockReq(body: unknown): Request {
  return new Request("http://test/api/country/US/sovereign-resolution", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface MockDbState {
  decisions: Array<Record<string, unknown>>;
  budget: Record<string, unknown> | null;
}

function mockDb(state: MockDbState) {
  const decisionUpdates: Array<Record<string, unknown>> = [];
  const budgetUpdates: Array<Record<string, unknown>> = [];
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "sovereignCrisisDecisions") {
        return {
          find: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue(state.decisions),
              }),
            }),
          }),
          updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
            decisionUpdates.push(u.$set as Record<string, unknown>);
            return { acknowledged: true, modifiedCount: 1 };
          }),
        };
      }
      if (name === "federalBudget") {
        return {
          findOne: vi.fn().mockResolvedValue(state.budget),
          updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
            budgetUpdates.push(u.$set as Record<string, unknown>);
            return { acknowledged: true, modifiedCount: 1 };
          }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
  return { db, decisionUpdates, budgetUpdates };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/country/[code]/sovereign-resolution — guards", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response("nope", { status: 401 }),
    } as never);
    const res = await POST(mockReq({ choice: "bailout" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(401);
  });

  it("400 when country code is invalid", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: PRESIDENT },
    } as never);
    const res = await POST(mockReq({ choice: "bailout" }), {
      params: Promise.resolve({ code: "ZZ" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when choice is invalid", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: PRESIDENT },
    } as never);
    const res = await POST(mockReq({ choice: "moonshine" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(400);
  });

  it("403 when character is not the country's executive", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        character: {
          ...PRESIDENT,
          currentOffice: { type: "house" },
        },
      },
    } as never);
    const res = await POST(mockReq({ choice: "bailout" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(403);
  });

  it("409 when no open SovereignCrisisDecision exists", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: PRESIDENT },
    } as never);
    const { db } = mockDb({ decisions: [], budget: null });
    vi.mocked(getDb).mockResolvedValue(db as never);
    const res = await POST(mockReq({ choice: "bailout" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("POST sovereign-resolution — legislative branch (phase 9b)", () => {
  const decisionId = new ObjectId();

  it("for democracies, sets decision to executiveProposed + opens lower-chamber phase", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: PRESIDENT },
    } as never);
    const { db, decisionUpdates, budgetUpdates } = mockDb({
      decisions: [{ _id: decisionId, state: "open", countryCode: "US" }],
      budget: { _id: "federal", countryId: "US", economicFactors: { inflationRate: 3.0 } },
    });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const res = await POST(mockReq({ choice: "bailout" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("awaitingLegislativeRatification");
    expect(body.chamberKey).toBe("house");

    expect(decisionUpdates).toHaveLength(1);
    expect(decisionUpdates[0].state).toBe("executiveProposed");
    expect(decisionUpdates[0].executiveChoice).toBe("bailout");
    expect(decisionUpdates[0].currentChamberIndex).toBe(0);
    const phases = decisionUpdates[0].legislativePhases as Array<{
      chamberKey: string;
      outcome: string;
    }>;
    expect(phases).toHaveLength(1);
    expect(phases[0].chamberKey).toBe("house");
    expect(phases[0].outcome).toBe("pending");

    expect(budgetUpdates).toHaveLength(1);
    expect(budgetUpdates[0].sovereignCrisisState).toBe("crisisResolving");
  });

  it("admin bypasses the executive check and still routes through legislative", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        character: { ...PRESIDENT, currentOffice: { type: "house" } },
        isAdmin: true,
      },
    } as never);
    const { db, decisionUpdates } = mockDb({
      decisions: [{ _id: decisionId, state: "open", countryCode: "US" }],
      budget: { _id: "federal", countryId: "US", economicFactors: { inflationRate: 3.0 } },
    });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const res = await POST(mockReq({ choice: "repudiate" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(200);
    expect(decisionUpdates[0].executiveChoice).toBe("repudiate");
  });

  it("422 when monetize is gated by inflation (pre-vote check)", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: PRESIDENT },
    } as never);
    const { db, decisionUpdates } = mockDb({
      decisions: [{ _id: decisionId, state: "open", countryCode: "US" }],
      budget: { _id: "federal", countryId: "US", economicFactors: { inflationRate: 9.0 } },
    });
    vi.mocked(getDb).mockResolvedValue(db as never);
    const res = await POST(mockReq({ choice: "monetize" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/inflation/i);
    // No legislative phases should have been opened
    expect(decisionUpdates).toHaveLength(0);
  });

  it("409 when concurrent updateOne races (decision already moved off open)", async () => {
    // Regression: simulates two parallel POSTs from the executive double-clicking.
    // The second writer's updateOne filter (`{ _id, state: "open" }`) excludes
    // the now-`executiveProposed` decision, modifiedCount=0, route returns 409
    // instead of silently overwriting `executiveChoice` with the second pick.
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: PRESIDENT },
    } as never);
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "sovereignCrisisDecisions") {
          return {
            find: vi.fn().mockReturnValue({
              sort: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  toArray: vi
                    .fn()
                    .mockResolvedValue([{ _id: decisionId, state: "open", countryCode: "US" }]),
                }),
              }),
            }),
            updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 0 }),
          };
        }
        if (name === "federalBudget") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "federal",
              countryId: "US",
              economicFactors: { inflationRate: 3.0 },
            }),
            updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
          };
        }
        throw new Error(`unexpected collection: ${name}`);
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const res = await POST(mockReq({ choice: "bailout" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(409);
  });

  it("monetize at exactly 8% inflation is NOT gated (boundary check)", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: PRESIDENT },
    } as never);
    const { db, decisionUpdates } = mockDb({
      decisions: [{ _id: decisionId, state: "open", countryCode: "US" }],
      budget: { _id: "federal", countryId: "US", economicFactors: { inflationRate: 8.0 } },
    });
    vi.mocked(getDb).mockResolvedValue(db as never);
    const res = await POST(mockReq({ choice: "monetize" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(200);
    expect(decisionUpdates[0].executiveChoice).toBe("monetize");
  });
});
