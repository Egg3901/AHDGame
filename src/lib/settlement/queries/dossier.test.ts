import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import {
  HUNDREDTHS,
  PERSONAL_NET_CAP,
  LADDER_UNLOCK_TURNS,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_SEATS,
  getPlay,
} from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("../actorContext", () => ({ loadSettlementActorContext: vi.fn() }));
vi.mock("../seatOffices", () => ({ resolveSeatOffices: vi.fn() }));

/** Both offices of every seat, unheld unless a test says otherwise. */
function seatOffices(over: Record<string, unknown> = {}) {
  const base = Object.fromEntries(
    SETTLEMENT_SEATS.map((s) => [
      s.id,
      [
        { role: "headOfGovernment", title: "Head of Government", holder: null },
        { role: "foreignMinister", title: "Foreign Minister", holder: null },
      ],
    ])
  );
  return { ...base, ...over };
}

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
      actions: 3,
      lastActedTurn: null,
      committedPoints: 0,
    })),
    ladder: { heat: 2, armedTurn: null },
    // Old enough that the four-power channel has run — the escalation gate is
    // exercised on its own in the tests that care about it.
    openedTurn: 412 - LADDER_UNLOCK_TURNS,
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
      budget: { actionsPerTurn: 3, actionsRemaining: 3, actionsBankCap: 9, capital: 30 },
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
    const { resolveSeatOffices } = await import("../seatOffices");
    vi.mocked(resolveSeatOffices).mockResolvedValue(seatOffices() as never);
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
    // The GDR's 2.0x, pushing East. Derived from the catalogue so a tempo
    // retune reads as a retune rather than as a broken card.
    const base = getPlay("border")!.magnitude / HUNDREDTHS;
    expect(border.effectivePoints).toBe(Math.round(base * 2 * 100) / 100);
    expect(border.basisLabel).toBe(`${base.toFixed(2)} base × 2.0× seat`);
  });

  it("prices a seat play in the seat country's own currency", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    const laender = view!.institutions.find((i) => i.id === "laender")!;
    const aid = laender.plays.find((p) => p.id === "aid")!;
    expect(aid.payments[0].costLabel).toContain("45,000,000");
    expect(aid.payments[0].costLabel).toContain("1 AP");
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
          actions: 3,
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

  it("carries each delegation's offices and holders onto its bench row", async () => {
    const { resolveSeatOffices } = await import("../seatOffices");
    vi.mocked(resolveSeatOffices).mockResolvedValue(
      seatOffices({
        US: [
          { role: "headOfGovernment", title: "President", holder: "Ariane Yeong" },
          { role: "foreignMinister", title: "Secretary of State", holder: null },
        ],
      }) as never
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    const us = view!.benches.west.find((b) => b.seatId === "US")!;
    expect(us.offices).toEqual([
      { role: "headOfGovernment", title: "President", holder: "Ariane Yeong" },
      { role: "foreignMinister", title: "Secretary of State", holder: null },
    ]);
  });

  it("gives every bench row both offices even when nobody holds either", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    for (const b of [...view!.benches.west, ...view!.benches.east]) {
      // The block says what the seat's offices ARE, not merely who is in them:
      // "vacant" is the fact that no one can act for this delegation.
      expect(b.offices.map((o) => o.role)).toEqual(["headOfGovernment", "foreignMinister"]);
      expect(b.offices.every((o) => o.holder === null)).toBe(true);
    }
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
    const many = Array.from({ length: 12 }, () => ({
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
      actionsBankCap: 9,
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

  it("keeps the arm button dark until the ladder reaches the coercive cap", async () => {
    // Heat is 2 in the default fixture — authority alone is not enough.
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      seatCtx({ id: "US", direction: -1 }) as never
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.armed).toBe(false);
    expect(view!.viewer.seat!.canEscalate).toBe(true);
    expect(view!.viewer.seat!.canArmNow).toBe(false);
  });

  it("holds the arm button dark until the four-power channel has run", async () => {
    // The gate that stops a bloc declaring on turn 4 of a 156-turn question.
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({ ladder: { heat: 4, armedTurn: null }, openedTurn: 412 - LADDER_UNLOCK_TURNS + 5 })
    );
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      seatCtx({ id: "US", direction: -1 }) as never
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    // Washington: authority, in a bloc, heat at the cap — everything but time.
    expect(view!.viewer.seat!.canArmNow).toBe(false);
    expect(view!.viewer.seat!.escalateGate).toContain(String(412 + 5));
    expect(view!.turnsUntilOpen).toBe(5);
  });

  it("tells a seat with no authority the permanent truth, not the clock", async () => {
    // East Berlin will NEVER hold escalation authority, so quoting it the turn
    // the ladder opens reads as a promise the question cannot keep.
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({ ladder: { heat: 4, armedTurn: null }, openedTurn: 412 - LADDER_UNLOCK_TURNS + 5 })
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    // Default fixture is the GDR seat.
    expect(view!.viewer.seat!.escalateGate).toContain("East Berlin");
    expect(view!.viewer.seat!.escalateGate).not.toContain("four-power channel");
  });

  it("counts the channel down to zero once it has run", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.turnsUntilOpen).toBe(0);
  });

  it("lights the arm button for an authority seat once heat sits at rung 4", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({ ladder: { heat: 4, armedTurn: null } })
    );
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      seatCtx({ id: "US", direction: -1 }) as never
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.viewer.seat!.canArmNow).toBe(true);
  });

  it("never lights it for a seat without authority, even at rung 4", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({ ladder: { heat: 4, armedTurn: null } })
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    // Default fixture is the GDR seat.
    expect(view!.viewer.seat!.canArmNow).toBe(false);
  });

  it("reports the crisis as armed at the top rung", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({ ladder: { heat: 5, armedTurn: 410 } })
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.armed).toBe(true);
    expect(view!.defcon).toBe(1);
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

  it("tags every play with the catalogue it came from", async () => {
    // The two catalogues are merged into one list per institution. Without this
    // tag the card cannot tell them apart, and committing a personal play as a
    // seat is refused 403 — a button that can never succeed.
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    const street = view!.institutions.find((i) => i.id === "street")!;
    expect(street.plays.find((p) => p.id === "border")!.actor).toBe("seat");
    expect(street.plays.find((p) => p.id === "oped")!.actor).toBe("personal");
    // Both really are present on the same institution for a seat holder.
    expect(new Set(street.plays.map((p) => p.actor))).toEqual(new Set(["seat", "personal"]));
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
    expect(rally.payments[0].affordable).toBe(false);
    expect(rally.payments[0].blockedReason).toBe("funds");
    // A free personal play is still offered.
    const oped = street.plays.find((p) => p.id === "oped")!;
    expect(oped.payments[0].affordable).toBe(true);
  });

  it("exposes the GDR's settlement-level play outside the institution cards", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.settlementPlays.map((p) => p.id)).toEqual(["referendum"]);
    // The settlement-level list goes through the same builder, so it carries
    // both routes too — it is rendered by the same card component.
    expect(view!.settlementPlays[0].payments.map((p) => p.mode)).toEqual(["funds", "capital"]);
  });
  it("carries the source design's rule defaults for a crisis with no rules block", async () => {
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.rules).toEqual({
      openLog: true,
      driftRevealed: false,
      escalationEnabled: true,
    });
  });

  it("keeps Bonn's band undisclosed by default", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(crisisDoc({ driftHistory: [180] }));
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.drift).toMatchObject({ revealed: false, band: null });
    expect(view!.wire[0].text).toContain("not disclosed");
  });

  it("publishes the band when driftRevealed is on", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({
        driftHistory: [180],
        rules: { openLog: true, driftRevealed: true, escalationEnabled: true },
      })
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.drift.revealed).toBe(true);
    expect(view!.drift.band).toContain("noise");
    expect(view!.wire[0].text).toContain("Band disclosed");
  });

  it("withholds pending commitments from the wire when the log is closed", async () => {
    // The point of a closed log: nobody reads the board before the tick.
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({ rules: { openLog: false, driftRevealed: false, escalationEnabled: true } })
    );
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
        {
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
        },
      ])
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.wire.map((w) => w.who)).toContain("EAST BERLIN");
    expect(view!.wire.map((w) => w.who)).not.toContain("WASHINGTON");
  });

  it("collapses the personal tier into one wire line naming raw and applied", async () => {
    // §4: the cap must never be silent. Forty op-eds must not also push the four
    // delegations off an eight-line wire.
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
    const floor = view!.wire.filter((w) => w.who === "OPEN FLOOR");
    expect(floor).toHaveLength(1);
    // 40 x 200 x 0.25 = 2000 hundredths asked for. The APPLIED figure is the
    // fixture's own stamps (40 x 15), because the line reports what the tick
    // already wrote rather than recomputing the cap; only the quoted ceiling
    // comes from the constant, so a tempo retune moves that and nothing else.
    expect(floor[0].text).toContain("+20.0");
    expect(floor[0].text).toContain("+6.0");
    expect(floor[0].text).toContain("capped");
    expect(view!.openFloor.rawPoints).toBe(20);
    expect(view!.openFloor.capPoints).toBe(PERSONAL_NET_CAP / HUNDREDTHS);
  });

  it("stands the ladder down for every seat when escalation is off", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      crisisDoc({
        ladder: { heat: 4, armedTurn: null },
        rules: { openLog: true, driftRevealed: false, escalationEnabled: false },
      })
    );
    const { loadGermanQuestionDossier } = await import("./dossier");
    const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
    expect(view!.viewer.seat).toMatchObject({ canEscalate: false, canArmNow: false });
    expect(view!.viewer.seat!.escalateGate).toContain("switched off");
  });

  describe("payment routes", () => {
    const playOn = async (institutionId: string, playId: string) => {
      const { loadGermanQuestionDossier } = await import("./dossier");
      const view = await loadGermanQuestionDossier(db as unknown as Db, characterId);
      return view!.institutions
        .find((i) => i.id === institutionId)!
        .plays.find((p) => p.id === playId)!;
    };

    it("offers both payment routes on a treasury-funded seat play", async () => {
      const border = await playOn("street", "border");
      expect(border.payments.map((p) => p.mode)).toEqual(["funds", "capital"]);
      // border: 14 base capital + round(8.0 points x k=4) = 46
      expect(border.payments[1].costLabel).toContain("46 capital");
    });

    it("offers one route on a play the treasury never pays for", async () => {
      // `terms` is capital-only already. A second button would be the same
      // thing at a worse price.
      const terms = await playOn("bundestag", "terms");
      expect(terms.payments).toHaveLength(1);
      expect(terms.payments[0].mode).toBe("funds");
    });

    it("offers one route on a personal play", async () => {
      const letter = await playOn("bundestag", "letter");
      expect(letter.payments).toHaveLength(1);
      expect(letter.payments[0].mode).toBe("funds");
    });

    it("names the borrowing when the cash route would run into debt", async () => {
      // Spending into debt is allowed now, so the cash button is ALWAYS live.
      // This note is the only thing left telling a player they are taking a
      // loan rather than spending savings.
      prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: 2_000_000 });
      const border = await playOn("street", "border");

      expect(border.payments[0].affordable).toBe(true);
      // ℳ12M against a ℳ2M balance: ℳ10M of it is new debt.
      expect(border.payments[0].debtNote).toContain("10,000,000");
      expect(border.payments[1].debtNote).toBeNull();
    });

    it("leaves the debt note off when the treasury covers the play", async () => {
      const border = await playOn("street", "border");
      expect(border.payments[0].debtNote).toBeNull();
    });

    it("gates the capital route on capital alone, never on the treasury", async () => {
      // A seat deep in debt still has a live capital button. That is the whole
      // point of the route. `aid` prices at 16 capital, inside the seat's 30;
      // `border` at 46 would be refused for want of capital and prove nothing
      // about the treasury.
      prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: -900_000_000 });
      const aid = await playOn("laender", "aid");
      expect(aid.payments[1].affordable).toBe(true);
      expect(aid.payments[1].blockedReason).toBeNull();
    });

    it("still refuses a capital route the seat cannot afford in capital", async () => {
      // The route removes the treasury as a gate, not capital. `border` prices
      // at 46 against a 30-point bank.
      const border = await playOn("street", "border");
      expect(border.payments[1].affordable).toBe(false);
      expect(border.payments[1].blockedReason).toBe("capital");
    });
  });
});
