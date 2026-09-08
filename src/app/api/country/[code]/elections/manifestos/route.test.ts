import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const { getDbMock, requireHumanSessionMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireHumanSessionMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: getDbMock }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: requireHumanSessionMock,
}));

import { GET } from "./route";
import { MAX_MANIFESTO_ELECTION_IDS } from "@/lib/db/types/manifesto";

const CHARACTER_ID = new ObjectId();

/** Fake Db whose `manifestos` reads run through the real collection helper. */
function fakeDb(opts: {
  party?: { sequentialId: number; name: string } | null;
  manifestos?: Array<Record<string, unknown>>;
}) {
  const manifestoFind = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue(opts.manifestos ?? []),
  });
  const partyFindOne = vi.fn().mockResolvedValue(opts.party ?? null);
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "manifestos") return { find: manifestoFind };
      if (name === "politicalParties") return { findOne: partyFindOne };
      throw new Error(`unexpected collection ${name}`);
    }),
  };
  return { db, manifestoFind, partyFindOne };
}

function request(code: string, electionIds?: string) {
  const qs = electionIds === undefined ? "" : `?electionIds=${electionIds}`;
  return new Request(`http://localhost/api/country/${code}/elections/manifestos${qs}`);
}

function params(code: string) {
  return { params: Promise.resolve({ code }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireHumanSessionMock.mockResolvedValue({
    ok: true,
    user: { character: { _id: CHARACTER_ID, userId: new ObjectId() } },
  });
});

describe("GET /api/country/[code]/elections/manifestos", () => {
  it("answers for every election in one manifestos query", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    const { db, manifestoFind } = fakeDb({
      party: { sequentialId: 1, name: "Labour" },
      manifestos: [
        {
          electionId: a,
          party: "1",
          pledges: [{ catalogEntryId: "uk.nhs.universal" }],
          lockedAt: new Date("2026-01-01"),
        },
        { electionId: c, party: "1", pledges: [{ catalogEntryId: "uk.tax.cutIncome" }] },
      ],
    });
    getDbMock.mockResolvedValue(db);

    const res = await GET(
      request("uk", [a, b, c].join(",")),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // The whole point: one round trip for the page, not one per election.
    expect(manifestoFind).toHaveBeenCalledTimes(1);
    expect(manifestoFind).toHaveBeenCalledWith({
      countryId: "UK",
      electionId: { $in: [a, b, c] },
      party: "1",
    });

    expect(body.isPartyLeader).toBe(true);
    expect(body.party).toEqual({ id: "1", name: "Labour" });
    expect(body.pledgeCount).toBeGreaterThan(0);
    expect(body.catalog.length).toBeGreaterThan(0);

    // A key per requested election; null where the party has not written one.
    expect(Object.keys(body.manifestos).sort()).toEqual([a, b, c].map(String).sort());
    expect(body.manifestos[String(a)]).toEqual({
      pledges: ["uk.nhs.universal"],
      locked: true,
      lockedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(body.manifestos[String(b)]).toBeNull();
    expect(body.manifestos[String(c)]).toEqual({
      pledges: ["uk.tax.cutIncome"],
      locked: false,
      lockedAt: null,
    });
  });

  /**
   * The response is per-user (your party, your pledges). Without an explicit
   * header Cloudflare re-compresses it with zstd, which some Android System
   * WebView builds cannot decode — the fetch throws "Network error" and the
   * bars vanish on exactly those devices. See src/lib/api/withNoStore.ts and
   * the /api/corporations rule in next.config.ts.
   */
  it("is never shared or re-compressed by the CDN", async () => {
    getDbMock.mockResolvedValue(fakeDb({ party: { sequentialId: 1, name: "Labour" } }).db);
    const res = await GET(
      request("uk", String(new ObjectId())),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store, no-transform");
  });

  it("tells a non-leader they cannot author, without querying manifestos", async () => {
    const a = new ObjectId();
    const { db, manifestoFind } = fakeDb({ party: null });
    getDbMock.mockResolvedValue(db);

    const res = await GET(
      request("uk", String(a)),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isPartyLeader).toBe(false);
    expect(body.party).toBeNull();
    expect(body.manifestos).toEqual({ [String(a)]: null });
    expect(manifestoFind).not.toHaveBeenCalled();
  });

  it("rejects a country other than the UK", async () => {
    getDbMock.mockResolvedValue(fakeDb({}).db);
    const res = await GET(
      request("us", String(new ObjectId())),
      params("us") as unknown as { params: Promise<{ code: string }> }
    );
    expect(res.status).toBe(400);
  });

  /**
   * `ObjectId.isValid` accepts uppercase hex, which round-trips to a DIFFERENT
   * string than the caller sent — so keying the response off
   * `String(row.electionId)` left the caller's own key null and added a
   * lowercase one it never asked for.
   */
  it("answers an uppercase id under the caller's own spelling", async () => {
    const a = new ObjectId();
    const upper = String(a).toUpperCase();
    const { db } = fakeDb({
      party: { sequentialId: 1, name: "Labour" },
      manifestos: [
        { electionId: a, party: "1", pledges: [{ catalogEntryId: "uk.nhs.universal" }] },
      ],
    });
    getDbMock.mockResolvedValue(db);

    const res = await GET(
      request("uk", upper),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    const body = await res.json();

    expect(Object.keys(body.manifestos)).toEqual([upper]);
    expect(body.manifestos[upper]).toEqual({
      pledges: ["uk.nhs.universal"],
      locked: false,
      lockedAt: null,
    });
  });

  // Boundary guard: a 12-character string is the other thing ObjectId ids get
  // confused with. This driver already rejects it; pin that so a driver bump
  // that loosens `isValid` cannot silently widen what the route accepts.
  it("rejects a 12-character string", async () => {
    getDbMock.mockResolvedValue(fakeDb({}).db);
    const res = await GET(
      request("uk", "abcdefghijkl"),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    expect(res.status).toBe(400);
  });

  /**
   * One malformed row used to break only its own bar; batching means it would
   * take down every manifesto on the page, so a bad row degrades to "no pledges"
   * rather than a 500.
   */
  it("survives a row with no pledges array", async () => {
    const a = new ObjectId();
    const { db } = fakeDb({
      party: { sequentialId: 1, name: "Labour" },
      manifestos: [{ electionId: a, party: "1" }],
    });
    getDbMock.mockResolvedValue(db);

    const res = await GET(
      request("uk", String(a)),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );

    expect(res.status).toBe(200);
    expect((await res.json()).manifestos[String(a)]).toEqual({
      pledges: [],
      locked: false,
      lockedAt: null,
    });
  });

  it("rejects a malformed electionId", async () => {
    getDbMock.mockResolvedValue(fakeDb({}).db);
    const res = await GET(
      request("uk", "not-an-object-id"),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing electionIds parameter", async () => {
    getDbMock.mockResolvedValue(fakeDb({}).db);
    const res = await GET(
      request("uk"),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    expect(res.status).toBe(400);
  });

  it("refuses an unbounded election list", async () => {
    getDbMock.mockResolvedValue(fakeDb({}).db);
    const tooMany = Array.from({ length: MAX_MANIFESTO_ELECTION_IDS + 1 }, () =>
      String(new ObjectId())
    ).join(",");
    const res = await GET(
      request("uk", tooMany),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    expect(res.status).toBe(400);
  });

  it("propagates the auth failure response", async () => {
    requireHumanSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    getDbMock.mockResolvedValue(fakeDb({}).db);
    const res = await GET(
      request("uk", String(new ObjectId())),
      params("uk") as unknown as { params: Promise<{ code: string }> }
    );
    expect(res.status).toBe(401);
  });
});
