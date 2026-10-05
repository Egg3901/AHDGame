import { describe, expect, it } from "vitest";
import { openingFiscalBooks1991 } from "./opening1991";

describe("v2 1991 opening books against current seed signatures", () => {
  it("reconciles US, UK and JP without silently freeing period pension or grant money", () => {
    const books = openingFiscalBooks1991();
    expect(books.US).toMatchObject({
      revenue: 939_213_600_000,
      operating: 752_823_998_100,
      grants: 64_962_000_000,
      annualBalance: -88_485_398_100,
    });
    expect(books.UK).toMatchObject({
      revenue: 229_306_050_000,
      operating: 220_156_575_000,
      grants: 16_399_000_000,
      annualBalance: -11_325_525_000,
    });
    expect(books.UK.corrections).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "uk_state_pensions_continuity" })])
    );
    expect(books.JP).toMatchObject({
      revenue: 123_996_000_000_000,
      operating: 110_864_060_000_000,
      grants: 15_872_000_000_000,
      annualBalance: 3_445_940_000_000,
    });
  });
});
