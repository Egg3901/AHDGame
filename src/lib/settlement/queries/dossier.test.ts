import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { SETTLEMENT_INSTITUTIONS, SETTLEMENT_SEATS } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("../actorContext", () => ({ loadSettlementActorContext: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

/** A cursor whose toArray resolves to `docs`. */
function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

const CRISIS_ID = new ObjectId();
const characterId = new ObjectId();

function crisisDoc(over: Record<string, unknown> = {}) {
  return {
    _id: CRISIS_ID,
    status: "open",
    position: 3820,
    institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({
      id: i.id,
      weight: i.weight,
      position: i.opening,
      lastPlay: null,
      lastDrift: 0,
    })),
    seats: SETTLEMENT_SEATS.map((s) => ({
      id: s.id,
      capital: 30,
      actionsUsedTurn: 0,
      lastActedTurn: null,
      committedPoints: 0,
    })),
    ladder: { heat: 2, armedTurn: null },
    driftHistory: [],
    ...over,
  };
}

function seatCtx(over: Record<string, unknown> = {}) {
  return {
    crisisId: CRISIS_ID.toString(),
    seat: {
      id: "DD",
      role: "headOfGovernment",
      direction: 1,
      budget: { actionsPerTurn: 3, actionsRemaining: 3, capital: 30 },
      canAct: true,
      blockedReason: null,
      ...over,
    },
    personal: { actionsRemaining: 4 },
  };
}

describe("loadGermanQuestionDossier", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    prime(db, "settlementCrises").findOne.mockResolvedValue(crisisDoc());
    prime(db, "settlementPlays").find.mockReturnValue(cursor([]));
    prime(db, "gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 412,
      nextScheduledTurn: new Date("1953-06-01T12:00:00Z"),
    });
    prime(db, "governmentFormations").findOne.mockResolvedValue({
      _id: "DE",
      seatsByParty: { "1": 243, "2": 151, "3": 48 },
    });
    prime(db, "politicalParties").find.mockReturnValue(
      cursor([
        { sequentialId: 1, name: "CDU/CSU" },
        { sequentialId: 2, name: "SPD" },
        { sequentialId: 3, name: "FDP" },
      ])
    );
    prime(db, "states").countDocuments.mockResolvedValue(11);
    prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: 310_000_000 });

    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(seatCtx() as never);
  });

  it("returns null when the feature gate is off", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(null);
    const { loadGermanQuestionDossier } = await import("./dossier");
    await expect(loadGermanQuestionDossier(db as unknown as Db, characterId)).resolves.toBeNull();
  });

  it("returns null when no crisis is open", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue({
      crisisId: null,
      seat: null,
      personal: { actionsRemaining: 4 },
    } as never);
    const { loadGermanQuestionDossier } = await import("./dossier");
    await expect(loadGermanQuestionDossier(db as unknown as Db, characterId)).resolves.toBeNull();
  });

  it("counts the Bundestag's seats instead of printing the mockup's 496", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    const bundestag = view!.institutions.find((i) => i.id === "bundestag")!;
    // 243 + 151 + 48 = 442, from live seatsByParty. Never 496.
    expect(bundestag.subtitle).toBe("Bonn · 442 seats · CDU/CSU–SPD–FDP");
    expect(bundestag.subtitle).not.toContain("496");
  });

  it("degrades the Bundestag subtitle rather than inventing seats when none are seated", async () => {
    prime(db, "governmentFormations").findOne.mockResolvedValue(null);
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.institutions.find((i) => i.id === "bundestag")!.subtitle).toBe("Bonn");
  });

  it("counts the Länder rather than hardcoding eleven", async () => {
    prime(db, "states").countDocuments.mockResolvedValue(6);
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.institutions.find((i) => i.id === "laender")!.subtitle).toBe(
      "6 state governments · Bundesrat bloc"
    );
  });

  it("derives the masthead percentages and lead note from the stored index", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.eastPct).toBe(38.2);
    expect(view!.westPct).toBe(61.8);
    expect(view!.leadNote).toContain("sovereignty leads by");
  });

  it("shows a seat play's EFFECTIVE swing with its basis", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    const street = view!.institutions.find((i) => i.id === "street")!;
    const border = street.plays.find((p) => p.id === "border")!;
    // 8.0 base at the GDR's 2.0x, pushing East.
    expect(border.effectivePoints).toBe(16);
    expect(border.basisLabel).toBe("8.0 base × 2.0× seat");
  });

  it("prices a seat play in the seat country's own currency", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    const laender = view!.institutions.find((i) => i.id === "laender")!;
    const aid = laender.plays.find((p) => p.id === "aid")!;
    expect(aid.costLabel).toContain("45,000,000");
    expect(aid.costLabel).toContain("1 AP");
  });

  it("offers personal plays to a viewer with no seat, and no seat plays", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue({
      crisisId: CRISIS_ID.toString(),
      seat: null,
      personal: { actionsRemaining: 4 },
    } as never);
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.viewer.seat).toBeNull();
    expect(view!.viewer.personalActions).toBe(4);
    const street = view!.institutions.find((i) => i.id === "street")!;
    expect(street.plays.map((p) => p.id).sort()).toEqual(["oped", "rally"]);
    // Garrison has no personal lever at all.
    const garrison = view!.institutions.find((i) => i.id === "garrison")!;
    expect(garrison.plays).toHaveLength(0);
    expect(garrison.gateNote).toContain("only reach the street and the Bundestag");
  });

  it("normalises bench bars against the leader and survives an all-zero board", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    for (const b of [...view!.benches.west, ...view!.benches.east]) {
      expect(Number.isFinite(b.barPct)).toBe(true);
      expect(b.barPct).toBe(0);
    }
  });

  it("scales bench bars against the highest committed total", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({
        seats: SETTLEMENT_SEATS.map((s) => ({
          id: s.id,
          capital: 30,
          actionsUsedTurn: 0,
          lastActedTurn: null,
          committedPoints: s.id === "DD" ? 4000 : 1000,
        })),
      })
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    const dd = view!.benches.east.find((b) => b.seatId === "DD")!;
    const uk = view!.benches.west.find((b) => b.seatId === "UK")!;
    expect(dd.barPct).toBe(100);
    expect(uk.barPct).toBe(25);
    expect(dd.committedPoints).toBe(40);
    expect(dd.isViewer).toBe(true);
  });

  it("counts the open floor live and flags when the cap bit", async () => {
    const personal = Array.from({ length: 40 }, () => ({
      _id: new ObjectId(),
      crisisId: CRISIS_ID,
      actor: "personal",
      seatId: null,
      characterId: new ObjectId(),
      playId: "rally",
      targetInstitutionId: "street",
      direction: 1,
      basePoints: 200,
      appliedPoints: 15,
      turn: 412,
      resolvedTurn: 412,
    }));
    prime(db, "settlementPlays").find.mockReturnValue(cursor(personal));
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.openFloor.characters).toBe(40);
    // 40 × 200 × 0.25 = 2000 raw against a 600 cap.
    expect(view!.openFloor.capped).toBe(true);
    expect(view!.openFloor.netPoints).toBe(6);
  });

  it("builds the wire newest-first and caps it at eight lines", async () => {
    const many = Array.from({ length: 12 }, (_, n) => ({
      _id: new ObjectId(),
      crisisId: CRISIS_ID,
      actor: "seat",
      seatId: "DD",
      characterId: new ObjectId(),
      playId: "aid",
      targetInstitutionId: "laender",
      direction: 1,
      basePoints: 400,
      appliedPoints: 800,
      turn: 412,
      resolvedTurn: 412,
    }));
    prime(db, "settlementPlays").find.mockReturnValue(cursor(many));
    prime(db, "settlementCrises").findOne.mockResolvedValue(crisisDoc({ driftHistory: [180] }));
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.wire).toHaveLength(8);
    // Bonn's drift is the newest event on the board.
    expect(view!.wire[0].who).toBe("BONN");
    expect(view!.wire[0].text).toContain("+1.8");
  });

  it("reports an unresolved play as pending rather than claiming a movement", async () => {
    prime(db, "settlementPlays").find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          crisisId: CRISIS_ID,
          actor: "seat",
          seatId: "US",
          characterId: new ObjectId(),
          playId: "credit",
          targetInstitutionId: "laender",
          direction: -1,
          basePoints: 500,
          appliedPoints: null,
          turn: 412,
          resolvedTurn: null,
        },
      ])
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.wire[0].text).toContain("Resolves on the next tick");
  });

  it("gives the viewer's seat its live capital, treasury and action budget", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.viewer.seat).toMatchObject({
      id: "DD",
      tier: "PRIMARY",
      multiplier: "2.0×",
      capital: 30,
      capitalLabel: "Party Capital",
      actionsRemaining: 3,
      actionsPerTurn: 3,
      canAct: true,
    });
    expect(view!.viewer.seat!.treasuryLabel).toContain("310,000,000");
  });

  it("denies escalation to a non-authority seat and explains why", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.viewer.seat!.canEscalate).toBe(false);
    expect(view!.viewer.seat!.escalateGate).toContain("East Berlin");
  });

  it("grants escalation to Washington", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      seatCtx({ id: "US", direction: -1 }) as never
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.viewer.seat!.canEscalate).toBe(true);
    expect(view!.viewer.seat!.escalateGate).toBeNull();
  });

  it("marks the current ladder rung and the ones already passed", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.defcon).toBe(4);
    expect(view!.ladder.find((r) => r.here)!.num).toBe(2);
    expect(view!.ladder.filter((r) => r.passed).map((r) => r.num)).toEqual([1]);
  });

  it("hands the client a timestamp, not a preformatted countdown", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.nextTurnAt).toBe("1953-06-01T12:00:00.000Z");
    expect(view!.turn).toBe(412);
  });

  it("names the delegation by its capital on the wire, not by its seat id", async () => {
    prime(db, "settlementPlays").find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          crisisId: CRISIS_ID,
          actor: "seat",
          seatId: "DD",
          characterId: new ObjectId(),
          playId: "border",
          targetInstitutionId: "street",
          direction: 1,
          basePoints: 800,
          appliedPoints: 1600,
          turn: 412,
          resolvedTurn: 412,
        },
      ])
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.wire.map((w) => w.who)).toContain("EAST BERLIN");
    expect(view!.wire.map((w) => w.who)).not.toContain("DD");
  });

  it("disables a personal play the viewer cannot actually pay for", async () => {
    // `rally` costs funds; a character with none must see it disabled rather
    // than enabled-then-refused by the route.
    prime(db, "characters").findOne.mockResolvedValue({
      _id: characterId,
      actions: 4,
      funds: 0,
      currencyBalances: { campaign: 0 },
      countryId: "US",
    });
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    const street = view!.institutions.find((i) => i.id === "street")!;
    const rally = street.plays.find((p) => p.id === "rally")!;
    expect(rally.affordable).toBe(false);
    expect(rally.blockedReason).toBe("funds");
    // A free personal play is still offered.
    const oped = street.plays.find((p) => p.id === "oped")!;
    expect(oped.affordable).toBe(true);
  });

  it("exposes the GDR's settlement-level play outside the institution cards", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.settlementPlays.map((p) => p.id)).toEqual(["referendum"]);
  });
});
