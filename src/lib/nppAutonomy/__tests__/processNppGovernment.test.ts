import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { tier1DecisionTurnForCycle } from "../tier1DecisionSchedule";

const {
  atLeastMock,
  appointPresidentMock,
  conditionsMock,
  formCabinetMock,
  ministerialMock,
  caretakerMinistersMock,
  claimSlotMock,
  enabledForPlayersMock,
} = vi.hoisted(() => ({
  atLeastMock: vi.fn(),
  appointPresidentMock: vi.fn(),
  conditionsMock: vi.fn(),
  formCabinetMock: vi.fn(),
  ministerialMock: vi.fn(),
  caretakerMinistersMock: vi.fn(),
  claimSlotMock: vi.fn(),
  enabledForPlayersMock: vi.fn(),
}));
vi.mock("../featureFlag", () => ({
  nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a),
}));
vi.mock("../appointNppPresident", () => ({
  appointNppPresident: (...a: unknown[]) => appointPresidentMock(...a),
}));
vi.mock("../formNppCabinet", () => ({
  formNppCabinet: (...a: unknown[]) => formCabinetMock(...a),
}));
vi.mock("../ministerialGovernance", () => ({
  runMinisterialGovernance: (...a: unknown[]) => ministerialMock(...a),
  runCaretakerMinisters: (...a: unknown[]) => caretakerMinistersMock(...a),
}));
vi.mock("@/lib/turn/npp/billSponsorship", () => ({
  loadConditionsSignal: (...a: unknown[]) => conditionsMock(...a),
}));
vi.mock("../tier1DecisionClaim", () => ({
  claimTier1NppDecisionSlot: (...a: unknown[]) => claimSlotMock(...a),
}));
vi.mock("@/lib/countryAccess", () => ({
  isCountryEnabledForPlayers: (...a: unknown[]) => enabledForPlayersMock(...a),
}));

import { processNppGovernment, AGENDA_RECOMPUTE_INTERVAL_TURNS } from "../processNppGovernment";

let db: MockDb;
const now = new Date("2026-06-23T12:00:00Z");
const headId = new ObjectId();

function dueTurn(countryId: "BR" | "UK", cycle = 16): number {
  return tier1DecisionTurnForCycle(countryId, cycle);
}

function setup(opts: {
  gov: Record<string, unknown> | null;
  headNpp?: Record<string, unknown> | null;
  stateMetrics?: Record<string, unknown> | null;
  politicalBoard?: Record<string, number>;
}) {
  db = createMockDb();
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(opts.gov),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["npps"] = {
    ...db.collection("npps"),
    findOne: vi.fn().mockResolvedValue(opts.headNpp ?? null),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["stateMetrics"] = {
    ...db.collection("stateMetrics"),
    findOne: vi.fn().mockResolvedValue(opts.stateMetrics ?? null),
  } as MockDb["collectionMocks"][string];
  // Board countries take the political branch for domain health: ECONOMIC
  // domains from macroMetrics (SP5), POLITICAL ones from the board. BR is a
  // board country since the step-6 cutover, so a political-domain fixture has
  // to be expressed as a board rather than as legacy metrics.
  db.collectionMocks["macroMetrics"] = {
    ...db.collection("macroMetrics"),
    findOne: vi.fn().mockResolvedValue(opts.stateMetrics ?? null),
  } as MockDb["collectionMocks"][string];
  if (opts.politicalBoard) {
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([{ _id: "R1", countryId: "BR", values: opts.politicalBoard }]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "R1", countryId: "BR", population: 1 }]);
  }
}

/** A full 63-family board, uniform except for the named category overrides. */
function boardWith(base: number, categoryOverrides: Record<string, number> = {}) {
  const out: Record<string, number> = {};
  for (const f of POLITICAL_METRIC_FAMILIES) {
    out[f.id] = categoryOverrides[f.categoryId] ?? base;
  }
  return out;
}

const formedPresidentialGov = {
  _id: "BR",
  status: "formed",
  presidentNppId: headId,
  seatsByParty: {},
};
const headNpp = {
  _id: headId,
  name: "Top Pol",
  party: "5",
  policies: { economic: -4, social: 0 },
  personality: { ambition: 80, stubbornness: 20, loyalty: 50 },
  favorability: 70,
};

