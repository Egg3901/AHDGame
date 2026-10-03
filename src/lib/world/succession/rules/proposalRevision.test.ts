import { describe, expect, it } from "vitest";
import { proposalRevisionConflict } from "./proposalRevision";

describe("federation mandate revision gates", () => {
  it("allows first opening, active retry and a new vote after rejection", () => {
    const input = { settlementId: "cs", revision: 1 };
    expect(proposalRevisionConflict(input)).toBeNull();
    expect(proposalRevisionConflict({ ...input, latest: { ...input, status: "open" } })).toBeNull();
    expect(
      proposalRevisionConflict({ ...input, revision: 2, latest: { ...input, status: "rejected" } })
    ).toBeNull();
    expect(
      proposalRevisionConflict({ ...input, revision: 2, latest: { ...input, status: "withdrawn" } })
    ).toBeNull();
  });
  it("does not overwrite live votes, skip revisions, reuse rejection or change identity", () => {
    const latest = { settlementId: "cs", revision: 1, status: "open" };
    expect(proposalRevisionConflict({ settlementId: "cs", revision: 2, latest })).toBeTruthy();
    expect(
      proposalRevisionConflict({
        settlementId: "cs",
        revision: 3,
        latest: { ...latest, status: "rejected" },
      })
    ).toBeTruthy();
    expect(
      proposalRevisionConflict({
        settlementId: "cs",
        revision: 1,
        latest: { ...latest, status: "rejected" },
      })
    ).toBeTruthy();
    expect(
      proposalRevisionConflict({
        settlementId: "other",
        revision: 2,
        latest: { ...latest, status: "rejected" },
      })
    ).toBeTruthy();
    expect(proposalRevisionConflict({ settlementId: "cs", revision: 2 })).toBeTruthy();
  });
});
