import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const { getDbMock, requireHumanSessionMock, upsertManifestoDraftMock, lockManifestoMock } =
  vi.hoisted(() => ({
    getDbMock: vi.fn(),
    requireHumanSessionMock: vi.fn(),
    upsertManifestoDraftMock: vi.fn(),
    lockManifestoMock: vi.fn(),
  }));

vi.mock("@/lib/mongodb", () => ({ getDb: getDbMock }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: requireHumanSessionMock,
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/collections/manifestos", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/collections/manifestos")>();
  return {
    ...original,
    upsertManifestoDraft: upsertManifestoDraftMock,
    lockManifesto: lockManifestoMock,
  };
});

import * as route from "./route";
import { pledgeCatalogFor } from "@/lib/uk/manifesto/pledgeCatalog";

const ELECTION_ID = new ObjectId();
const CHARACTER_ID = new ObjectId();
const PLEDGES = pledgeCatalogFor("UK")
  .slice(0, 3)
  .map((e) => e.id);

function fakeDb(party: { sequentialId: number; name: string } | null) {
  return {
    collection: vi.fn((name: string) => {
      if (name === "elections") {
        return { findOne: vi.fn().mockResolvedValue({ _id: ELECTION_ID, countryId: "UK" }) };
      }
      if (name === "politicalParties") return { findOne: vi.fn().mockResolvedValue(party) };
      throw new Error(`unexpected collection ${name}`);
    }),
  };
}

function post(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/country/uk/elections/${ELECTION_ID}/manifesto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = {
  params: Promise.resolve({ code: "uk", electionId: String(ELECTION_ID) }),
};

async function postManifesto(body: Record<string, unknown>) {
  const res = await route.POST(post(body), params);
  if (!res) throw new Error("POST returned no response");
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireHumanSessionMock.mockResolvedValue({
    ok: true,
    user: { character: { _id: CHARACTER_ID, userId: new ObjectId() } },
  });
  upsertManifestoDraftMock.mockResolvedValue(true);
  lockManifestoMock.mockResolvedValue({ ok: true });
});

describe("/api/country/[code]/elections/[electionId]/manifesto", () => {
  /**
   * Reads moved to the batch route (`…/elections/manifestos`) so the elections
   * page stops issuing one request per contested race. This route is now
   * write-only; a GET handler here would be a second, untested read path.
   */
  it("serves no GET — reads come from the batch route", () => {
    expect("GET" in route).toBe(false);
  });

  it("saves a party leader's draft", async () => {
    getDbMock.mockResolvedValue(fakeDb({ sequentialId: 1, name: "Labour" }));

    const res = await postManifesto({ pledges: PLEDGES, action: "save" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, locked: false });
    expect(upsertManifestoDraftMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        countryId: "UK",
        electionId: ELECTION_ID,
        party: "1",
        pledges: PLEDGES.map((id) => ({ catalogEntryId: id })),
      })
    );
    expect(lockManifestoMock).not.toHaveBeenCalled();
  });

  it("locks when asked", async () => {
    getDbMock.mockResolvedValue(fakeDb({ sequentialId: 1, name: "Labour" }));

    const res = await postManifesto({ pledges: PLEDGES, action: "lock" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, locked: true });
    expect(lockManifestoMock).toHaveBeenCalled();
  });

  it("refuses a caller who chairs no party", async () => {
    getDbMock.mockResolvedValue(fakeDb(null));

    const res = await postManifesto({ pledges: PLEDGES, action: "save" });

    expect(res.status).toBe(403);
    expect(upsertManifestoDraftMock).not.toHaveBeenCalled();
  });

  it("rejects a pledge that is not in the catalog", async () => {
    getDbMock.mockResolvedValue(fakeDb({ sequentialId: 1, name: "Labour" }));

    const res = await postManifesto({ pledges: ["not.a.pledge"], action: "save" });

    expect(res.status).toBe(400);
    expect(upsertManifestoDraftMock).not.toHaveBeenCalled();
  });
});
