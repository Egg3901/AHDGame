import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { formalizedSubsidiaryCountByParentId } from "./helpers";

const parent = new ObjectId();
const sub = (formalized: boolean, shares = 100): Corporation =>
  ({
    _id: new ObjectId(),
    totalShares: 100,
    shareholders: [{ corporationId: parent, shares }],
    ...(formalized ? { subsidiaryFormalizedAtTurn: 1 } : {}),
  }) as unknown as Corporation;

describe("formalizedSubsidiaryCountByParentId", () => {
  it("counts only formalized, controlled subsidiaries", () => {
    const counts = formalizedSubsidiaryCountByParentId([
      sub(true),
      sub(true),
      sub(false),
      sub(true, 40),
    ]);
    expect(counts.get(parent.toString())).toBe(2);
  });
});
