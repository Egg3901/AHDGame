import { describe, expect, it } from "vitest";
import { russianPresidentialVoteIncrement as allocate } from "./presidentialVoteIncrement";
const input = {
  registeredVoters: 100,
  priorVotes: {},
  rawVotes: { a: 40, b: 40 },
  campaignStrength: {},
};
describe("Russian bounded direct participation and campaign strength", () => {
  it("keeps equal campaigns neutral", () => {
    expect(allocate(input)).toEqual({ a: 40, b: 40 });
  });
  it("makes paid campaign strength change shares without creating voters", () => {
    const votes = allocate({ ...input, campaignStrength: { a: 50000 } });
    expect(votes.a).toBeGreaterThan(votes.b);
    expect(votes.a + votes.b).toBe(80);
  });
  it("caps an approval-boosted closing turn at the remaining electorate", () => {
    const votes = allocate({
      ...input,
      priorVotes: { a: 35, b: 55 },
      campaignStrength: { b: 50000 },
    });
    expect(votes.a + votes.b).toBe(10);
    expect(votes.b).toBeGreaterThan(votes.a);
  });
  it("counts withdrawn candidates' already cast votes against the register", () => {
    const votes = allocate({ ...input, priorVotes: { withdrawn: 99 } });
    expect(votes.a + votes.b).toBe(1);
  });
  it("never adds votes to a full register", () => {
    expect(allocate({ ...input, priorVotes: { a: 100 } })).toEqual({ a: 0, b: 0 });
  });
  it.each([NaN, -1, Infinity])("rejects invalid weights %s", (weight) => {
    expect(() => allocate({ ...input, rawVotes: { a: weight } })).toThrow();
  });
  it("preserves exact pool totals at the safe integer limit", () => {
    const count = Number.MAX_SAFE_INTEGER;
    const votes = allocate({
      registeredVoters: count,
      priorVotes: {},
      rawVotes: { a: count - 2, b: 2 },
      campaignStrength: { b: 50000 },
    });
    expect(votes.a + votes.b).toBe(count);
  });
  it("rejects a corrupt historical count instead of hiding it", () => {
    expect(() => allocate({ ...input, priorVotes: { a: 101 } })).toThrow();
  });
});
