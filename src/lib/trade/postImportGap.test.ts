import { describe, expect, it } from "vitest";
import { importCoverage, postImportBalance, stateImportsShare } from "./postImportGap";

describe("postImportBalance", () => {
  it("clears a production gap that imports fully cover", () => {
    const r = postImportBalance(25, 100, 75);
    expect(r.balance).toBe(0);
    expect(r.remainingShortfall).toBe(0);
    expect(r.coveredByImports).toBe(true);
  });

  it("keeps only the part of the gap imports did not close", () => {
    const r = postImportBalance(25, 100, 50);
    expect(r.remainingShortfall).toBe(25);
    expect(r.coveredByImports).toBe(false);
  });

  it("reports surplus when imports exceed the gap", () => {
    expect(postImportBalance(25, 100, 90).balance).toBe(15);
  });

  it("is unchanged without imports and ignores bad import values", () => {
    expect(postImportBalance(25, 100, 0).remainingShortfall).toBe(75);
    expect(postImportBalance(25, 100, undefined).remainingShortfall).toBe(75);
    expect(postImportBalance(25, 100, Number.NaN).remainingShortfall).toBe(75);
    expect(postImportBalance(25, 100, -10).remainingShortfall).toBe(75);
  });

  it("does not flag coverage for a market that never had a gap", () => {
    expect(postImportBalance(100, 80, 0).coveredByImports).toBe(false);
  });
});

describe("importCoverage and stateImportsShare", () => {
  it("covers the national deficit share and caps at 1", () => {
    expect(importCoverage(25, 100, 75)).toBe(1);
    expect(importCoverage(25, 100, 150)).toBe(1);
    expect(importCoverage(25, 100, 37.5)).toBe(0.5);
  });

  it("has no coverage without a deficit", () => {
    expect(importCoverage(100, 80, 10)).toBe(0);
  });

  it("attributes imports only to a state in deficit", () => {
    expect(stateImportsShare(10, 50, 0.5)).toBe(20);
    expect(stateImportsShare(60, 50, 1)).toBe(0);
    expect(stateImportsShare(10, 50, 2)).toBe(40);
  });
});
