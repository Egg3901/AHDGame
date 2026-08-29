import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/scotus/scotusNews", () => ({
  generateScotusRulingNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));

/**
 * #3598 testing note: "assert on external, observable behavior (enacted-law
 * entries...) rather than internal implementation details." `onBillEnacted`
 * has its own dedicated test suite (billEnactment.test.ts) covering its
 * internals — here we assert the SCOTUS wiring's hand-off contract to that
 * existing, already-tested pipeline: does a diverged case call it with the
 * right synthetic bill (source: "scotus_ruling", the authored
 * legislationTypeId/policyOptionId), and does an affirmed case never call it
 * at all.
 */
describe("processScotusDocketTurn", () => {
  let db: MockDb;
  const startingYear = 1953;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 1, startingYear } as never);
    db.collection("docketCases");
    db.collection("supremeCourtSeats");
    db.collection("enactedLaws");
  });

  function seat(overrides: Partial<Record<string, unknown>>) {
    return {
      _id: new ObjectId(),
      countryId: "US",
      justiceCharacterId: null,
      justiceNppId: null,
      justiceMode: "historical",
      economicLean: 0,
      socialLean: 0,
      ...overrides,
    };
  }

  it("fires a due case, diverges, and calls onBillEnacted with source scotus_ruling", async () => {
    const seats = [
      seat({ seatNumber: 1, economicLean: 3, socialLean: 1 }),
      seat({ seatNumber: 2, economicLean: 2, socialLean: 1 }),
      seat({ seatNumber: 3, justiceMode: null, economicLean: null, socialLean: null }), // vacant — excluded
    ];
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(seats),
    });

    const docketCase = {
      _id: new ObjectId(),
      countryId: "US",
      preset: "1953-default",
      caseKey: "test-case-1",
      title: "Test Case",
      axis: "economic",
      historicalMajorityDirection: -1, // history: negative majority. Court is 2-0 positive -> diverges.
      decisionYear: 1953, // turn 1
      effect: {
        legislationTypeId: "us_federal_healthcare_funding",
        policyOptionId: "single_payer",
        effectDirection: 1,
      },
      status: "pending",
    };
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([docketCase]),
    });

    const { processScotusDocketTurn } = await import("./scotusDocketTurn");
    const result = await processScotusDocketTurn(1, db as unknown as Db);

    expect(result).toEqual({ casesFired: 1, casesAffirmed: 0, casesDiverged: 1 });

    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).toHaveBeenCalledTimes(1);
    const [, syntheticBill] = vi.mocked(onBillEnacted).mock.calls[0];
    expect(syntheticBill).toMatchObject({
      countryId: "US",
      stateId: "federal",
      source: "scotus_ruling",
      legislationTypeId: "us_federal_healthcare_funding",
      provisions: [
        expect.objectContaining({
          legislationTypeId: "us_federal_healthcare_funding",
          policyOptionId: "single_payer",
        }),
      ],
    });

    expect(db.collectionMocks.docketCases!.updateOne).toHaveBeenCalledWith(
      { _id: docketCase._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "decided",
          outcome: "diverged",
          decisionSeatedFor: 2,
          decisionSeatedAgainst: 0,
        }),
      })
    );
  });

  it("affirms a due case when the majority matches history, and never calls onBillEnacted", async () => {
    const seats = [
      seat({ seatNumber: 1, economicLean: 3 }),
      seat({ seatNumber: 2, economicLean: 2 }),
      seat({ seatNumber: 3, economicLean: -1 }),
    ];
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(seats),
    });

    const docketCase = {
      _id: new ObjectId(),
      countryId: "US",
      axis: "economic",
      historicalMajorityDirection: 1, // matches the 2-1 positive majority above
      decisionYear: 1953,
      status: "pending",
      // No authored effect — spec: affirmed cases require none.
    };
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([docketCase]),
    });

    const { processScotusDocketTurn } = await import("./scotusDocketTurn");
    const result = await processScotusDocketTurn(1, db as unknown as Db);

    expect(result).toEqual({ casesFired: 1, casesAffirmed: 1, casesDiverged: 0 });
    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).not.toHaveBeenCalled();
    expect(db.collectionMocks.docketCases!.updateOne).toHaveBeenCalledWith(
      { _id: docketCase._id },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "decided", outcome: "affirmed" }),
      })
    );
  });

  it("does not fire a case before its decision turn arrives", async () => {
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const docketCase = {
      _id: new ObjectId(),
      countryId: "US",
      axis: "economic",
      historicalMajorityDirection: 1,
      decisionYear: 1960, // far in the future relative to turn 1
      status: "pending",
    };
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([docketCase]),
    });

    const { processScotusDocketTurn } = await import("./scotusDocketTurn");
    const result = await processScotusDocketTurn(1, db as unknown as Db);

    expect(result).toEqual({ casesFired: 0, casesAffirmed: 0, casesDiverged: 0 });
    expect(db.collectionMocks.docketCases!.updateOne).not.toHaveBeenCalled();
  });

  it("holds a case back until the CALENDAR year reaches its decision year (#1208)", async () => {
    // Live world 2026-08-28: raw turn 434, startingYear 1953, preIterationTurns
    // 48 — the founding phase burns 48 turns before the calendar starts, so the
    // world reads 1961 while the raw turn maps to 1962. Scheduling off the raw
    // turn is what handed players "Baker v. Carr (1962)" in a 1961 world.
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 434,
      startingYear,
      preIterationTurns: 48,
    } as never);
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          countryId: "US",
          axis: "economic",
          historicalMajorityDirection: 1,
          decisionYear: 1962,
          status: "pending",
        },
      ]),
    });

    const { processScotusDocketTurn } = await import("./scotusDocketTurn");
    const result = await processScotusDocketTurn(434, db as unknown as Db);

    expect(result).toEqual({ casesFired: 0, casesAffirmed: 0, casesDiverged: 0 });
    expect(db.collectionMocks.docketCases!.updateOne).not.toHaveBeenCalled();
  });

  it("fires the case once the founding-phase-adjusted calendar reaches it", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 481,
      startingYear,
      preIterationTurns: 48,
    } as never);
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          countryId: "US",
          axis: "economic",
          historicalMajorityDirection: 1,
          decisionYear: 1962,
          status: "pending",
        },
      ]),
    });

    const { processScotusDocketTurn } = await import("./scotusDocketTurn");
    const result = await processScotusDocketTurn(481, db as unknown as Db);

    expect(result.casesFired).toBe(1);
  });

  it("posts a full news/wire post for every decided case, affirmed or diverged", async () => {
    const seats = [
      seat({ seatNumber: 1, economicLean: 3 }),
      seat({ seatNumber: 2, economicLean: 2 }),
    ];
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(seats),
    });
    const docketCase = {
      _id: new ObjectId(),
      countryId: "US",
      caseKey: "affirmed-case",
      title: "Affirmed Case",
      axis: "economic",
      historicalMajorityDirection: 1, // matches the 2-0 positive majority above
      decisionYear: 1953,
      status: "pending",
    };
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([docketCase]),
    });

    const { processScotusDocketTurn } = await import("./scotusDocketTurn");
    const result = await processScotusDocketTurn(1, db as unknown as Db);

    expect(result.casesAffirmed).toBe(1);
    const { generateScotusRulingNews } = await import("@/lib/scotus/scotusNews");
    expect(generateScotusRulingNews).toHaveBeenCalledTimes(1);
    const [newsCaseArg, newsDecisionArg] = vi.mocked(generateScotusRulingNews).mock.calls[0];
    expect(newsCaseArg).toMatchObject({ caseKey: "affirmed-case" });
    expect(newsDecisionArg).toMatchObject({ outcome: "affirmed" });
  });

  it("records a demographicSignal country-history event for its authored outcome, and skips it for cases without one", async () => {
    const seats = [
      seat({ seatNumber: 1, socialLean: -3 }),
      seat({ seatNumber: 2, socialLean: -2 }),
      seat({ seatNumber: 3, socialLean: 1 }),
    ]; // 2 negative, 1 positive -> majoritySide -1
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(seats),
    });

    const reapportionmentCase = {
      _id: new ObjectId(),
      countryId: "US",
      caseKey: "reapportionment-case",
      title: "Reapportionment Case",
      axis: "social",
      historicalMajorityDirection: -1, // matches the sitting -1 majority -> affirms
      decisionYear: 1953,
      status: "pending",
      demographicSignal: {
        affirmedSignal: "signal_affirmed",
        divergedSignal: "signal_diverged",
      },
    };
    const plainCase = {
      _id: new ObjectId(),
      countryId: "US",
      caseKey: "plain-case",
      title: "Plain Case",
      axis: "social",
      historicalMajorityDirection: -1,
      decisionYear: 1953,
      status: "pending",
      // No demographicSignal authored.
    };
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([reapportionmentCase, plainCase]),
    });

    const { processScotusDocketTurn } = await import("./scotusDocketTurn");
    await processScotusDocketTurn(1, db as unknown as Db);

    const { recordCountryEvent } = await import("@/lib/turn/history/recordCountryEvent");
    expect(recordCountryEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordCountryEvent).mock.calls[0][1]).toMatchObject({
      countryId: "US",
      eventType: "scotus_demographic_signal",
      details: expect.objectContaining({
        caseKey: "reapportionment-case",
        signal: "signal_affirmed",
      }),
    });
  });
});
