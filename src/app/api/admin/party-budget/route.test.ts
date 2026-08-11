import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/collections", () => ({ getPartyBudgetCollection: vi.fn() }));

import { POST } from "./route";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { NextRequest } from "next/server";

function makeRequest(body: string): NextRequest {
  return new NextRequest("http://localhost/api/admin/party-budget", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/admin/party-budget — body validation", () => {
  const updateOne = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { userId: "u" } } as Awaited<
      ReturnType<typeof requireAdmin>
    >);
    vi.mocked(getPartyBudgetCollection).mockResolvedValue({ updateOne } as unknown as Awaited<
      ReturnType<typeof getPartyBudgetCollection>
    >);
  });

  it("rejects a non-numeric gotvBudgetPerTurn with a controlled 400 before touching the DB", async () => {
    const res = await POST(
      makeRequest(JSON.stringify({ budgetId: "a".repeat(24), gotvBudgetPerTurn: "lots" }))
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("gotvBudgetPerTurn");
    expect(getPartyBudgetCollection).not.toHaveBeenCalled();
  });

  it("rejects a malformed budgetId with 400 instead of throwing on new ObjectId()", async () => {
    const res = await POST(makeRequest(JSON.stringify({ budgetId: "not-an-object-id" })));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("budgetId");
    expect(getPartyBudgetCollection).not.toHaveBeenCalled();
  });

  it("rejects an unknown scope value with 400", async () => {
    const res = await POST(
      makeRequest(JSON.stringify({ partyId: "1", scope: "galactic", gotvBudgetPerTurn: 5 }))
    );
    expect(res.status).toBe(400);
    expect(getPartyBudgetCollection).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await POST(makeRequest("not json"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("still requires budgetId or (partyId + scope) after validation", async () => {
    const res = await POST(makeRequest(JSON.stringify({ gotvBudgetPerTurn: 10 })));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("budgetId");
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("accepts a valid body and updates the budget", async () => {
    updateOne.mockResolvedValue({ matchedCount: 1 });
    const res = await POST(
      makeRequest(
        JSON.stringify({ partyId: "2", scope: "state", stateId: "PA", gotvBudgetPerTurn: 250 })
      )
    );
    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { partyId: "2", scope: "state", stateId: "PA" },
      { $set: expect.objectContaining({ gotvBudgetPerTurn: 250 }) }
    );
  });

  it("clamps negative gotvBudgetPerTurn to zero (preserved behavior)", async () => {
    updateOne.mockResolvedValue({ matchedCount: 1 });
    const res = await POST(
      makeRequest(JSON.stringify({ partyId: "2", scope: "national", gotvBudgetPerTurn: -50 }))
    );
    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { partyId: "2", scope: "national" },
      { $set: expect.objectContaining({ gotvBudgetPerTurn: 0 }) }
    );
  });
});
