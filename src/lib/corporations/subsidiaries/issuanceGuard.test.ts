import { describe, it, expect } from "vitest";
import { subsidiaryIssuanceBlockReason } from "./issuanceGuard";

describe("subsidiaryIssuanceBlockReason", () => {
  it("allows issuance for a non-subsidiary corp (no marker)", async () => {
    expect(
      await subsidiaryIssuanceBlockReason({}, { subsidiaryCorporationsEnabled: true })
    ).toBeNull();
  });

  it("allows issuance when the feature flag is off, even if formalized", async () => {
    expect(
      await subsidiaryIssuanceBlockReason(
        { subsidiaryFormalizedAtTurn: 100 },
        { subsidiaryCorporationsEnabled: false }
      )
    ).toBeNull();
  });

  it("blocks issuance for a formalized subsidiary when the feature is on", async () => {
    const reason = await subsidiaryIssuanceBlockReason(
      { subsidiaryFormalizedAtTurn: 100 },
      { subsidiaryCorporationsEnabled: true }
    );
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/formalized subsidiary/i);
  });
});
