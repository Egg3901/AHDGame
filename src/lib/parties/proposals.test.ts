import { beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, assertSetFields, type MockCollection } from "@/lib/test-utils/mockDb";
import {
  applyElectionDurationEffect,
  applyPositionShiftEffect,
  applyCampaignerAppointmentEffect,
  applyRemoveOfficeHolderEffect,
  applyTransactionApprovalModeEffect,
  checkResolution,
  clampPosition,
  isPositionShiftLocked,
  isProposalTypeLocked,
  processMergeProposal,
  setProposalCooldown,
} from "./proposals";
import type { PoliticalParty } from "@/lib/db/types";
import { POSITION_SHIFT_COOLDOWN_TURNS, PROPOSAL_COOLDOWN_TURNS } from "./proposalConstants";
import type { CommitteeProposal } from "@/lib/db/types/committeeProposal";
import * as gameTimeModule from "@/lib/time/gameTime";

vi.mock("@/lib/time/gameTime", async () => {
  const actual = await vi.importActual<typeof gameTimeModule>("@/lib/time/gameTime");
  return {
    ...actual,
    getGameTime: vi.fn(),
  };
});

vi.mock("@/lib/coalitions/absorbParty", () => ({
  absorbPartyIntoCoalitions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  updateParliamentaryGovernmentSeats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/governors/senateVacancy", () => ({
  notifyGovernorOfSenateVacancy: vi.fn().mockResolvedValue(undefined),
}));

function mockGameTime(currentTurn: number, effectiveNow: Date) {
  vi.mocked(gameTimeModule.getGameTime).mockResolvedValue({
    currentTurn,
    lastTurnProcessed: effectiveNow,
    isActive: true,
    pausedAt: null,
    effectiveNow,
    startingYear: 2019,
  });
}

// Resolution rule per the 2026-05-22 amendments-via-CommitteeProposal
// redesign: PASS requires yes >= ceil(0.6 * committeeSize). REJECT early
// when remaining undecided voters can't lift yes to the threshold. On
// `expired: true`, abstainers count as nay → final verdict on yes-count.
describe("checkResolution (60% threshold, abstain = nay at expiry)", () => {
  describe("standard 9-voter committee (full leadership + 6 committee)", () => {
    // 9 × 0.6 = 5.4 → ceil → 6 yes needed.
    it("passes once 6 yes votes are in", () => {
      expect(checkResolution(6, 0, 9)).toBe("passed");
    });

    it("stays open with 5 yes (not enough yet, 4 abstainers could swing)", () => {
      expect(checkResolution(5, 0, 9)).toBe("open");
    });

    it("rejects early when no votes lock out the threshold", () => {
      // 4 no → only 5 remaining slots → max possible yes = 5 < 6.
      expect(checkResolution(0, 4, 9)).toBe("rejected");
    });

    it("stays open at the boundary", () => {
      // 3 no → 6 remaining could all vote yes → still reachable.
      expect(checkResolution(0, 3, 9)).toBe("open");
    });
  });

  describe("small committee sizes", () => {
    // Chair only — committeeSize = 1, yesNeeded = ceil(0.6) = 1.
    it("single voter yes → passed", () => {
      expect(checkResolution(1, 0, 1)).toBe("passed");
    });

    // 3 leadership only — yesNeeded = ceil(1.8) = 2.
    it("3-voter committee passes at 2 yes", () => {
      expect(checkResolution(2, 0, 3)).toBe("passed");
    });

    it("3-voter committee rejects early at 2 no", () => {
      // 2 no → 1 remaining → max yes = 1 < 2 → rejected.
      expect(checkResolution(0, 2, 3)).toBe("rejected");
    });
  });

  describe("expiry: abstain = nay", () => {
    it("at expiry, 5 yes / 0 no / 4 abstain in a 9-voter committee → rejected", () => {
      // Threshold is 6 yes. Abstain → nay → final yes = 5 < 6.
      expect(checkResolution(5, 0, 9, { expired: true })).toBe("rejected");
    });

    it("at expiry, 6 yes / 0 no / 3 abstain in a 9-voter committee → passed", () => {
      expect(checkResolution(6, 0, 9, { expired: true })).toBe("passed");
    });

    it("at expiry, all abstain (0/0) in a 9-voter committee → rejected", () => {
      expect(checkResolution(0, 0, 9, { expired: true })).toBe("rejected");
    });
  });

  describe("edge cases", () => {
    it("zero-voter committee rejects (no one eligible)", () => {
      expect(checkResolution(0, 0, 0)).toBe("rejected");
    });

    it("zero votes on a populated committee stays open during voting", () => {
      expect(checkResolution(0, 0, 9)).toBe("open");
    });

    it("4 yes + 5 no in a 9-voter committee rejects (can't reach 6)", () => {
      expect(checkResolution(4, 5, 9)).toBe("rejected");
    });
  });
});

