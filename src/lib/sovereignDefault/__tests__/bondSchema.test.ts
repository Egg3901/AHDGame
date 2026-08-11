import { describe, it, expectTypeOf } from "vitest";
import type { Bond } from "@/lib/db/types/bond";

describe("Bond sovereign-default schema additions", () => {
  it("has restructureHaircutPercent field", () => {
    expectTypeOf<NonNullable<Bond["restructureHaircutPercent"]>>().toEqualTypeOf<number>();
  });

  it("has restructureExtendedMaturityTurn field", () => {
    expectTypeOf<NonNullable<Bond["restructureExtendedMaturityTurn"]>>().toEqualTypeOf<number>();
  });

  it("has originalMaturityTurn audit field", () => {
    expectTypeOf<NonNullable<Bond["originalMaturityTurn"]>>().toEqualTypeOf<number>();
  });

  it("has originalTotalIssued audit field", () => {
    expectTypeOf<NonNullable<Bond["originalTotalIssued"]>>().toEqualTypeOf<number>();
  });
});
