import { describe, expect, it } from "vitest";
import { ro1992DecisionAvailability, passesRoElectoralAmendment } from "./electoralDecision1992";
describe("Romanian July1992 electoral decision", () => {
  it("opens a decision at its date and retains existing settlements", () => {
    expect(ro1992DecisionAvailability({ preset: "1991-default", calendarTurn: 72 }).available).toBe(
      false
    );
    expect(ro1992DecisionAvailability({ preset: "1991-default", calendarTurn: 73 }).available).toBe(
      true
    );
    expect(
      ro1992DecisionAvailability({ preset: "1991-default", calendarTurn: 1000, authorizedTurn: 73 })
        .reason
    ).toBe("already-authorized");
    expect(
      ro1992DecisionAvailability({ preset: "1991-default", calendarTurn: 1000, completedTurn: 96 })
        .reason
    ).toBe("existing-settlement");
    expect(ro1992DecisionAvailability({ preset: "1979-default", calendarTurn: 73 }).available).toBe(
      false
    );
  });
  it.each([
    [198, 396, false],
    [199, 396, true],
    [59, 119, false],
    [60, 119, true],
  ])("requires %i of full chamber capacity%i", (votes, seats, passes) => {
    expect(passesRoElectoralAmendment({ for: votes, against: 0, abstain: 0 }, seats)).toBe(passes);
  });
  it("rejects impossible or fractional cast totals", () => {
    expect(passesRoElectoralAmendment({ for: 397, against: 0, abstain: 0 }, 396)).toBe(false);
    expect(passesRoElectoralAmendment({ for: 199, against: 198, abstain: 0 }, 396)).toBe(false);
    expect(passesRoElectoralAmendment({ for: 199.5, against: 0, abstain: 0 }, 396)).toBe(false);
  });
});
