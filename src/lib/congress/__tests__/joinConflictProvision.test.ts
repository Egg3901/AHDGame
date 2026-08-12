import { describe, it, expect } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { isPolicyProvision, type BillProvision } from "@/lib/db/types/legislation";
import { validateBillProvisions } from "@/lib/congress/billProposal";

describe("join_conflict provision", () => {
  it("is NOT a policy provision", () => {
    // isPolicyProvision is TRUE BY DEFAULT. Two consumers: billEnactment writes an
    // unhandled provision into a policy record with legislationTypeId undefined, and
    // nationalBillActions feeds it to applyBillVotePolicyShift — which would shift
    // every voting legislator's own policy positions.
    expect(isPolicyProvision({ type: "join_conflict" } as BillProvision)).toBe(false);
  });

  it("is REFUSED when hand-rolled through the ordinary bill route", async () => {
    // Privilege escalation: a validated bucket lets any seated legislator carry war
    // entry at simple majority, bypassing the foreign-minister gate, the membership
    // check and the bloc vote entirely.
    const db = createMockDb();
    const res = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "join_conflict", theaterId: "t1", side: "A" }],
      "foreign policy",
      "US"
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/bloc/i);
  });

  it("still refuses a hand-rolled declaration of war", async () => {
    const db = createMockDb();
    const res = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "declare_war", targetCountry: "RU" }],
      "foreign policy",
      "US"
    );

    expect(res.ok).toBe(false);
  });
});
