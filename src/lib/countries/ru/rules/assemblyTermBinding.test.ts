import { describe, expect, it } from "vitest";
import {
  validateRussianAssemblyRepeatTerm as validate,
  type RussianAssemblyTermProof,
} from "./assemblyTermBinding";
const proof: RussianAssemblyTermProof = {
  id: "duma:council",
  countryId: "RU",
  preset: "1991-default",
  dumaRootId: "duma",
  councilRootId: "council",
  seatedOnTurn: 145,
  dumaTermEndTurn: 237,
  councilTermEndTurn: 235,
};
const input = {
  turn: 150,
  chamber: "duma" as const,
  assemblySinceTurn: 145,
  dumaRootId: "duma",
  councilRootId: "council",
  proof,
  previousSeatedOnTurn: 145,
  previousSeatingProven: true,
};
describe("First Assembly repeat term binding", () => {
  it("preserves pre-handover repeat polls without requiring a seated Council root", () => {
    expect(validate({ turn: 142, chamber: "duma", dumaRootId: "duma" })).toEqual({
      stage: "pending",
      termEndTurn: undefined,
    });
  });
  it("allows proven post-handover failed polls inside their original chamber clocks", () => {
    expect(validate({ ...input, electionEndTurn: 162 })).toEqual({
      stage: "seated",
      termEndTurn: 237,
    });
    expect(validate({ ...input, chamber: "council" })).toEqual({
      stage: "seated",
      termEndTurn: 235,
    });
  });
  it("allows another certified but not yet seated generation in an active term", () => {
    expect(
      validate({ ...input, previousSeatedOnTurn: undefined, previousSeatingProven: false }).stage
    ).toBe("seated");
  });
  it.each([
    "missing-proof",
    "wrong-root",
    "wrong-marker",
    "wrong-preset",
    "unproven-predecessor",
    "future-seating",
    "expired-term",
    "poll-after-term",
    "poll-at-term",
    "unsafe-clock",
  ])("rejects %s", (defect) => {
    const changed = { ...input, proof: { ...proof }, electionEndTurn: 162 };
    if (defect === "missing-proof") delete (changed as { proof?: RussianAssemblyTermProof }).proof;
    if (defect === "wrong-root") changed.proof.dumaRootId = "other";
    if (defect === "wrong-marker") changed.assemblySinceTurn = 144;
    if (defect === "wrong-preset") changed.proof.preset = "1979-default";
    if (defect === "unproven-predecessor") changed.previousSeatingProven = false;
    if (defect === "future-seating") changed.previousSeatedOnTurn = 151;
    if (defect === "expired-term") changed.turn = 237;
    if (defect === "poll-after-term") changed.electionEndTurn = 238;
    if (defect === "poll-at-term") changed.electionEndTurn = 237;
    if (defect === "unsafe-clock") changed.proof.councilTermEndTurn = NaN;
    expect(() => validate(changed)).toThrow();
  });
  it("rejects an unactivated country carrying a seated predecessor marker", () => {
    expect(() => validate({ turn: 150, chamber: "duma", previousSeatedOnTurn: 145 })).toThrow();
  });
});
