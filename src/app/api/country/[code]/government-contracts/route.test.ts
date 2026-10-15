import { beforeEach, describe, it, expect, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
const ctx = vi.hoisted(() => ({ context: vi.fn(), publish: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/governmentContracts/api", async () => {
  const { NextResponse } = await import("next/server");
  return {
    contractContext: ctx.context,
    privateJson: (body: unknown) => NextResponse.json(body),
    contractRouteError: (e: Error) => NextResponse.json({ error: e.message }, { status: 500 }),
  };
});
vi.mock("@/lib/governmentContracts/commands", () => ({ publishTender: ctx.publish }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: ctx.auth }));
import { GET, POST } from "./route";
describe("country government contracts API", () => {
  let db: ReturnType<typeof createMockDb>;
  const context = { params: Promise.resolve({ code: "jp" }) };
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ctx.context.mockResolvedValue({ db: db as unknown as Db, countryId: "JP", turn: 5 });
    ctx.auth.mockResolvedValue({ ok: true, user: { userId: "a".repeat(24) } });
  });
  it("uses the URL country, a fixed ten-row page and a type-specific server filter", async () => {
    db.collection("governmentTenders");
    const c = db.collectionMocks.governmentTenders;
    const cursor = c.find();
    c.countDocuments.mockResolvedValue(23);
    const response = await GET(
      new Request(
        "http://localhost/api/country/jp/government-contracts?tab=closed&type=defence&page=2&pageSize=100"
      ),
      context
    );
    expect(response.status).toBe(200);
    expect(ctx.context).toHaveBeenCalledWith("jp");
    expect(c.find.mock.calls.at(-1)![0]).toMatchObject({
      countryId: "JP",
      "terms.type": "defence",
    });
    expect(cursor.skip).toHaveBeenCalledWith(10);
    expect(cursor.limit).toHaveBeenCalledWith(10);
    expect(await response.json()).toMatchObject({ page: 2, pageSize: 10, totalPages: 3 });
  });
  it("rejects unsupported filters instead of broadening a country query", async () => {
    expect(
      (
        await GET(
          new Request("http://localhost/api/country/jp/government-contracts?type=anything"),
          context
        )
      ).status
    ).toBe(400);
    expect(
      (
        await GET(
          new Request("http://localhost/api/country/jp/government-contracts?tab=anything"),
          context
        )
      ).status
    ).toBe(400);
  });
  it("requires authentication before publishing", async () => {
    ctx.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await POST(new Request("http://localhost", { method: "POST" }), context)).status).toBe(
      401
    );
    expect(ctx.publish).not.toHaveBeenCalled();
  });
  it("rejects a targeted corporation and malformed financial terms", async () => {
    const body = {
      title: "Procurement",
      description: "Equipment for the country",
      closesTurn: 7,
      awardDeadlineTurn: 9,
      corporationId: "a".repeat(24),
      terms: { type: "defence", component: "ground", grade: 1, lots: 1, maximumPricePerLot: 100 },
    };
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      context
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ctx.publish).not.toHaveBeenCalled();
  });
  it("passes a validated untargeted tender to the domain command in this country", async () => {
    ctx.publish.mockResolvedValue("tender");
    const body = {
      title: "Procurement",
      description: "Equipment for the country",
      closesTurn: 7,
      awardDeadlineTurn: 9,
      terms: { type: "defence", component: "ground", grade: 1, lots: 1, maximumPricePerLot: 100 },
    };
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      context
    );
    expect(res.status).toBe(200);
    expect(ctx.publish.mock.calls[0][1]).toBe("JP");
    expect(await res.json()).toEqual({ tenderId: "tender" });
  });
});
