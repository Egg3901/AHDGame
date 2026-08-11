import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { SURPRISE_CASE_TEMPLATES } from "@/lib/scotus/surpriseCaseTemplates";
import { SURPRISE_CASE_SPAWN_PROBABILITY_PER_TURN } from "@/lib/scotus/surpriseCaseSpawn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/scotus/scotusNews", () => ({
  generateScotusSurpriseNews: vi.fn().mockResolvedValue(undefined),
}));

/**
 * #3607 testing note (mirrors scotusDocketTurn.test.ts's approach): assert
 * on the external, observable hand-off to onBillEnacted (already covered by
 * its own test suite) plus the docketCases row written, not on internals.
 */
describe("processScotusSurpriseCaseTurn", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 1,
      startingYear: 1953,
      preset: "1953-default",
    } as never);
    db.collection("docketCases");
    db.collection("supremeCourtSeats");
    db.collection("enactedLaws");
    // The era filter reads the live clock through getEraContext, which reads the
    // gameState DOC — not the getGameState mock above. Without this the fixture
    // has eraSystemEnabled falsy, year null, and the filter silently disables,
    // so the anachronism test would pass by not running.
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
      startingYear: 1953,
      currentYear: 1953,
      currentTurn: 1,
      eraSystemEnabled: true,
    });
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

  // The era filter has to run in the SPAWN, not just in the helper — a correct
  // `templatesForYear` that nothing calls would leave the 1953 docket hearing
  // solar-cartel antitrust suits exactly as before.
  it("never spawns a case the current year could not have heard", async () => {
    const { processScotusSurpriseCaseTurn } = await import("./scotusSurpriseCaseTurn");
    const { templatesForYear, SURPRISE_CASE_TEMPLATES } =
      await import("@/lib/scotus/surpriseCaseTemplates");
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat({ economicLean: 2, socialLean: 2 })]),
    });
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const eligible1953 = new Set(
      templatesForYear(SURPRISE_CASE_TEMPLATES, 1953).map((t) => t.templateKey)
    );
    const excluded = SURPRISE_CASE_TEMPLATES.filter((t) => !eligible1953.has(t.templateKey));
    expect(
      excluded.length,
      "no template is era-excluded in 1953 — test is vacuous"
    ).toBeGreaterThan(0);

    // Sweep the whole pick space; every draw must land on an eligible template.
    for (let i = 0; i < 20; i++) {
      db.collectionMocks.docketCases!.insertOne.mockClear();
      await processScotusSurpriseCaseTurn(1, db as unknown as Db, 0, i / 20);
      const inserted = db.collectionMocks.docketCases!.insertOne.mock.calls[0]?.[0] as
        { caseKey: string } | undefined;
      if (!inserted) continue;
      expect(eligible1953.has(inserted.caseKey), `drew ${inserted.caseKey} in 1953`).toBe(true);
    }
  });

  it("does not spawn when the draw is above the spawn probability", async () => {
    const { processScotusSurpriseCaseTurn } = await import("./scotusSurpriseCaseTurn");
    const result = await processScotusSurpriseCaseTurn(
      1,
      db as unknown as Db,
      SURPRISE_CASE_SPAWN_PROBABILITY_PER_TURN + 0.001,
      0
    );

    expect(result).toEqual({ spawned: false });
    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).not.toHaveBeenCalled();
    expect(db.collectionMocks.docketCases!.insertOne).not.toHaveBeenCalled();
  });

  it("spawns, resolves via majority headcount (positive), and calls onBillEnacted with source scotus_surprise_ruling", async () => {
    const seats = [
      seat({ seatNumber: 1, economicLean: 3, socialLean: 3 }),
      seat({ seatNumber: 2, economicLean: 2, socialLean: 2 }),
      seat({ seatNumber: 3, justiceMode: null, economicLean: null, socialLean: null }), // vacant — excluded
    ];
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(seats),
    });
    // No previously-spawned surprise cases — every template is available.
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const template = SURPRISE_CASE_TEMPLATES[0];

    const { processScotusSurpriseCaseTurn } = await import("./scotusSurpriseCaseTurn");
    const result = await processScotusSurpriseCaseTurn(1, db as unknown as Db, 0, 0);

    expect(result).toEqual({ spawned: true, caseKey: template.templateKey, majoritySide: 1 });

    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).toHaveBeenCalledTimes(1);
    const [, syntheticBill] = vi.mocked(onBillEnacted).mock.calls[0];
    expect(syntheticBill).toMatchObject({
      countryId: "US",
      stateId: "federal",
      source: "scotus_surprise_ruling",
      legislationTypeId: template.positiveEffect.legislationTypeId,
      provisions: [
        expect.objectContaining({
          legislationTypeId: template.positiveEffect.legislationTypeId,
          policyOptionId: template.positiveEffect.policyOptionId,
        }),
      ],
    });

    expect(db.collectionMocks.docketCases!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "US",
        preset: "1953-default",
        caseKey: template.templateKey,
        title: template.title,
        axis: template.axis,
        status: "decided",
        outcome: "diverged",
        decidedAtTurn: 1,
        decisionSeatedFor: 2,
        decisionSeatedAgainst: 0,
        isSurprise: true,
        effect: template.positiveEffect,
      })
    );

    const { generateScotusSurpriseNews } = await import("@/lib/scotus/scotusNews");
    expect(generateScotusSurpriseNews).toHaveBeenCalledTimes(1);
    const [newsTemplateArg, newsDecisionArg] = vi.mocked(generateScotusSurpriseNews).mock.calls[0];
    expect(newsTemplateArg).toBe(template);
    expect(newsDecisionArg).toMatchObject({ majoritySide: 1 });
  });

  it("resolves via majority headcount (negative) and picks the template's negativeEffect", async () => {
    const seats = [
      seat({ seatNumber: 1, economicLean: -3, socialLean: -3 }),
      seat({ seatNumber: 2, economicLean: -2, socialLean: -2 }),
      seat({ seatNumber: 3, economicLean: 1, socialLean: 1 }),
    ];
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(seats),
    });
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const template = SURPRISE_CASE_TEMPLATES[0];

    const { processScotusSurpriseCaseTurn } = await import("./scotusSurpriseCaseTurn");
    const result = await processScotusSurpriseCaseTurn(1, db as unknown as Db, 0, 0);

    expect(result).toEqual({ spawned: true, caseKey: template.templateKey, majoritySide: -1 });

    const { onBillEnacted } = await import("@/lib/billEnactment");
    const [, syntheticBill] = vi.mocked(onBillEnacted).mock.calls[0];
    expect(syntheticBill).toMatchObject({
      source: "scotus_surprise_ruling",
      legislationTypeId: template.negativeEffect.legislationTypeId,
      provisions: [
        expect.objectContaining({ policyOptionId: template.negativeEffect.policyOptionId }),
      ],
    });
  });

  it("on a headcount tie, records the case but applies no effect and never calls onBillEnacted", async () => {
    const seats = [
      seat({ seatNumber: 1, economicLean: 2, socialLean: 2 }),
      seat({ seatNumber: 2, economicLean: -2, socialLean: -2 }),
    ];
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(seats),
    });
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const template = SURPRISE_CASE_TEMPLATES[0];

    const { processScotusSurpriseCaseTurn } = await import("./scotusSurpriseCaseTurn");
    const result = await processScotusSurpriseCaseTurn(1, db as unknown as Db, 0, 0);

    expect(result).toEqual({ spawned: true, caseKey: template.templateKey, majoritySide: 0 });

    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).not.toHaveBeenCalled();

    expect(db.collectionMocks.docketCases!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "decided",
        outcome: "diverged",
        effect: undefined,
      })
    );
    const insertedDoc = db.collectionMocks.docketCases!.insertOne.mock.calls[0][0];
    expect(insertedDoc).not.toHaveProperty("enactedLawId");
  });

  it("never repeats a template already spawned this game", async () => {
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([seat({ seatNumber: 1, economicLean: 1, socialLean: 1 })]),
    });
    // Every template except the last one has already spawned.
    const alreadyUsed = SURPRISE_CASE_TEMPLATES.slice(0, -1).map((t) => ({
      caseKey: t.templateKey,
    }));
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(alreadyUsed),
    });

    const { processScotusSurpriseCaseTurn } = await import("./scotusSurpriseCaseTurn");
    // templatePickRandomDraw = 0 would normally pick index 0, but only the
    // last template remains available, so it must be picked instead.
    const result = await processScotusSurpriseCaseTurn(1, db as unknown as Db, 0, 0);

    const lastTemplate = SURPRISE_CASE_TEMPLATES[SURPRISE_CASE_TEMPLATES.length - 1];
    expect(result.caseKey).toBe(lastTemplate.templateKey);
  });

  it("does not spawn when the entire template pool has already been used", async () => {
    db.collectionMocks.supremeCourtSeats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const allUsed = SURPRISE_CASE_TEMPLATES.map((t) => ({ caseKey: t.templateKey }));
    db.collectionMocks.docketCases!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(allUsed),
    });

    const { processScotusSurpriseCaseTurn } = await import("./scotusSurpriseCaseTurn");
    const result = await processScotusSurpriseCaseTurn(1, db as unknown as Db, 0, 0);

    expect(result).toEqual({ spawned: false });
    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).not.toHaveBeenCalled();
    expect(db.collectionMocks.docketCases!.insertOne).not.toHaveBeenCalled();
  });
});
