import { describe, expect, it } from "vitest";
import {
  summarizeForeignPolicyLedger,
  type ForeignPolicyLedgerDecision,
} from "../foreignPolicyLedger";

function decision(overrides: Partial<ForeignPolicyLedgerDecision>): ForeignPolicyLedgerDecision {
  return {
    countryId: "FR",
    turn: 10,
    selected: null,
    acted: false,
    executionStatus: "no_action",
    executionNote: "No permitted choice cleared the action threshold.",
    ...overrides,
  };
}

describe("summarizeForeignPolicyLedger", () => {
  it("reports action mix, targets, vetoes, war entries, and no-action reasons", () => {
    const summary = summarizeForeignPolicyLedger([
      decision({
        selected: { type: "vote_org_no", score: 60, targetCountryId: "RU", reasons: [] },
        acted: true,
        executionStatus: "executed",
        executionNote: "Cast an organization no vote.",
      }),
      decision({
        countryId: "IT",
        selected: { type: "join_war", score: 70, targetCountryId: "RU", reasons: [] },
        acted: true,
        executionStatus: "executed",
        executionNote: "Tabled organization legislation 123.",
      }),
      decision({ countryId: "ES" }),
    ]);

    expect(summary.totals).toEqual({
      decisions: 3,
      acted: 2,
      rejected: 0,
      noAction: 1,
      pendingClaims: 0,
      vetoes: 1,
      warEntries: 1,
    });
    expect(summary.targets[0]).toEqual({ key: "RU", count: 2 });
    expect(summary.actionMix).toEqual(
      expect.arrayContaining([
        { key: "join_war", count: 1 },
        { key: "vote_org_no", count: 1 },
      ])
    );
    expect(summary.noActionReasons[0]).toMatchObject({ count: 1 });
  });
});
