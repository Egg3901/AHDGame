import { describe, it, expect } from "vitest";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { mergeApprovalModifiers } from "./mergeApprovalModifiers";

const metric = (id: string): ActiveModifier => ({
  id,
  label: id,
  effect: 1,
  source: "metric",
});

const war: ActiveModifier = {
  id: "war",
  label: "War",
  effect: -6,
  marginEffect: 0,
  source: "war",
};

describe("mergeApprovalModifiers", () => {
  it("uses the metrics endpoint for metric conditions when it has loaded", () => {
    const merged = mergeApprovalModifiers([metric("boom")], [metric("stale")]);
    expect(merged.map((m) => m.id)).toContain("boom");
    expect(merged.map((m) => m.id)).not.toContain("stale");
  });

  /**
   * The metrics endpoint recomputes metric conditions only. The national
   * providers — the address bump, org statements and the war block — are stored
   * by the turn snapshot and reach the page through the approval endpoint
   * alone. Preferring one source outright drops them, which would leave a
   * player watching approval fall with nothing on screen to explain it.
   */
  it("keeps national modifiers that only the approval endpoint carries", () => {
    const merged = mergeApprovalModifiers([metric("boom")], [metric("boom"), war]);
    expect(merged.map((m) => m.id)).toEqual(["boom", "war"]);
  });

  it("never lists the same modifier twice", () => {
    const merged = mergeApprovalModifiers([metric("boom")], [metric("boom")]);
    expect(merged).toHaveLength(1);
  });

  it("falls back to the approval endpoint before the metrics one has loaded", () => {
    expect(mergeApprovalModifiers(undefined, [metric("boom"), war]).map((m) => m.id)).toEqual([
      "boom",
      "war",
    ]);
  });

  it("returns nothing when neither endpoint has answered", () => {
    expect(mergeApprovalModifiers(undefined, undefined)).toEqual([]);
  });
});
