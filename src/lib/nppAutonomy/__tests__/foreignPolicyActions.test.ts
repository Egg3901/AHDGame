import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { NPP } from "@/lib/db/types";
import { createMockDb } from "@/lib/test-utils/mockDb";

const { proposeMock, upsertMock, imposeMock, liftMock, tradeBillMock, warMock } = vi.hoisted(
  () => ({
    proposeMock: vi.fn(),
    upsertMock: vi.fn(),
    imposeMock: vi.fn(),
    liftMock: vi.fn(),
    tradeBillMock: vi.fn(),
    warMock: vi.fn(),
  })
);

vi.mock("@/lib/internationalOrganizations/commands/proposeLegislation", () => ({
  proposeOrganizationLegislation: (...args: unknown[]) => proposeMock(...args),
}));
vi.mock("@/lib/internationalOrganizations/voteWrite", () => ({
  upsertPendingOrganizationVote: (...args: unknown[]) => upsertMock(...args),
}));
vi.mock("@/lib/trade/commands/embargoCommands", () => ({
  imposeEmbargo: (...args: unknown[]) => imposeMock(...args),
  liftEmbargo: (...args: unknown[]) => liftMock(...args),
}));
vi.mock("../proposeNppForeignPolicyBill", () => ({
  proposeNppForeignPolicyBill: (...args: unknown[]) => tradeBillMock(...args),
}));
vi.mock("../autonomousWarCommands", () => ({
  executeAutonomousWarChoice: (...args: unknown[]) => warMock(...args),
}));

import { executeForeignPolicyChoice } from "../foreignPolicyActions";

const now = new Date("2026-08-28T01:00:00.000Z");
const headId = new ObjectId();
const head = {
  _id: headId,
  name: "Autonomous Premier",
} as NPP;

beforeEach(() => {
  proposeMock.mockReset().mockResolvedValue({ ok: true, legislationId: "resolution-1" });
  upsertMock.mockReset().mockResolvedValue({ matchedCount: 1 });
  imposeMock.mockReset().mockResolvedValue({ ok: true, embargoId: new ObjectId() });
  liftMock.mockReset().mockResolvedValue({ ok: true, embargoId: new ObjectId() });
  tradeBillMock.mockReset().mockResolvedValue({ ok: true, billId: "bill-1" });
  warMock.mockReset().mockResolvedValue({ acted: true, note: "Queued an offensive." });
});

