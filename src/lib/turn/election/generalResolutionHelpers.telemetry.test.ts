import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { sweepStaleOffice, resolveElectionWithNoTally } from "./generalResolutionHelpers";
import { captureOfficeTransition } from "@/lib/analytics/officeTransitionAnalytics";

vi.mock("@/lib/analytics/officeTransitionAnalytics", () => ({
  captureOfficeTransition: vi.fn().mockResolvedValue(undefined),
}));

describe("stale elected office telemetry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("captures a governor vacancy from an empty resolved race using the existing incumbent record", async () => {
    const db = createInMemoryDb() as unknown as Db;
    const characterId = new ObjectId();
    const election = {
      _id: new ObjectId(),
      countryId: "US",
      electionType: "governor",
      state: "CA",
    };
    await db.collection("characters").insertOne({
      _id: characterId,
      countryId: "US",
      currentOffice: { type: "governor", state: "CA" },
    });
    await db.collection("electedOfficials").insertOne({
      _id: new ObjectId(),
      characterId,
      officeType: "governor",
      state: "CA",
      party: "1",
    });
    await db.collection("elections").insertOne(election);
    await resolveElectionWithNoTally(db, election as never, new Date(), 42);
    expect(
      (await db.collection("characters").findOne({ _id: characterId }))?.currentOffice
    ).toBeNull();
    expect(captureOfficeTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        officeType: "governor",
        transitionType: "lost",
        partyId: "1",
        nationId: "US",
        turn: 42,
      })
    );
  });

  it("reports a non-running departing holder while preserving winners and the other chamber class", async () => {
    const db = createInMemoryDb() as unknown as Db;
    const departed = new ObjectId(),
      winner = new ObjectId(),
      otherClass = new ObjectId();
    await db.collection("characters").insertMany([
      {
        _id: departed,
        countryId: "JP",
        party: "1",
        currentOffice: { type: "sangiin", state: "JP-01", chamberClass: 1 },
      },
      {
        _id: winner,
        countryId: "JP",
        party: "1",
        currentOffice: { type: "sangiin", state: "JP-01", chamberClass: 1 },
      },
      {
        _id: otherClass,
        countryId: "JP",
        party: "2",
        currentOffice: { type: "sangiin", state: "JP-01", chamberClass: 2 },
      },
    ]);
    await db
      .collection("electedOfficials")
      .insertOne({ officeType: "sangiin", state: "JP-01", chamberClass: 1, characterId: winner });
    await sweepStaleOffice(db, "sangiin", "JP-01", new Date(), 1, { turn: 42, nationId: "JP" });
    expect(
      (await db.collection("characters").findOne({ _id: departed }))?.currentOffice
    ).toBeNull();
    expect(
      (await db.collection("characters").findOne({ _id: winner }))?.currentOffice
    ).not.toBeNull();
    expect(
      (await db.collection("characters").findOne({ _id: otherClass }))?.currentOffice
    ).not.toBeNull();
    expect(captureOfficeTransition).toHaveBeenCalledTimes(1);
    expect(captureOfficeTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        officeType: "sangiin",
        transitionType: "lost",
        selectionMethod: "election",
        partyId: "1",
        nationId: "JP",
        turn: 42,
      })
    );
    vi.mocked(captureOfficeTransition).mockClear();
    await sweepStaleOffice(db, "sangiin", "JP-01", new Date(), 1, { turn: 42, nationId: "JP" });
    expect(captureOfficeTransition).not.toHaveBeenCalled();
  });
});
