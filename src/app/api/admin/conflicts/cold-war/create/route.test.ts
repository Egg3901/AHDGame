import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
const getDb = vi.fn();
const createConflict = vi.fn();

vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/mongodb", () => ({ getDb: () => getDb() }));
vi.mock("@/lib/military/createConflict", () => ({
  createConflict: (...args: unknown[]) => createConflict(...args),
}));

import { POST } from "./route";

const body = {
  name: "Vietnam War",
  hostCountry: "SVN",
  hostEntities: ["NVN", "SVN"],
  sideA: { label: "Republic of Vietnam", factionEntity: "SVN", backer: "west", tokenStrength: 40 },
  sideB: { label: "DRV", factionEntity: "NVN", backer: "east", tokenStrength: 40 },
};

const req = (over: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/admin/conflicts/cold-war/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...over }),
  });

function dbWith(gameState: Record<string, unknown> | null, existingConflict = false) {
  return {
    collection: (name: string) => ({
      findOne: vi
        .fn()
        .mockResolvedValue(
          name === "conflicts" ? (existingConflict ? { _id: "x" } : null) : gameState
        ),
      countDocuments: vi.fn().mockResolvedValue(existingConflict ? 1 : 0),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, admin: { username: "root" } });
  getDb.mockResolvedValue(
    dbWith({ conflictsEnabled: true, currentTurn: 12, preset: "1953-default" })
  );
  createConflict.mockResolvedValue({ _id: "cw_svn_12", conflictId: 3 });
});

describe("POST /api/admin/conflicts/cold-war/create", () => {
  it("creates a cold_war conflict and returns its number", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, conflictId: 3 });

    const [, input] = createConflict.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.type).toBe("cold_war");
    expect(input.createdBy).toBe("event");
    expect(input.hostEntities).toEqual(["NVN", "SVN"]);
    expect(input.hostCountry).toBe("SVN");
  });

  it("404s when the conflicts subsystem is off", async () => {
    getDb.mockResolvedValue(dbWith({ conflictsEnabled: false }));
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(createConflict).not.toHaveBeenCalled();
  });

  it("400s a faction id that collides with a playable country", async () => {
    const res = await POST(req({ sideA: { ...body.sideA, factionEntity: "US" } }));
    expect(res.status).toBe(400);
    expect(createConflict).not.toHaveBeenCalled();
  });

  it("400s a host that is not in the preset's world entity manifest", async () => {
    // The route-level concern: that it builds knownEntityIds from the REAL manifest for
    // the world's preset and feeds it to the validator. The validator's own rules are
    // unit-tested separately.
    const res = await POST(req({ hostCountry: "ZQ", hostEntities: ["ZQ"] }));
    expect(res.status).toBe(400);
    expect(createConflict).not.toHaveBeenCalled();
  });

  it("409s a second conflict in the same host on the same turn", async () => {
    // The id is host+turn, so createConflict would otherwise throw a duplicate key and
    // the admin would see a 500 rather than a sentence they can act on.
    getDb.mockResolvedValue(
      dbWith({ conflictsEnabled: true, currentTurn: 12, preset: "1953-default" }, true)
    );
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(createConflict).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(createConflict).not.toHaveBeenCalled();
  });
});