describe("clampPosition", () => {
  it("allows shift within range", () => {
    expect(clampPosition(3, 1)).toBe(4);
    expect(clampPosition(-3, -1)).toBe(-4);
  });

  it("clamps at +5", () => {
    expect(clampPosition(5, 1)).toBe(5);
  });

  it("clamps at -5", () => {
    expect(clampPosition(-5, -1)).toBe(-5);
  });

  it("shifts from 0", () => {
    expect(clampPosition(0, 1)).toBe(1);
    expect(clampPosition(0, -1)).toBe(-1);
  });
});

// Election row shape used by the applyElectionDurationEffect tests below.
// Kept narrow — only the fields the helper reads + writes are required.
interface ElectionRow {
  _id: ObjectId;
  partyId: string;
  countryId: string;
  startTurn: number;
  endTurn: number;
  startTime: Date;
  endTime: Date;
  durationTurns: number;
  status: "voting" | "completed" | "cancelled";
}

// Captures DB writes so we can assert what gets written without standing up
// a real Mongo. Supports `politicalParties.findOne/updateOne` plus
// `find/bulkWrite` on the two election collections.
function makeDbStub(opts: {
  party?: Record<string, unknown> | null;
  officerElections?: ElectionRow[];
  committeeElections?: ElectionRow[];
}) {
  const updates: Array<{ collection: string; filter: unknown; update: unknown }> = [];
  const bulkOps: Record<string, Array<{ filter: unknown; update: unknown }>> = {
    nationalPartyElections: [],
    nationalCommitteeElections: [],
  };
  const officerRows = opts.officerElections ?? [];
  const committeeRows = opts.committeeElections ?? [];

  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "politicalParties") {
      return {
        findOne: vi.fn().mockResolvedValue(opts.party ?? null),
        updateOne: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
          updates.push({ collection: name, filter, update });
          return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
        }),
      };
    }
    if (name === "nationalPartyElections" || name === "nationalCommitteeElections") {
      const rows = name === "nationalPartyElections" ? officerRows : committeeRows;
      return {
        find: vi.fn().mockImplementation((filter: Record<string, unknown>) => ({
          toArray: () =>
            Promise.resolve(
              rows.filter(
                (r) =>
                  (filter.partyId === undefined || r.partyId === filter.partyId) &&
                  (filter.countryId === undefined || r.countryId === filter.countryId) &&
                  (filter.status === undefined || r.status === filter.status)
              )
            ),
        })),
        bulkWrite: vi
          .fn()
          .mockImplementation((ops: Array<{ updateOne: { filter: unknown; update: unknown } }>) => {
            for (const op of ops) bulkOps[name].push(op.updateOne);
            return Promise.resolve({ modifiedCount: ops.length });
          }),
      };
    }
    return {};
  });
  return { db: { collection } as unknown as Db, updates, bulkOps };
}

function makePartyId(): ObjectId {
  return new ObjectId();
}

describe("applyPositionShiftEffect (4-axis support)", () => {
  it("writes economicPosition when axis = economic", async () => {
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({
      party: { _id: partyId, economicPosition: 2, socialPosition: 0 },
    });
    await applyPositionShiftEffect(db, {
      type: "positionShift",
      partyId,
      positionShift: { axis: "economic", direction: 1 },
    } as unknown as CommitteeProposal);
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(setOp.economicPosition).toBe(3);
  });

  it("writes socialPosition when axis = social", async () => {
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({
      party: { _id: partyId, economicPosition: 0, socialPosition: -3 },
    });
    await applyPositionShiftEffect(db, {
      type: "positionShift",
      partyId,
      positionShift: { axis: "social", direction: -1 },
    } as unknown as CommitteeProposal);
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(setOp.socialPosition).toBe(-4);
  });

  it("no-ops on a retired axis instead of throwing (ticket #1032)", async () => {
    // `foreignPolicy` / `culture` can no longer be proposed, but a proposal
    // created before they were retired could still be sitting open. Applying
    // it must not throw — that would wedge proposal resolution for the party.
    for (const axis of ["foreignPolicy", "culture"] as const) {
      const partyId = makePartyId();
      const { db, updates } = makeDbStub({ party: { _id: partyId } });
      await expect(
        applyPositionShiftEffect(db, {
          type: "positionShift",
          partyId,
          positionShift: { axis, direction: 1 },
        } as unknown as CommitteeProposal)
      ).resolves.toBeUndefined();
      expect(updates).toHaveLength(0);
    }
  });

  it("recovers from a party row stuck at NaN (legacy bug pre-2026-05-22 redesign)", async () => {
    // Pre-redesign applyPositionShiftEffect could persist NaN when the
    // field was absent: clampPosition(undefined, 1) = NaN. Subsequent
    // proposals re-read NaN → NaN + direction = NaN → still NaN. The
    // proposal "passed" but the position never moved. Number.isFinite
    // guard recovers the party by treating non-finite as 0.
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({
      party: { _id: partyId, economicPosition: Number.NaN },
    });
    await applyPositionShiftEffect(db, {
      type: "positionShift",
      partyId,
      positionShift: { axis: "economic", direction: 1 },
    } as unknown as CommitteeProposal);
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    // NaN treated as neutral 0 → 0 + 1 = 1.
    expect(setOp.economicPosition).toBe(1);
  });

  it("clamps at ±5", async () => {
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({
      party: { _id: partyId, economicPosition: 5 },
    });
    await applyPositionShiftEffect(db, {
      type: "positionShift",
      partyId,
      positionShift: { axis: "economic", direction: 1 },
    } as unknown as CommitteeProposal);
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(setOp.economicPosition).toBe(5);
  });
});

