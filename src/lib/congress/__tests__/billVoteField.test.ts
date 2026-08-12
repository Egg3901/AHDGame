import { describe, it, expect } from "vitest";
import { resolveBillVoteField } from "../billVoteField";
import type { Bill } from "@/lib/db/types/legislation";

const bill = (status: string) => ({ status }) as Pick<Bill, "status">;

describe("resolveBillVoteField", () => {
  // Every existing status must behave EXACTLY as it does today and ignore the voter, so
  // no current path can change behaviour when the call sites are swapped over.
  it("ignores the voter for every pre-existing status", () => {
    const ctx = { voterOfficeType: "senate", lowerOfficeType: "house" };
    expect(resolveBillVoteField(bill("active"), ctx)).toBe("votes");
    expect(resolveBillVoteField(bill("active_other"), ctx)).toBe("otherChamberVotes");
    expect(resolveBillVoteField(bill("veto_override"), ctx)).toBe("vetoOverrideVotes");
    expect(resolveBillVoteField(bill("override_shugiin"), ctx)).toBe("votes");
    expect(resolveBillVoteField(bill("cabinet_review"), ctx)).toBe("votes");
  });

  it("routes an active_both vote by the voter's chamber", () => {
    const ctx = (voterOfficeType: string) => ({ voterOfficeType, lowerOfficeType: "house" });
    expect(resolveBillVoteField(bill("active_both"), ctx("house"))).toBe("votes");
    expect(resolveBillVoteField(bill("active_both"), ctx("senate"))).toBe("otherChamberVotes");
  });

  it("falls back to the lower chamber's map when the voter is unknown", () => {
    // Display callers have no voter. Defaulting to `votes` matches what every
    // unconverted reader already assumes, so a missed call site degrades rather than
    // throwing.
    expect(resolveBillVoteField(bill("active_both"))).toBe("votes");
  });
});
