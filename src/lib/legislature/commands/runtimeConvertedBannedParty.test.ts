/**
 * Regression: the banned-party guards must read the RUNTIME government type.
 *
 * `isBannedParty` re-tests `isOnePartyState` on the config shape it is handed.
 * These call sites gated correctly on `runtimeState.governmentType` and then
 * passed the STATIC `getCountryConfig(...)` into `isBannedParty` — and
 * `getCountryConfig` only ever layers era overrides onto `COUNTRY_CONFIGS`, so
 * it never learns that a country was converted at runtime.
 *
 * The result was a guard that worked for a statically one-party country (CN,
 * DD) and was silently inert for a converted one. Germany after reunification
 * is exactly that case: `COUNTRY_CONFIGS.DE.governmentType` is
 * `parliamentaryRepublic` for ever, so the six banned West German parties could
 * still propose and vote while the SED nominally ruled a one-party state.
 *
 * DE is the country under test precisely BECAUSE its static config is not
 * one-party. A test written against CN passes either way and proves nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUser } from "@/lib/auth";
import { getCountryConfig } from "@/lib/constants/countries";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 5 }),
}));
// The whole point: runtime says one-party, the compiled config does not.
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "onePartyState" }),
}));
vi.mock("@/lib/countryAccess", () => ({
  getEnabledCountryIds: vi.fn().mockResolvedValue(["DE", "US"]),
}));

import { proposeNationalBill } from "./proposeNationalBill";
import { performNationalBillAction } from "./nationalBillActions";

describe("banned-party guards under a runtime conversion", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  /** The premise the whole regression rests on. */
  it("DE's compiled config is not a one-party state", () => {
    expect(getCountryConfig("DE").governmentType).toBe("parliamentaryRepublic");
  });

  function seatBannedDeputy(): AuthUser {
    const charId = new ObjectId();
    const userId = new ObjectId();
    db.collection("characters").findOne.mockResolvedValue({
      _id: charId,
      name: "Banned Deputy",
      userId,
      party: "1",
      actions: 10,
      nationalInfluence: 100,
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: charId,
      officeType: "bundestag",
      countryId: "DE",
    });
    db.collection("politicalParties").findOne.mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "DE",
      regimeStatus: "banned",
    });
    db.collection("bills").findOne.mockResolvedValue(null);
    return { userId: userId.toString(), isAdmin: false } as AuthUser;
  }

  it("refuses a banned party proposing a national bill", async () => {
    const authUser = seatBannedDeputy();

    const result = await proposeNationalBill(db as unknown as Db, "DE", authUser, {
      title: "Restoration of the Federal Republic Act",
      summary: "A test bill.",
      chamber: "bundestag",
      category: "general",
      provisions: [],
    });

    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toMatch(/Banned parties cannot propose/);
    expect(db.collectionMocks.bills?.insertOne).not.toHaveBeenCalled();
  });

  it("refuses a banned party voting on a national bill", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    db.collection("politicalParties").findOne.mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "DE",
      regimeStatus: "banned",
    });

    const result = await performNationalBillAction(db as unknown as Db, {
      authUser: { userId: userId.toString(), isAdmin: false } as AuthUser,
      character: {
        _id: charId,
        name: "Banned Deputy",
        userId,
        party: "1",
      } as unknown as Parameters<typeof performNationalBillAction>[1]["character"],
      bill: {
        _id: new ObjectId(),
        countryId: "DE",
        status: "active",
        currentChamber: "bundestag",
        votes: {},
      } as unknown as Parameters<typeof performNationalBillAction>[1]["bill"],
      countryId: "DE",
      input: { action: "vote", vote: "aye" },
    });

    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toMatch(/Banned parties cannot vote/);
  });
});