describe("setProposalCooldown", () => {
  it("locks the affected axis for POSITION_SHIFT_COOLDOWN_TURNS on positionShift pass", async () => {
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({});
    await setProposalCooldown(
      db,
      {
        type: "positionShift",
        partyId,
        positionShift: { axis: "social", direction: 1 },
      } as unknown as CommitteeProposal,
      100
    );
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(setOp["positionShiftCooldowns.social.lockedUntilTurn"]).toBe(
      100 + POSITION_SHIFT_COOLDOWN_TURNS
    );
    // Doesn't touch other axes.
    expect(setOp["positionShiftCooldowns.economic.lockedUntilTurn"]).toBeUndefined();
  });

  it("locks the type cooldown for PROPOSAL_COOLDOWN_TURNS on non-positionShift pass", async () => {
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({});
    await setProposalCooldown(
      db,
      {
        type: "rename",
        partyId,
        rename: { newName: "X", newAbbreviation: "X" },
      } as unknown as CommitteeProposal,
      200
    );
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(setOp["proposalCooldowns.rename.lockedUntilTurn"]).toBe(200 + PROPOSAL_COOLDOWN_TURNS);
  });

  it("locks all proposal-cooldown types independently", async () => {
    const types = [
      "rename",
      "merge",
      "electionMethod",
      "electionDuration",
      "removeOfficeHolder",
      "transactionApprovalMode",
    ] as const;
    for (const type of types) {
      const { db, updates } = makeDbStub({});
      await setProposalCooldown(
        db,
        { type, partyId: makePartyId() } as unknown as CommitteeProposal,
        50
      );
      const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
      expect(setOp[`proposalCooldowns.${type}.lockedUntilTurn`]).toBe(50 + PROPOSAL_COOLDOWN_TURNS);
    }
  });
});

describe("isPositionShiftLocked", () => {
  it("returns false when the cooldown map is absent", () => {
    expect(
      isPositionShiftLocked({} as Pick<PoliticalParty, "positionShiftCooldowns">, "economic", 100)
    ).toBe(false);
  });

  it("returns false when the axis entry is absent", () => {
    expect(
      isPositionShiftLocked(
        { positionShiftCooldowns: { social: { lockedUntilTurn: 999 } } },
        "economic",
        100
      )
    ).toBe(false);
  });

  it("returns true when lockedUntilTurn > currentTurn", () => {
    expect(
      isPositionShiftLocked(
        { positionShiftCooldowns: { economic: { lockedUntilTurn: 500 } } },
        "economic",
        100
      )
    ).toBe(true);
  });

  it("returns false when lockedUntilTurn == currentTurn (lock has expired)", () => {
    expect(
      isPositionShiftLocked(
        { positionShiftCooldowns: { economic: { lockedUntilTurn: 100 } } },
        "economic",
        100
      )
    ).toBe(false);
  });

  it("locks each axis independently", () => {
    const party = {
      positionShiftCooldowns: {
        economic: { lockedUntilTurn: 500 },
        // social absent → unlocked
      },
    };
    expect(isPositionShiftLocked(party, "economic", 100)).toBe(true);
    expect(isPositionShiftLocked(party, "social", 100)).toBe(false);
  });
});

describe("isProposalTypeLocked", () => {
  it("returns false when the cooldown map is absent", () => {
    expect(
      isProposalTypeLocked({} as Pick<PoliticalParty, "proposalCooldowns">, "rename", 100)
    ).toBe(false);
  });

  it("returns true when lockedUntilTurn > currentTurn", () => {
    expect(
      isProposalTypeLocked(
        { proposalCooldowns: { rename: { lockedUntilTurn: 500 } } },
        "rename",
        100
      )
    ).toBe(true);
  });

  it("locks the four types independently", () => {
    const party = { proposalCooldowns: { rename: { lockedUntilTurn: 500 } } };
    expect(isProposalTypeLocked(party, "rename", 100)).toBe(true);
    expect(isProposalTypeLocked(party, "merge", 100)).toBe(false);
    expect(isProposalTypeLocked(party, "electionMethod", 100)).toBe(false);
    expect(isProposalTypeLocked(party, "electionDuration", 100)).toBe(false);
    expect(isProposalTypeLocked(party, "removeOfficeHolder", 100)).toBe(false);
  });
});

