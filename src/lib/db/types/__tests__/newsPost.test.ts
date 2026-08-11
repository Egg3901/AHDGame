import { describe, it, expectTypeOf } from "vitest";
import type { NewsCategory } from "../newsPost";

describe("NewsCategory union", () => {
  it("includes the sovereign category for crisis-related system news", () => {
    expectTypeOf<NewsCategory>().toEqualTypeOf<
      "election" | "legislation" | "executive" | "general" | "sovereign" | "judicial"
    >();
  });
});
