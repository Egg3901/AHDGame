import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Bill } from "@/lib/db/types/legislation";
import type { CoalitionPriority } from "@/lib/db/types/coalition";
import {
  calculateCoalitionCohesion,
  normalizeCoalitionPriorities,
  shouldActivatePriority,
  shouldRejectPriority,
} from "./priorities";

function buildPriority(overrides: Partial<CoalitionPriority> = {}): CoalitionPriority {
  const now = new Date("2026-04-29T12:00:00.000Z");
  return {
    id: new ObjectId().toString(),
    type: "policy_theme",
    visibility: "public",
    status: "proposed",
    stance: "support",
    title: "Economic Growth",
    description: "Make growth the coalition's top-line goal.",
    policyThemeKey: "economic_growth",
    billId: null,
    billTitle: null,
    leadershipGoalKey: null,
    targetName: null,
    expiresAt: null,
    votes: [],
    createdBy: new ObjectId(),
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe("coalition priority helpers", () => {
  it("activates and rejects proposals based on party-majority support", () => {
    const partyA = new ObjectId();
    const partyB = new ObjectId();
    const chairA = new ObjectId();
    const chairB = new ObjectId();

    const supported = buildPriority({
      votes: [
        { partyId: partyA, chairCharacterId: chairA, vote: "support", votedAt: new Date() },
        { partyId: partyB, chairCharacterId: chairB, vote: "support", votedAt: new Date() },
      ],
    });
    const rejected = buildPriority({
      votes: [
        { partyId: partyA, chairCharacterId: chairA, vote: "oppose", votedAt: new Date() },
        { partyId: partyB, chairCharacterId: chairB, vote: "oppose", votedAt: new Date() },
      ],
    });

    expect(shouldActivatePriority(supported, 3)).toBe(true);
    expect(shouldRejectPriority(rejected, 3)).toBe(true);
  });

  it("expires bill and leadership priorities when their live targets end", () => {
    const billId = new ObjectId();
    const now = new Date("2026-04-29T12:00:00.000Z");
    const coalition = {
      priorities: [
        buildPriority({
          type: "bill",
          status: "active",
          billId,
          billTitle: "Housing Reform Act",
        }),
        buildPriority({
          type: "leadership_goal",
          status: "active",
          leadershipGoalKey: "speaker",
          expiresAt: new Date("2026-04-29T11:00:00.000Z"),
        }),
      ],
    };
    const resolvedBill = {
      _id: billId,
      status: "signed",
    } as Bill;

    const result = normalizeCoalitionPriorities(
      coalition,
      new Map([[billId.toString(), resolvedBill]]),
      now
    );

    expect(result.changed).toBe(true);
    expect(result.priorities.every((priority) => priority.status === "expired")).toBe(true);
  });

  it("computes coalition cohesion from active support and dissent", () => {
    const partyA = new ObjectId();
    const partyB = new ObjectId();
    const chairA = new ObjectId();
    const chairB = new ObjectId();
    const summary = calculateCoalitionCohesion(
      [
        buildPriority({
          status: "active",
          votes: [
            { partyId: partyA, chairCharacterId: chairA, vote: "support", votedAt: new Date() },
            { partyId: partyB, chairCharacterId: chairB, vote: "support", votedAt: new Date() },
          ],
        }),
        buildPriority({
          status: "active",
          votes: [
            { partyId: partyA, chairCharacterId: chairA, vote: "support", votedAt: new Date() },
            { partyId: partyB, chairCharacterId: chairB, vote: "oppose", votedAt: new Date() },
          ],
        }),
      ],
      2
    );

    expect(summary.label).toBe("Strong");
    expect(summary.score).toBeGreaterThanOrEqual(70);
    expect(summary.supportVotes).toBe(3);
    expect(summary.opposeVotes).toBe(1);
  });
});