describe("applyRemoveOfficeHolderEffect", () => {
  it("clears chairId when role=chair and target matches the seated chair", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeDbStub({});
    await applyRemoveOfficeHolderEffect(db, {
      type: "removeOfficeHolder",
      partyId,
      removeOfficeHolder: { role: "chair", targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    const filter = updates[0]!.filter as { _id: ObjectId; chairId: ObjectId };
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(filter.chairId).toBe(targetId);
    expect(setOp.chairId).toBeNull();
  });

  it("clears viceChairId when role=viceChair and target matches", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeDbStub({});
    await applyRemoveOfficeHolderEffect(db, {
      type: "removeOfficeHolder",
      partyId,
      removeOfficeHolder: { role: "viceChair", targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    const filter = updates[0]!.filter as { _id: ObjectId; viceChairId: ObjectId };
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(filter.viceChairId).toBe(targetId);
    expect(setOp.viceChairId).toBeNull();
  });

  it("clears treasurerId when role=treasurer and target matches (tickets #1100/#285)", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeDbStub({});
    await applyRemoveOfficeHolderEffect(db, {
      type: "removeOfficeHolder",
      partyId,
      removeOfficeHolder: { role: "treasurer", targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    const filter = updates[0]!.filter as { _id: ObjectId; treasurerId: ObjectId };
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(filter.treasurerId).toBe(targetId);
    expect(setOp.treasurerId).toBeNull();
  });

  it("pulls from committeeIds array when role=committeeMember", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeDbStub({});
    await applyRemoveOfficeHolderEffect(db, {
      type: "removeOfficeHolder",
      partyId,
      removeOfficeHolder: { role: "committeeMember", targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    const filter = updates[0]!.filter as { _id: ObjectId; committeeIds: ObjectId };
    const update = updates[0]!.update as { $pull: Record<string, unknown>; $set: object };
    expect(filter.committeeIds).toBe(targetId);
    expect(update.$pull.committeeIds).toBe(targetId);
  });

  it("filter includes the target so it's a no-op when target has been replaced", async () => {
    // The filter requires the chairId === targetCharacterId. If the
    // chair is now someone else, updateOne matches nothing and the
    // wrong person isn't cleared.
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeDbStub({});
    await applyRemoveOfficeHolderEffect(db, {
      type: "removeOfficeHolder",
      partyId,
      removeOfficeHolder: { role: "chair", targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    const filter = updates[0]!.filter as { chairId: ObjectId };
    // The filter pins the chair to the target — Mongo will not match
    // a party whose chairId is different.
    expect(filter.chairId.equals(targetId)).toBe(true);
  });

  it("pulls from campaignerIds array when role=campaigner", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeDbStub({});
    await applyRemoveOfficeHolderEffect(db, {
      type: "removeOfficeHolder",
      partyId,
      removeOfficeHolder: { role: "campaigner", targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    const filter = updates[0]!.filter as { _id: ObjectId; campaignerIds: ObjectId };
    const update = updates[0]!.update as { $pull: Record<string, unknown>; $set: object };
    expect(filter.campaignerIds).toBe(targetId);
    expect(update.$pull.campaignerIds).toBe(targetId);
  });

  it("throws when proposal is not a removeOfficeHolder", async () => {
    const { db } = makeDbStub({});
    await expect(
      applyRemoveOfficeHolderEffect(db, {
        type: "rename",
        partyId: makePartyId(),
      } as unknown as CommitteeProposal)
    ).rejects.toThrow(/Not a removeOfficeHolder/);
  });
});

describe("applyTransactionApprovalModeEffect", () => {
  it("writes transactionApprovalMode: 'single' when proposal mode = 'single'", async () => {
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({});
    await applyTransactionApprovalModeEffect(db, {
      type: "transactionApprovalMode",
      partyId,
      transactionApprovalMode: { mode: "single" },
    } as unknown as CommitteeProposal);
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(setOp.transactionApprovalMode).toBe("single");
  });

  it("writes 'double' when proposal mode = 'double'", async () => {
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({});
    await applyTransactionApprovalModeEffect(db, {
      type: "transactionApprovalMode",
      partyId,
      transactionApprovalMode: { mode: "double" },
    } as unknown as CommitteeProposal);
    const setOp = (updates[0]!.update as { $set: Record<string, unknown> }).$set;
    expect(setOp.transactionApprovalMode).toBe("double");
  });

  it("throws when the proposal isn't a transactionApprovalMode", async () => {
    const { db } = makeDbStub({});
    await expect(
      applyTransactionApprovalModeEffect(db, {
        type: "rename",
        partyId: makePartyId(),
      } as unknown as CommitteeProposal)
    ).rejects.toThrow(/Not a transactionApprovalMode/);
  });
});

describe("applyElectionDurationEffect (retroactive in-flight extension)", () => {
  const T0 = new Date("2026-05-26T00:00:00.000Z");
  const turnHours = (n: number) => new Date(T0.getTime() + n * 60 * 60 * 1000);

  function makeOfficerRow(overrides: Partial<ElectionRow> = {}): ElectionRow {
    return {
      _id: new ObjectId(),
      partyId: "1",
      countryId: "US",
      startTurn: 100,
      endTurn: 196,
      startTime: T0,
      endTime: turnHours(96),
      durationTurns: 96,
      status: "voting",
      ...overrides,
    };
  }

  function makeCommitteeRow(overrides: Partial<ElectionRow> = {}): ElectionRow {
    return {
      _id: new ObjectId(),
      partyId: "1",
      countryId: "US",
      startTurn: 100,
      endTurn: 268,
      startTime: T0,
      endTime: turnHours(168),
      durationTurns: 168,
      status: "voting",
      ...overrides,
    };
  }

  it("writes customElectionDurationTurns on the party doc (existing behavior preserved)", async () => {
    mockGameTime(120, turnHours(20));
    const partyId = makePartyId();
    const { db, updates } = makeDbStub({
      party: { _id: partyId, sequentialId: 1, countryId: "US" },
    });
    await applyElectionDurationEffect(db, {
      type: "electionDuration",
      partyId,
      electionDuration: { durationTurns: 420 },
    } as unknown as CommitteeProposal);
    const partyUpdate = updates.find((u) => u.collection === "politicalParties");
    const setOp = (partyUpdate!.update as { $set: Record<string, unknown> }).$set;
    expect(setOp.customElectionDurationTurns).toBe(420);
  });

  it("extends an in-flight officer election's endTurn and endTime", async () => {
    mockGameTime(120, turnHours(20));
    const partyId = makePartyId();
    const officer = makeOfficerRow();
    const { db, bulkOps } = makeDbStub({
      party: { _id: partyId, sequentialId: 1, countryId: "US" },
      officerElections: [officer],
    });
    await applyElectionDurationEffect(db, {
      type: "electionDuration",
      partyId,
      electionDuration: { durationTurns: 420 },
    } as unknown as CommitteeProposal);
    expect(bulkOps.nationalPartyElections).toHaveLength(1);
    const setOp = (bulkOps.nationalPartyElections[0].update as { $set: Record<string, unknown> })
      .$set;
    // startTurn = 100, new duration = 420 → new endTurn = 520
    expect(setOp.endTurn).toBe(520);
    expect((setOp.endTime as Date).getTime()).toBe(turnHours(420).getTime());
    expect(setOp.durationTurns).toBe(420);
  });

  it("extends an in-flight committee election the same way", async () => {
    mockGameTime(120, turnHours(20));
    const partyId = makePartyId();
    const committee = makeCommitteeRow();
    const { db, bulkOps } = makeDbStub({
      party: { _id: partyId, sequentialId: 1, countryId: "US" },
      committeeElections: [committee],
    });
    await applyElectionDurationEffect(db, {
      type: "electionDuration",
      partyId,
      electionDuration: { durationTurns: 420 },
    } as unknown as CommitteeProposal);
    expect(bulkOps.nationalCommitteeElections).toHaveLength(1);
    const setOp = (
      bulkOps.nationalCommitteeElections[0].update as {
        $set: Record<string, unknown>;
      }
    ).$set;
    expect(setOp.endTurn).toBe(520);
    expect(setOp.durationTurns).toBe(420);
  });

  it("skips a row when the shortened duration would close the election immediately (currentTurn >= new endTurn)", async () => {
    // Officer election started at turn 100, currentTurn = 250. Shrinking the
    // duration to 100 would set newEndTurn = 200, in the past — must skip.
    mockGameTime(250, turnHours(150));
    const partyId = makePartyId();
    const officer = makeOfficerRow({ startTurn: 100, endTurn: 196, durationTurns: 96 });
    const { db, bulkOps } = makeDbStub({
      party: { _id: partyId, sequentialId: 1, countryId: "US" },
      officerElections: [officer],
    });
    await applyElectionDurationEffect(db, {
      type: "electionDuration",
      partyId,
      electionDuration: { durationTurns: 100 },
    } as unknown as CommitteeProposal);
    expect(bulkOps.nationalPartyElections).toHaveLength(0);
  });

  it("ignores completed and cancelled elections (find filter excludes them)", async () => {
    mockGameTime(120, turnHours(20));
    const partyId = makePartyId();
    const completed = makeOfficerRow({ status: "completed" });
    const cancelled = makeOfficerRow({ status: "cancelled" });
    const { db, bulkOps } = makeDbStub({
      party: { _id: partyId, sequentialId: 1, countryId: "US" },
      officerElections: [completed, cancelled],
    });
    await applyElectionDurationEffect(db, {
      type: "electionDuration",
      partyId,
      electionDuration: { durationTurns: 420 },
    } as unknown as CommitteeProposal);
    expect(bulkOps.nationalPartyElections).toHaveLength(0);
  });

  it("throws when the proposal isn't an electionDuration", async () => {
    const { db } = makeDbStub({});
    await expect(
      applyElectionDurationEffect(db, {
        type: "rename",
        partyId: makePartyId(),
      } as unknown as CommitteeProposal)
    ).rejects.toThrow(/Not an electionDuration/);
  });
});

describe("processMergeProposal (transfer semantics — seats + coalition)", () => {
  const proposingId = new ObjectId();
  const targetId = new ObjectId();
  const targetChairId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setup(opts: {
    govDoc?: Record<string, unknown> | null;
    orgRows?: Array<{ stateId: string; organization: number; registration?: number }>;
  }) {
    const db = createMockDb();
    const parties = db.collection("politicalParties") as unknown as MockCollection;
    db.collectionMocks.politicalParties = parties;

    if (opts.orgRows) {
      const statePartyOrg = db.collection("statePartyOrg") as unknown as MockCollection;
      db.collectionMocks.statePartyOrg = statePartyOrg;
      statePartyOrg.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(opts.orgRows),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });
    }
    parties.findOne.mockImplementation((filter: { _id: ObjectId }) => {
      if (filter._id?.equals?.(proposingId)) {
        return Promise.resolve({
          _id: proposingId,
          sequentialId: 1,
          countryId: "IE",
          treasury: 0,
          chairId: null,
          viceChairId: null,
        });
      }
      if (filter._id?.equals?.(targetId)) {
        return Promise.resolve({
          _id: targetId,
          sequentialId: 3,
          countryId: "IE",
          isDefunct: false,
          chairId: targetChairId,
          viceChairId: null,
        });
      }
      return Promise.resolve(null);
    });

    const gov = db.collection("governmentFormations") as unknown as MockCollection;
    db.collectionMocks.governmentFormations = gov;
    gov.findOne.mockResolvedValue(opts.govDoc ?? null);

    return db;
  }

  const proposal = {
    _id: new ObjectId(),
    type: "merge",
    partyId: proposingId,
    countryId: "IE",
    merge: { targetPartyId: targetId },
  } as unknown as CommitteeProposal;

  it("re-points the absorbed party's elected officials to the target (country-scoped)", async () => {
    const db = setup({ govDoc: null });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    const eo = db.collectionMocks.electedOfficials!.updateMany.mock.calls[0];
    expect(eo).toBeTruthy();
    expect(eo![0]).toEqual({ party: "1", countryId: "IE" });
    expect((eo![1] as { $set: { party: string } }).$set.party).toBe("3");
  });

  it("stamps partyJoinedTurn = currentTurn on absorbed members (tenure clock resets on merge)", async () => {
    const db = setup({ govDoc: null });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    const call = db.collectionMocks.characters!.updateMany.mock.calls[0];
    expect(call).toBeTruthy();
    expect(call![0]).toEqual({ party: "1", countryId: "IE" });
    const pipeline = call![1] as Array<{ $set: Record<string, unknown> }>;
    expect(pipeline[0].$set.party).toBe("3");
    expect(pipeline[0].$set.partyJoinedTurn).toBe(120);
  });

  it("collapses the absorbed party out of its coalitions", async () => {
    const db = setup({ govDoc: null });
    const { absorbPartyIntoCoalitions } = await import("@/lib/coalitions/absorbParty");
    await processMergeProposal(db as unknown as Db, proposal, 120);

    expect(absorbPartyIntoCoalitions).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(absorbPartyIntoCoalitions).mock.calls[0]![1];
    expect(arg.countryId).toBe("IE");
    expect(arg.proposingParty.sequentialId).toBe(1);
    expect(arg.targetParty.sequentialId).toBe(3);
  });

  it("rebuilds the parliamentary seat snapshot when a government formation exists", async () => {
    const db = setup({ govDoc: { _id: "IE", governingPartyId: "2", coalitionPartyIds: null } });
    const { updateParliamentaryGovernmentSeats } =
      await import("@/lib/turn/parliamentaryGovernment");
    await processMergeProposal(db as unknown as Db, proposal, 120);

    expect(updateParliamentaryGovernmentSeats).toHaveBeenCalledWith(db, "IE");
  });

  it("skips the seat-snapshot rebuild when the country has no government formation", async () => {
    const db = setup({ govDoc: null });
    const { updateParliamentaryGovernmentSeats } =
      await import("@/lib/turn/parliamentaryGovernment");
    await processMergeProposal(db as unknown as Db, proposal, 120);

    expect(updateParliamentaryGovernmentSeats).not.toHaveBeenCalled();
  });

  it("re-points governing party / coalition references that named the absorbed party", async () => {
    const db = setup({
      govDoc: { _id: "IE", governingPartyId: "1", coalitionPartyIds: ["1", "6"] },
    });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    assertSetFields(db.collectionMocks.governmentFormations!.updateOne, {
      governingPartyId: "3",
      coalitionPartyIds: ["3", "6"],
    });
  });

  it("deletes the absorbed party's statePartyOrg rows (org remainder wiped)", async () => {
    const db = setup({
      govDoc: null,
      orgRows: [
        { stateId: "DUB", organization: 10, registration: 20 },
        { stateId: "COR", organization: 6, registration: 23 },
      ],
    });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    const del = db.collectionMocks.statePartyOrg!.deleteMany.mock.calls[0];
    expect(del).toBeTruthy();
    expect(del![0]).toEqual({ partyId: "1", countryId: "IE" });
  });

  it("releases the absorbed party's registration into each state's unregistered pool", async () => {
    const db = setup({
      govDoc: null,
      orgRows: [
        { stateId: "DUB", organization: 10, registration: 20 },
        { stateId: "COR", organization: 6, registration: 23 },
      ],
    });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    const calls = db.collectionMocks.stateRegistrationPool!.updateOne.mock.calls;
    const dub = calls.find((c) => (c[0] as { _id: string })._id === "IE_DUB");
    const cor = calls.find((c) => (c[0] as { _id: string })._id === "IE_COR");
    expect((dub![1] as { $inc: { unregistered: number } }).$inc.unregistered).toBe(20);
    expect((cor![1] as { $inc: { unregistered: number } }).$inc.unregistered).toBe(23);
  });

  it("does not release registration for rows with no registration value", async () => {
    const db = setup({
      govDoc: null,
      orgRows: [{ stateId: "DUB", organization: 10 }],
    });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    // No registration value → the reg pool collection is never touched.
    expect(db.collectionMocks.stateRegistrationPool).toBeUndefined();
  });
});

describe("processMergeProposal (NPP recruitment-cap enforcement)", () => {
  const proposingId = new ObjectId();
  const targetId = new ObjectId();

  function makeCursor(data: unknown[]) {
    return {
      toArray: vi.fn().mockResolvedValue(data),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    };
  }

  function setup(opts: {
    proposingActiveNpps: Array<Record<string, unknown>>;
    targetActiveNpps?: Array<Record<string, unknown>>;
    targetOrgRows?: Array<{ stateId: string; organization: number }>;
  }) {
    const db = createMockDb();

    const parties = db.collection("politicalParties") as unknown as MockCollection;
    db.collectionMocks.politicalParties = parties;
    parties.findOne.mockImplementation((filter: { _id: ObjectId }) => {
      if (filter._id?.equals?.(proposingId)) {
        return Promise.resolve({
          _id: proposingId,
          sequentialId: 1,
          countryId: "IE",
          treasury: 0,
          chairId: null,
          viceChairId: null,
        });
      }
      if (filter._id?.equals?.(targetId)) {
        return Promise.resolve({
          _id: targetId,
          sequentialId: 3,
          countryId: "IE",
          isDefunct: false,
          chairId: null,
          viceChairId: null,
        });
      }
      return Promise.resolve(null);
    });

    const npps = db.collection("npps") as unknown as MockCollection;
    db.collectionMocks.npps = npps;
    npps.find.mockImplementation((filter: { party?: string }) => {
      if (filter.party === "1") return makeCursor(opts.proposingActiveNpps);
      if (filter.party === "3") return makeCursor(opts.targetActiveNpps ?? []);
      return makeCursor([]);
    });

    const statePartyOrg = db.collection("statePartyOrg") as unknown as MockCollection;
    db.collectionMocks.statePartyOrg = statePartyOrg;
    statePartyOrg.find.mockImplementation((filter: { partyId?: string }) => {
      if (filter.partyId === "3") return makeCursor(opts.targetOrgRows ?? []);
      return makeCursor([]); // proposing org rows (step 4) — empty for these tests
    });

    const gov = db.collection("governmentFormations") as unknown as MockCollection;
    db.collectionMocks.governmentFormations = gov;
    gov.findOne.mockResolvedValue(null);

    return db;
  }

  const proposal = {
    _id: new ObjectId(),
    type: "merge",
    partyId: proposingId,
    countryId: "IE",
    merge: { targetPartyId: targetId },
  } as unknown as CommitteeProposal;

  it("hard-deletes incoming NPPs that exceed the surviving party's per-state cap", async () => {
    // DUB post-merge org 0 → 2 slots; target has none → 2 remaining. Three
    // incoming NPPs → the weakest (influence 5) is culled.
    const strong = {
      _id: new ObjectId(),
      homeState: "DUB",
      politicalInfluence: 30,
      favorability: 60,
    };
    const mid = { _id: new ObjectId(), homeState: "DUB", politicalInfluence: 20, favorability: 60 };
    const weak = { _id: new ObjectId(), homeState: "DUB", politicalInfluence: 5, favorability: 60 };

    const db = setup({ proposingActiveNpps: [strong, mid, weak] });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    const del = db.collectionMocks.npps!.deleteMany.mock.calls.find(
      (c) => (c[0] as { _id?: { $in?: ObjectId[] } })._id?.$in
    );
    expect(del).toBeTruthy();
    const deletedIds = (del![0] as { _id: { $in: ObjectId[] } })._id.$in.map((i) => i.toString());
    expect(deletedIds).toEqual([weak._id.toString()]);

    // Candidacy / seat references for the culled NPP are cleaned up too.
    const candDel = db.collectionMocks.electionCandidates!.deleteMany.mock.calls[0];
    expect(
      (candDel![0] as { nppId: { $in: ObjectId[] } }).nppId.$in.map((i) => i.toString())
    ).toEqual([weak._id.toString()]);
  });

  it("re-points the survivors (kept + retired NPPs) to the target, excluding culls", async () => {
    const strong = {
      _id: new ObjectId(),
      homeState: "DUB",
      politicalInfluence: 30,
      favorability: 60,
    };
    const mid = { _id: new ObjectId(), homeState: "DUB", politicalInfluence: 20, favorability: 60 };
    const weak = { _id: new ObjectId(), homeState: "DUB", politicalInfluence: 5, favorability: 60 };

    const db = setup({ proposingActiveNpps: [strong, mid, weak] });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    const repoint = db.collectionMocks.npps!.updateMany.mock.calls.find(
      (c) => (c[1] as { $set?: { party?: string } }).$set?.party === "3"
    );
    expect(repoint).toBeTruthy();
    const filter = repoint![0] as { party: string; countryId: string; _id: { $nin: ObjectId[] } };
    expect(filter.party).toBe("1");
    expect(filter.countryId).toBe("IE");
    expect(filter._id.$nin.map((i) => i.toString())).toEqual([weak._id.toString()]);
  });

  it("keeps every incoming NPP when all fit under the cap (no deletes)", async () => {
    const a = { _id: new ObjectId(), homeState: "DUB", politicalInfluence: 30, favorability: 60 };
    const b = { _id: new ObjectId(), homeState: "DUB", politicalInfluence: 20, favorability: 60 };

    const db = setup({ proposingActiveNpps: [a, b] });
    await processMergeProposal(db as unknown as Db, proposal, 120);

    const del = db.collectionMocks.npps!.deleteMany.mock.calls.find(
      (c) => (c[0] as { _id?: { $in?: ObjectId[] } })._id?.$in
    );
    expect(del).toBeFalsy();
  });
});

describe("applyCampaignerAppointmentEffect", () => {
  const PARTY_SEQ = 7;

  function makeAppointmentDb(opts: {
    party?: Record<string, unknown> | null;
    character?: Record<string, unknown> | null;
  }) {
    const updates: Array<{ filter: unknown; update: unknown }> = [];
    const collection = vi.fn().mockImplementation((name: string) => {
      if (name === "politicalParties") {
        return {
          findOne: vi.fn().mockResolvedValue(opts.party ?? null),
          updateOne: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
            updates.push({ filter, update });
            return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
          }),
        };
      }
      if (name === "characters") {
        return { findOne: vi.fn().mockResolvedValue(opts.character ?? null) };
      }
      return {};
    });
    return { db: { collection } as unknown as Db, updates };
  }

  const seatedParty = (campaignerIds: ObjectId[], partyId: ObjectId) => ({
    _id: partyId,
    sequentialId: PARTY_SEQ,
    countryId: "US",
    campaignerIds,
  });

  it("adds the confirmed nominee to campaignerIds", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeAppointmentDb({
      party: seatedParty([], partyId),
      character: { _id: targetId, party: String(PARTY_SEQ), countryId: "US" },
    });
    await applyCampaignerAppointmentEffect(db, {
      type: "campaignerAppointment",
      partyId,
      campaignerAppointment: { targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    expect(updates).toHaveLength(1);
    const update = updates[0]!.update as { $addToSet: Record<string, unknown> };
    expect(update.$addToSet.campaignerIds).toBe(targetId);
  });

  it("no-ops when the nominee left the party while the vote was open", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeAppointmentDb({
      party: seatedParty([], partyId),
      character: { _id: targetId, party: "99", countryId: "US" },
    });
    await applyCampaignerAppointmentEffect(db, {
      type: "campaignerAppointment",
      partyId,
      campaignerAppointment: { targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    expect(updates).toHaveLength(0);
  });

  it("no-ops when the roster filled up before the vote resolved", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeAppointmentDb({
      party: seatedParty([new ObjectId(), new ObjectId(), new ObjectId()], partyId),
      character: { _id: targetId, party: String(PARTY_SEQ), countryId: "US" },
    });
    await applyCampaignerAppointmentEffect(db, {
      type: "campaignerAppointment",
      partyId,
      campaignerAppointment: { targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    expect(updates).toHaveLength(0);
  });

  it("no-ops when the nominee is already seated", async () => {
    const partyId = makePartyId();
    const targetId = new ObjectId();
    const { db, updates } = makeAppointmentDb({
      party: seatedParty([targetId], partyId),
      character: { _id: targetId, party: String(PARTY_SEQ), countryId: "US" },
    });
    await applyCampaignerAppointmentEffect(db, {
      type: "campaignerAppointment",
      partyId,
      campaignerAppointment: { targetCharacterId: targetId },
    } as unknown as CommitteeProposal);
    expect(updates).toHaveLength(0);
  });

  it("throws when the proposal isn't a campaignerAppointment", async () => {
    const { db } = makeAppointmentDb({});
    await expect(
      applyCampaignerAppointmentEffect(db, {
        type: "rename",
        partyId: makePartyId(),
      } as unknown as CommitteeProposal)
    ).rejects.toThrow(/Not a campaignerAppointment/);
  });
});

describe("setProposalCooldown — campaignerAppointment", () => {
  it("sets no cooldown so the chair can re-nominate immediately", async () => {
    const { db, updates } = makeDbStub({});
    await setProposalCooldown(
      db,
      { type: "campaignerAppointment", partyId: makePartyId() } as unknown as CommitteeProposal,
      50
    );
    expect(updates).toHaveLength(0);
  });
});
