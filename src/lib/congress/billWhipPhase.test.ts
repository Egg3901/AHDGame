import { describe, expect, it } from "vitest";
import { isBillWhipInCurrentPhase } from "./billWhipPhase";

describe("isBillWhipInCurrentPhase", () => {
  const overrideStartedAt = new Date("2026-09-29T12:00:00.000Z");

  it("rejects passage whips created before a veto override opened", () => {
    expect(
      isBillWhipInCurrentPhase(
        { status: "veto_override", overrideVotingStartedAt: overrideStartedAt },
        { createdAt: new Date("2026-09-29T11:59:59.999Z") }
      )
    ).toBe(false);
  });

  it("accepts whips created during the veto override", () => {
    expect(
      isBillWhipInCurrentPhase(
        { status: "veto_override", overrideVotingStartedAt: overrideStartedAt },
        { createdAt: overrideStartedAt }
      )
    ).toBe(true);
  });

  it("preserves existing behavior outside a timestamped veto override", () => {
    expect(
      isBillWhipInCurrentPhase(
        { status: "active", overrideVotingStartedAt: undefined },
        { createdAt: new Date("2020-01-01T00:00:00.000Z") }
      )
    ).toBe(true);
    expect(
      isBillWhipInCurrentPhase(
        { status: "veto_override", overrideVotingStartedAt: undefined },
        { createdAt: new Date("2020-01-01T00:00:00.000Z") }
      )
    ).toBe(true);
  });
});
