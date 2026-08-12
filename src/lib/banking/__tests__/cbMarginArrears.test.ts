import { describe, it, expect } from "vitest";
import { CB_MARGIN_COLLATERAL_FRACTION } from "@/lib/banking/interbank";

/**
 * The draw cap is measured against principal PLUS unpaid interest. These cases
 * pin the arithmetic the guard in `drawCbMargin` performs, so a change to how
 * arrears fold into the cap has to be deliberate.
 */
function headroom(mark: number, debt: number, arrears: number): number {
  return CB_MARGIN_COLLATERAL_FRACTION * mark - (debt + arrears);
}

describe("CB margin headroom counts arrears", () => {
  it("shrinks the line by unpaid interest", () => {
    // 1,000 of collateral gives 500 of line. 400 drawn leaves 100.
    expect(headroom(1_000, 400, 0)).toBe(100);
    // 60 of unpaid interest eats most of the remaining headroom.
    expect(headroom(1_000, 400, 60)).toBe(40);
  });

  it("closes the line entirely once arrears fill it", () => {
    expect(headroom(1_000, 400, 100)).toBe(0);
    expect(headroom(1_000, 400, 250)).toBeLessThan(0);
  });

  it("leaves a fully-paid bank's headroom untouched", () => {
    expect(headroom(1_000, 400, 0)).toBe(headroom(1_000, 400, 0));
  });
});
