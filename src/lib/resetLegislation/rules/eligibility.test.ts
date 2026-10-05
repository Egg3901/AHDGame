import { describe, expect, it } from "vitest";
import { resetLawFamilyById } from "../catalog";
import { lawChoiceEligibility } from "./eligibility";

describe("reset law choice eligibility", () => {
  it("allows authored national and state public-health options to coexist", () => {
    const law = resetLawFamilyById("L19")!;
    expect(lawChoiceEligibility(law, "US", "national", "center_left", "center").allowed).toBe(true);
    expect(lawChoiceEligibility(law, "US", "regional", "center_right", "center").allowed).toBe(
      true
    );
  });

  it("offers leave-to-states only as an eligible US national position", () => {
    const eligible = resetLawFamilyById("L18")!;
    expect(
      lawChoiceEligibility(eligible, "US", "national", "leave_to_states", "center").allowed
    ).toBe(true);
    expect(
      lawChoiceEligibility(eligible, "UK", "national", "leave_to_states", "center").reason
    ).toBe("leave_to_states_unavailable");
    expect(
      lawChoiceEligibility(eligible, "US", "regional", "leave_to_states", "center").reason
    ).toBe("leave_to_states_unavailable");
    const ineligible = resetLawFamilyById("L01")!;
    expect(
      lawChoiceEligibility(ineligible, "US", "national", "leave_to_states", "center").reason
    ).toBe("leave_to_states_unavailable");
  });

  it("rejects no-change and unavailable regional choices", () => {
    const law = resetLawFamilyById("L07")!;
    expect(lawChoiceEligibility(law, "US", "national", "center", "center").reason).toBe(
      "unchanged"
    );
    expect(lawChoiceEligibility(law, "US", "regional", "center", null).reason).toBe(
      "country_unavailable"
    );
  });

  it("uses separately authored regional clinical-capacity options", () => {
    const law = resetLawFamilyById("L18")!;
    for (const country of ["UK", "JP"] as const) {
      expect(lawChoiceEligibility(law, country, "regional", "center", null).allowed).toBe(true);
    }
  });

  it("fails closed when an unrecognized national choice reaches the rules core", () => {
    const law = resetLawFamilyById("L19")!;
    expect(lawChoiceEligibility(law, "US", "national", "invalid" as never, null)).toEqual({
      allowed: false,
      reason: "unknown_choice",
    });
  });
});
