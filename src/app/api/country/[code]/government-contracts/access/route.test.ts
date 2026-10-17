import { beforeEach, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
const ctx = vi.hoisted(() => ({ context: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/governmentContracts/api", async () => {
  const { NextResponse } = await import("next/server");
  return {
    contractContext: ctx.context,
    privateJson: (body: unknown) =>
      NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } }),
    contractRouteError: (e: Error) => NextResponse.json({ error: e.message }, { status: 500 }),
  };
});
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: ctx.auth }));
vi.mock("@/lib/governmentContracts/authority", () => ({
  managementAuthority: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/extraction/contractAuthority", () => ({
  getResourceContractAuthority: vi.fn().mockResolvedValue("national"),
}));
vi.mock("@/lib/extraction/featureFlag", () => ({
  loadContractIssuanceSettings: vi.fn().mockResolvedValue({ contractIssuanceEnabled: false }),
}));
import { GET } from "./route";
let db: ReturnType<typeof createMockDb>;
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "exchangeRates",
    "federalBudget",
    "stateResourceCapacity",
    "corporations",
    "corporateSectors",
  ])
    db.collection(name);
  db.collectionMocks.exchangeRates.find().toArray.mockResolvedValue([
    { currencyCode: "USD", rate: 1.25 },
    { currencyCode: "JPY", rate: 100 },
  ]);
  ctx.context.mockResolvedValue({
    db: db as unknown as Db,
    countryId: "US",
    turn: 5,
    game: { preset: "1991" },
  });
  ctx.auth.mockResolvedValue({ userId: "a".repeat(24) });
});
it("returns government and selected corporation currency quotes without exposing wallet balances", async () => {
  const id = new ObjectId();
  db.collectionMocks.corporations.find().toArray.mockResolvedValue([
    {
      _id: id,
      name: "Synthetic",
      countryId: "US",
      type: "extraction",
      liquidCurrencyCode: "JPY",
      liquidCapital: 123,
    },
  ]);
  const response = await GET(
    new Request("http://localhost/api/country/US/government-contracts/access"),
    { params: Promise.resolve({ code: "US" }) }
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.currencyQuote).toEqual({ code: "USD", rate: 1.25 });
  expect(body.corporations[0].currencyQuote).toEqual({ code: "JPY", rate: 100 });
  expect(body.corporations[0]).not.toHaveProperty("liquidCapital");
  expect(db.collectionMocks.corporations.find.mock.calls.at(-1)?.[1]).toMatchObject({
    projection: { liquidCurrencyCode: 1 },
  });
});
it("also provides the public government denomination to signed-out viewers", async () => {
  ctx.auth.mockResolvedValue(null);
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ code: "US" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    currencyQuote: { code: "USD", rate: 1.25 },
    corporations: [],
  });
});