describe("executeForeignPolicyChoice", () => {
  it("casts the planner's yes or no ballot with the NPP head as actor", async () => {
    const db = createMockDb();
    const pendingId = new ObjectId();

    const result = await executeForeignPolicyChoice(
      db as unknown as Db,
      "FR",
      head,
      {
        type: "vote_org_no",
        score: 55,
        pendingItemId: pendingId.toString(),
        pendingKind: "membership",
        reasons: ["Opposed alignment."],
      },
      20,
      now
    );

    expect(result.acted).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith(
      db.collection("organizationMembershipProposals"),
      pendingId,
      expect.objectContaining({
        countryId: "FR",
        characterId: headId,
        characterName: head.name,
        vote: "no",
        castOnTurn: 20,
      })
    );
  });

  it("tables a free-trade agreement through the existing organization command", async () => {
    const db = createMockDb();

    const result = await executeForeignPolicyChoice(
      db as unknown as Db,
      "FR",
      head,
      {
        type: "propose_fta",
        score: 50,
        targetCountryId: "IT",
        organizationId: "EU",
        reasons: ["Friendly trade partner."],
      },
      21,
      now
    );

    expect(result.acted).toBe(true);
    expect(proposeMock).toHaveBeenCalledWith({
      db,
      countryId: "FR",
      orgId: "EU",
      actor: { characterId: headId, characterName: head.name },
      input: { type: "free_trade_agreement", parties: ["FR", "IT"] },
    });
    expect(db.collection("diplomaticActions").updateOne).toHaveBeenCalledWith(
      { countryId: "FR" },
      expect.objectContaining({ $set: expect.objectContaining({ turn: 21, remaining: 3 }) }),
      { upsert: true }
    );
  });

  it("refuses an organization proposal when its diplomatic budget is empty", async () => {
    const db = createMockDb();
    db.collection("diplomaticActions").findOne.mockResolvedValue({
      countryId: "FR",
      turn: 21,
      remaining: 0,
    });

    const result = await executeForeignPolicyChoice(
      db as unknown as Db,
      "FR",
      head,
      {
        type: "propose_fta",
        score: 50,
        targetCountryId: "IT",
        organizationId: "EU",
        reasons: ["Friendly trade partner."],
      },
      21,
      now
    );

    expect(result).toEqual({ acted: false, note: "No diplomatic actions remain this turn." });
    expect(proposeMock).not.toHaveBeenCalled();
  });

  it("routes war entry through an alliance vote rather than joining directly", async () => {
    const db = createMockDb();

    const result = await executeForeignPolicyChoice(
      db as unknown as Db,
      "FR",
      head,
      {
        type: "join_war",
        score: 44,
        targetCountryId: "US",
        organizationId: "NATO",
        conflictId: "korea",
        conflictSide: "A",
        reasons: ["Alliance alignment."],
      },
      22,
      now
    );

    expect(result.acted).toBe(true);
    expect(proposeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "FR",
        orgId: "NATO",
        input: { type: "join_conflict", theaterId: "korea", side: "A" },
      })
    );
  });

  it("supports an allied war effort with a material aid proposal", async () => {
    const db = createMockDb();

    const result = await executeForeignPolicyChoice(
      db as unknown as Db,
      "FR",
      head,
      {
        type: "support_war",
        score: 48,
        targetCountryId: "US",
        organizationId: "NATO",
        conflictId: "korea",
        reasons: ["Alliance alignment."],
      },
      22,
      now
    );

    expect(result.acted).toBe(true);
    expect(proposeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "FR",
        orgId: "NATO",
        input: {
          type: "aid_package",
          recipientCountryId: "US",
          amount: 5_000_000,
          description: "Material support for the allied war effort in korea.",
        },
      })
    );
  });

  it("routes ongoing war operations through the autonomous military adapter", async () => {
    const db = createMockDb();
    const choice = {
      type: "conduct_war" as const,
      score: 48,
      conflictId: "korea",
      reasons: ["Ready forces are deployed."],
    };

    const result = await executeForeignPolicyChoice(
      db as unknown as Db,
      "FR",
      head,
      choice,
      22,
      now
    );

    expect(result).toEqual({ acted: true, note: "Queued an offensive." });
    expect(warMock).toHaveBeenCalledWith(db, "FR", head, choice, 22);
  });

  it("imposes a bounded temporary embargo through the trade command", async () => {
    const db = createMockDb();

    const result = await executeForeignPolicyChoice(
      db as unknown as Db,
      "FR",
      head,
      {
        type: "impose_embargo",
        score: 60,
        targetCountryId: "RU",
        reasons: ["Hostile belligerent."],
      },
      23,
      now
    );

    expect(result.acted).toBe(true);
    expect(imposeMock).toHaveBeenCalledWith(db, {
      sourceCountry: "FR",
      targetCountry: "RU",
      commodity: "all",
      direction: "both",
      mode: "block",
      durationTurns: 96,
      currentTurn: 23,
      createdBy: headId,
    });
  });

  it("routes tariff intent into the country's domestic legislature", async () => {
    const db = createMockDb();

    const result = await executeForeignPolicyChoice(
      db as unknown as Db,
      "FR",
      head,
      {
        type: "raise_tariff",
        score: 45,
        targetCountryId: "RU",
        reasons: ["Hostile trade policy."],
      },
      24,
      now
    );

    expect(result).toEqual({ acted: true, note: "Introduced national trade bill bill-1." });
    expect(tradeBillMock).toHaveBeenCalledWith(db, "FR", head, "raise_tariff", "RU", 24, now);
    expect(proposeMock).not.toHaveBeenCalled();
    expect(imposeMock).not.toHaveBeenCalled();
  });
});
