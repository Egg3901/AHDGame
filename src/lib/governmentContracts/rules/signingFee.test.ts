import { describe, it, expect } from "vitest";
import { signingFeeCredit } from "./signingFee";
describe("tender signing fee currency rules", () => {
  it.each([
    [200, 1, 1],
    [30000, 150, 0.8],
    [13.27, 0.8, 150],
  ])(
    "preserves anchor value for %s native units at rates %s and %s",
    (debit, source, destination) => {
      const quote = signingFeeCredit(debit, source, destination)!;
      expect(quote.destinationLocal / destination).toBeCloseTo(debit / source, 10);
    }
  );
  it("rejects invalid valuations before moving money", () => {
    expect(signingFeeCredit(100, 0, 1)).toBeNull();
    expect(signingFeeCredit(100, 1, NaN)).toBeNull();
    expect(signingFeeCredit(-1, 1, 1)).toBeNull();
  });
});
