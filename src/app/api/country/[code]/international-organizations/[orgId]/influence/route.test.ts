import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireForeignMinister", () => ({ requireForeignMinister: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  isMember: vi.fn(),
  loadOrganizationDef: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(200) }));
vi.mock("@/lib/alignment/commands/commitInfluencePlay", () => ({
  commitInfluencePlay: vi.fn(),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
const { isMember, loadOrganizationDef } = await import("@/lib/internationalOrganizations/service");
const { commitInfluencePlay } = await import("@/lib/alignment/commands/commitInfluencePlay");

function setup() {
  const characterId = new ObjectId();
  const db = {
    collection: vi.fn(() => ({
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentYear: 1953, startingYear: 1953 }),
    })),
  };
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: "u1", character: { _id: characterId, name: "Dulles", party: "rep" } },
  } as never);
  vi.mocked(requireForeignMinister).mockResolvedValue({
    ok: true,
    auth: { countryId: "US", characterId, characterName: "Dulles" },
  } as never);
  vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "NATO", name: "NATO" } as never);
  vi.mocked(isMember).mockResolvedValue(true);
  vi.mocked(commitInfluencePlay).mockResolvedValue({ ok: true, amountUsd: 9e8 } as never);
  return { characterId };
}

async function post(body: unknown, code = "us", orgId = "NATO") {
  const { POST } =
    await import("@/app/api/country/[code]/international-organizations/[orgId]/influence/route");
  return POST(
    new Request(
      `http://localhost/api/country/${code}/international-organizations/${orgId}/influence`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ code, orgId }) }
  );
}

beforeEach(() => vi.clearAllMocks());

describe("POST .../[orgId]/influence", () => {
  it("commits a play for a member's foreign minister", async () => {
    setup();
    const res = await post({ targetEntityId: "YU", amountLocal: 9e8 });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });

    expect(vi.mocked(commitInfluencePlay)).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "NATO",
        sponsorCountryId: "US",
        targetEntityId: "YU",
        amountLocal: 9e8,
      })
    );
  });

  it("upper-cases the target so a lowercase id still resolves", async () => {
    setup();
    await post({ targetEntityId: "yu", amountLocal: 1e8 });
    expect(vi.mocked(commitInfluencePlay)).toHaveBeenCalledWith(
      expect.objectContaining({ targetEntityId: "YU" })
    );
  });

  it("rejects an invalid country code before doing anything else", async () => {
    setup();
    const res = await post({ targetEntityId: "YU", amountLocal: 1e8 }, "zz");
    expect(res.status).toBe(400);
    expect(vi.mocked(commitInfluencePlay)).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amount", async () => {
    setup();
    const res = await post({ targetEntityId: "YU", amountLocal: 0 });
    expect(res.status).toBe(400);
    expect(vi.mocked(commitInfluencePlay)).not.toHaveBeenCalled();
  });

  it("passes the foreign-minister guard's rejection straight through", async () => {
    setup();
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const res = await post({ targetEntityId: "YU", amountLocal: 1e8 });
    expect(res.status).toBe(403);
    expect(vi.mocked(commitInfluencePlay)).not.toHaveBeenCalled();
  });

  it("refuses a non-member", async () => {
    setup();
    vi.mocked(isMember).mockResolvedValue(false);
    const res = await post({ targetEntityId: "YU", amountLocal: 1e8 });
    expect(res.status).toBe(400);
    expect(vi.mocked(commitInfluencePlay)).not.toHaveBeenCalled();
  });

  it("surfaces a locked target as actionable copy, not a raw reason code", async () => {
    setup();
    vi.mocked(commitInfluencePlay).mockResolvedValue({
      ok: false,
      reason: "target-locked",
    } as never);
    const res = await post({ targetEntityId: "PL", amountLocal: 1e8 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(JSON.stringify(body)).toMatch(/locked to its bloc/i);
  });

  it("does not blame the player when the feature gate is off", async () => {
    setup();
    vi.mocked(commitInfluencePlay).mockResolvedValue({ ok: false, reason: "gate-off" } as never);
    const res = await post({ targetEntityId: "YU", amountLocal: 1e8 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as unknown;
    expect(JSON.stringify(body)).toMatch(/not enabled in this world/i);
  });
});