beforeEach(() => {
  atLeastMock.mockReset();
  appointPresidentMock.mockReset().mockResolvedValue(false);
  conditionsMock.mockReset().mockResolvedValue({ weakDomains: { healthcare: 0.8 } });
  formCabinetMock.mockReset().mockResolvedValue({ ran: true, filled: 0, filledPositionIds: [] });
  ministerialMock.mockReset().mockResolvedValue({ ran: true, tiersSet: 0, ordersIssued: 0 });
  caretakerMinistersMock
    .mockReset()
    .mockResolvedValue({ ran: false, tiersSet: 0, ordersIssued: 0, reshuffled: 0 });
  claimSlotMock.mockReset().mockImplementation((_db: unknown, countryId: string, turn: number) =>
    Promise.resolve({
      run: true,
      bucket: 0,
      cycle: Math.floor((turn - 1) / 6),
      completedCycle: Math.floor((turn - 1) / 6),
    })
  );
  enabledForPlayersMock.mockReset().mockResolvedValue(false);
});

describe("processNppGovernment", () => {
  it("no-ops when the v1 gate is not met", async () => {
    atLeastMock.mockResolvedValue(false);
    setup({ gov: formedPresidentialGov, headNpp });
    const res = await processNppGovernment(db as unknown as Db, "BR", dueTurn("BR"), now);
    expect(res.ran).toBe(false);
    expect(appointPresidentMock).not.toHaveBeenCalled();
    expect(claimSlotMock).not.toHaveBeenCalled();
  });

  it("skips strategic work when the six-hour slot is not due", async () => {
    atLeastMock.mockResolvedValue(true);
    claimSlotMock.mockResolvedValue({ run: false, bucket: 2, cycle: 1, reason: "not-due" });
    setup({ gov: formedPresidentialGov, headNpp });
    const res = await processNppGovernment(db as unknown as Db, "BR", dueTurn("BR") + 1, now);
    expect(res.ran).toBe(false);
    expect(res.skipReason).toBe("not-due");
    expect(appointPresidentMock).not.toHaveBeenCalled();
    expect(formCabinetMock).not.toHaveBeenCalled();
  });

  it("does not run NPP strategy for player-enabled countries (caretakers only)", async () => {
    atLeastMock.mockResolvedValue(true);
    enabledForPlayersMock.mockResolvedValue(true);
    caretakerMinistersMock.mockResolvedValue({
      ran: true,
      tiersSet: 0,
      ordersIssued: 1,
      reshuffled: 0,
    });
    setup({ gov: formedPresidentialGov, headNpp });
    const turn = dueTurn("BR");
    const res = await processNppGovernment(db as unknown as Db, "BR", turn, now);
    expect(res.ran).toBe(true);
    expect(res.skipReason).toBe("player-controlled");
    expect(res.ministerialOrdersIssued).toBe(1);
    expect(appointPresidentMock).not.toHaveBeenCalled();
    expect(formCabinetMock).not.toHaveBeenCalled();
    expect(ministerialMock).not.toHaveBeenCalled();
    expect(caretakerMinistersMock).toHaveBeenCalledWith(expect.anything(), "BR", turn, now);
  });

  it("runs presidential executive formation for a presidential country", async () => {
    atLeastMock.mockResolvedValue(true);
    appointPresidentMock.mockResolvedValue(true);
    setup({ gov: formedPresidentialGov, headNpp });
    const turn = dueTurn("BR");
    const res = await processNppGovernment(db as unknown as Db, "BR", turn, now);
    expect(res.ran).toBe(true);
    expect(res.seatedExecutive).toBe(true);
    expect(appointPresidentMock).toHaveBeenCalledWith(expect.anything(), "BR", turn, now);
  });

  it("does not run presidential formation for a parliamentary country", async () => {
    atLeastMock.mockResolvedValue(true);
    setup({ gov: { _id: "UK", status: "formed", pmNppId: headId }, headNpp });
    await processNppGovernment(db as unknown as Db, "UK", dueTurn("UK"), now);
    expect(appointPresidentMock).not.toHaveBeenCalled();
  });

  it("computes + persists a governing agenda for a formed NPP-headed government", async () => {
    atLeastMock.mockResolvedValue(true);
    setup({ gov: formedPresidentialGov, headNpp });
    const turn = dueTurn("BR");
    const res = await processNppGovernment(db as unknown as Db, "BR", turn, now);
    expect(res.agendaUpdated).toBe(true);
    const update = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    const agenda = update[1].$set.governingAgenda;
    expect(agenda.computedTurn).toBe(turn);
    expect(agenda.archetype).toBe("reformer");
    // Left-leaning head (economic -4) + weak healthcare → redistributive agenda.
    const domains = agenda.items.map((i: { domain: string }) => i.domain);
    expect(domains).toContain("healthcare");
  });

  it("skips recompute while the agenda is still fresh", async () => {
    atLeastMock.mockResolvedValue(true);
    const turn = dueTurn("BR");
    setup({
      gov: {
        ...formedPresidentialGov,
        governingAgenda: { items: [], archetype: "reformer", computedTurn: turn },
      },
      headNpp,
    });
    const res = await processNppGovernment(db as unknown as Db, "BR", turn, now);
    expect(res.agendaUpdated).toBe(false);
    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
  });

  it("recomputes when the agenda is stale", async () => {
    atLeastMock.mockResolvedValue(true);
    const baseTurn = dueTurn("BR", 2);
    setup({
      gov: {
        ...formedPresidentialGov,
        governingAgenda: { items: [], archetype: "reformer", computedTurn: baseTurn },
      },
      headNpp,
    });
    // Pick a later due turn far enough past the agenda recompute interval.
    const staleTurn = dueTurn("BR", 2 + Math.ceil(AGENDA_RECOMPUTE_INTERVAL_TURNS / 6) + 1);
    const res = await processNppGovernment(db as unknown as Db, "BR", staleTurn, now);
    expect(res.agendaUpdated).toBe(true);
  });

  it("grades the outgoing agenda and nudges governing-party favorability on recompute", async () => {
    atLeastMock.mockResolvedValue(true);
    const baseTurn = dueTurn("BR", 2);
    setup({
      gov: {
        ...formedPresidentialGov,
        governingPartyId: "5",
        // Outgoing agenda with a measurable goal the government badly missed.
        governingAgenda: {
          items: [{ domain: "healthcare", target: 65, direction: "raise", priority: 1 }],
          archetype: "reformer",
          computedTurn: baseTurn,
        },
      },
      headNpp,
      // healthcare is a POLITICAL domain, so it reads the board now: a health
      // category far below the agenda target → the grade is punished.
      politicalBoard: boardWith(60, { health: 10 }),
    });
    const staleTurn = dueTurn("BR", 2 + Math.ceil(AGENDA_RECOMPUTE_INTERVAL_TURNS / 6) + 1);
    await processNppGovernment(db as unknown as Db, "BR", staleTurn, now);

    const updateMany = db.collectionMocks["npps"].updateMany as ReturnType<typeof vi.fn>;
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toMatchObject({ countryId: "BR", party: "5" });
  });

  it("does not compute an agenda when the head of government is player-held", async () => {
    atLeastMock.mockResolvedValue(true);
    setup({ gov: { _id: "BR", status: "formed", presidentNppId: null, pmNppId: null }, headNpp });
    const res = await processNppGovernment(db as unknown as Db, "BR", dueTurn("BR"), now);
    expect(res.agendaUpdated).toBe(false);
  });

  it("does not compute an agenda for a pending (unformed) government", async () => {
    atLeastMock.mockResolvedValue(true);
    setup({ gov: { _id: "BR", status: "pending" }, headNpp });
    const res = await processNppGovernment(db as unknown as Db, "BR", dueTurn("BR"), now);
    expect(res.agendaUpdated).toBe(false);
  });

  it("runs cabinet formation and surfaces the count of filled posts", async () => {
    atLeastMock.mockResolvedValue(true);
    formCabinetMock.mockResolvedValue({ ran: true, filled: 3, filledPositionIds: ["a", "b", "c"] });
    setup({ gov: formedPresidentialGov, headNpp });
    const res = await processNppGovernment(db as unknown as Db, "BR", dueTurn("BR"), now);
    expect(formCabinetMock).toHaveBeenCalledWith(expect.anything(), "BR", now);
    expect(res.cabinetPostsFilled).toBe(3);
  });

  it("runs ministerial governance and surfaces the orders issued", async () => {
    atLeastMock.mockResolvedValue(true);
    ministerialMock.mockResolvedValue({ ran: true, tiersSet: 1, ordersIssued: 2 });
    setup({ gov: formedPresidentialGov, headNpp });
    const turn = dueTurn("BR");
    const res = await processNppGovernment(db as unknown as Db, "BR", turn, now);
    expect(ministerialMock).toHaveBeenCalledWith(expect.anything(), "BR", turn, now);
    expect(res.ministerialOrdersIssued).toBe(2);
  });
});
