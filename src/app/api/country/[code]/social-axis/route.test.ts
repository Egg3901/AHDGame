import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { clearCountryStateCacheForDb } from "@/lib/countryState/cache";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");

function makeRequest() {
  return new Request("http://localhost/api/country/cn/social-axis");
}

describe("GET /api/country/[code]/social-axis", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    clearCountryStateCacheForDb(db as unknown as Db);
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { id: "u1" } } as never);
  });

  it("returns the stored social-axis position", async () => {
    const doc = seedCountryStateFromConfig("CN", new Date());
    doc.socialAxisPosition = 4.2;
    db.collectionMocks.countryState.findOne.mockResolvedValue(doc);

    const res = await GET(makeRequest(), { params: Promise.resolve({ code: "cn" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ socialAxisPosition: 4.2 });
  });

  it("falls back to the config baseline when the doc lacks the field", async () => {
    const doc = seedCountryStateFromConfig("CN", new Date());
    delete doc.socialAxisPosition;
    db.collectionMocks.countryState.findOne.mockResolvedValue(doc);

    const res = await GET(makeRequest(), { params: Promise.resolve({ code: "cn" }) });
    expect(await res.json()).toEqual({ socialAxisPosition: 3.5 });
  });

  it("rejects an unknown country code with 400", async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ code: "zz" }) });
    expect(res.status).toBe(400);
  });

  it("returns the auth failure response when unauthenticated", async () => {
    const unauthorized = NextResponseLike();
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: unauthorized } as never);
    const res = await GET(makeRequest(), { params: Promise.resolve({ code: "cn" }) });
    expect(res).toBe(unauthorized);
  });
});

function NextResponseLike() {
  return new Response("unauthorized", { status: 401 });
}
