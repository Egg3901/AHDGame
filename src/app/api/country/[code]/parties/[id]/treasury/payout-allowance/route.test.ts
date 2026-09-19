import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn(async () => ({ currentTurn: 989 })) }));

describe("GET /api/country/[code]/parties/[id]/treasury/payout-allowance", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const chairId = new ObjectId();
  const memberId = new ObjectId();
  const otherId = new ObjectId();
  const partyOid = new ObjectId();
  const partyId = "1";

  function call(characterId: string) {
    return import("./route").then(({ GET }) =>
      GET(
        new Request(
          `http://localhost/api/country/us/parties/1/treasury/payout-allowance?characterId=${characterId}`
        ),
        { params: Promise.resolve({ code: "us", id: partyId }) }
      )
    );
  }

  async function signInAs(character: { _id: ObjectId; name: string }) {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        username: "player",
        isAdmin: false,
        isBanned: false,
        character: { ...character, party: partyId, countryId: "US" },
      },
    } as never);
  }

  /** Total already drawn from party funds this turn, as the ledger reports it. */
  function alreadyDrawn(total: number | null) {
    db.collectionMocks["treasuryTransactions"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(total == null ? [] : [{ total }]),
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("treasuryTransactions");
    alreadyDrawn(null);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    await signInAs({ _id: memberId, name: "Member" });

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyOid,
      sequentialId: Number(partyId),
      countryId: "US",
      name: "Test Party",
      chairId,
      viceChairId: null,
      treasurerId: null,
    } as never);
  });

  it("reports the full cap to a member who has drawn nothing", async () => {
    const response = await call(memberId.toString());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ cap: 2_000_000, used: 0, remaining: 2_000_000 });
  });

  it("subtracts what the member has already drawn this turn", async () => {
    alreadyDrawn(1_500_000);
    const response = await call(memberId.toString());
    const body = await response.json();
    expect(body).toMatchObject({ cap: 2_000_000, used: 1_500_000, remaining: 500_000 });
  });

  it("floors remaining at zero rather than reporting a negative allowance", async () => {
    // A cap cut mid-turn, or an overshoot from two payouts landing in
    // the same instant, must not print as a negative number on the card.
    alreadyDrawn(2_400_000);
    const response = await call(memberId.toString());
    const body = await response.json();
    expect(body.remaining).toBe(0);
  });

  it("lets an officer read another member's allowance", async () => {
    // The Send to Member case: the officer needs the recipient's figure
    // to know what they can actually pay.
    await signInAs({ _id: chairId, name: "Chair" });
    const response = await call(otherId.toString());
    expect(response.status).toBe(200);
  });

  it("refuses an ordinary member reading someone else's allowance", async () => {
    const response = await call(otherId.toString());
    expect(response.status).toBe(403);
  });

  it("defaults to the caller when characterId is omitted", async () => {
    // The Request Funds case: the card asks about its own viewer and
    // has no reason to know their character id.
    alreadyDrawn(250_000);
    const response = await import("./route").then(({ GET }) =>
      GET(new Request("http://localhost/api/country/us/parties/1/treasury/payout-allowance"), {
        params: Promise.resolve({ code: "us", id: partyId }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.characterId).toBe(memberId.toString());
    expect(body.remaining).toBe(1_750_000);
  });

  it("rejects a malformed characterId", async () => {
    const response = await call("not-an-object-id");
    expect(response.status).toBe(400);
  });

  it("rejects an unknown country code", async () => {
    const response = await import("./route").then(({ GET }) =>
      GET(
        new Request(
          `http://localhost/api/country/zz/parties/1/treasury/payout-allowance?characterId=${memberId.toString()}`
        ),
        { params: Promise.resolve({ code: "zz", id: partyId }) }
      )
    );
    expect(response.status).toBe(400);
  });

  it("404s when the party does not exist", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null as never);
    const response = await call(memberId.toString());
    expect(response.status).toBe(404);
  });
});
