import { describe, expect, it } from "vitest";
import { decideAutonomousFederationConsent } from "./autonomousConsent";

describe("background federation consent", () => {
  it("approves a bounded liability and explains the fiscal limit", () => {
    expect(
      decideAutonomousFederationConsent({
        stability: 0.7,
        fiscalCapacity: 0.5,
        assetShareBps: 2000,
        debtShareBps: 3000,
      })
    ).toMatchObject({ choice: "approve", reason: expect.stringContaining("fiscal risk limit") });
  });

  it("rejects excessive debt exposure or critically weak stability", () => {
    expect(
      decideAutonomousFederationConsent({
        stability: 0.5,
        fiscalCapacity: 0.2,
        assetShareBps: 1000,
        debtShareBps: 5000,
      }).choice
    ).toBe("reject");
    expect(
      decideAutonomousFederationConsent({
        stability: 0.1,
        fiscalCapacity: 0.8,
        assetShareBps: 4000,
        debtShareBps: 4000,
      }).reason
    ).toContain("stability");
  });

  it("rejects out-of-range economic data", () => {
    expect(() =>
      decideAutonomousFederationConsent({
        stability: Number.NaN,
        fiscalCapacity: 0.5,
        assetShareBps: 1000,
        debtShareBps: 1000,
      })
    ).toThrow("bounded");
  });
});
