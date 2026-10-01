import { describe, expect, it } from "vitest";
import {
  resolveRussianCouncilBallot as resolve,
  type RussianCouncilBallotInput,
} from "./councilResult";
function fixture(): RussianCouncilBallotInput {
  return {
    registeredVoters: 1000,
    validBallots: 250,
    againstAllVotes: 0,
    options: [
      { id: "a", votes: 200, registrationOrder: 2 },
      { id: "b", votes: 180, registrationOrder: 1 },
      { id: "c", votes: 120, registrationOrder: 0 },
    ],
  };
}
describe("Amended 1993 Council block ballots", () => {
  it("awards two seats at the valid-ballot quorum without counting candidate marks as voters", () => {
    expect(resolve(fixture())).toEqual({
      outcome: "elected",
      validBallots: 250,
      winnerIds: ["a", "b"],
      vacancies: 0,
    });
    const input = fixture();
    input.validBallots = 249;
    input.options[2].votes = 118;
    expect(resolve(input)).toMatchObject({ outcome: "repeat", reason: "low-valid-turnout" });
  });
  it("permits one-choice ballots as well as two-choice ballots", () => {
    const input = fixture();
    input.options = [
      { id: "a", votes: 150, registrationOrder: 0 },
      { id: "b", votes: 100, registrationOrder: 1 },
      { id: "c", votes: 0, registrationOrder: 2 },
    ];
    expect(resolve(input)).toMatchObject({ outcome: "elected", winnerIds: ["a", "b"] });
  });
  it("keeps only the leading mandate when against-all strictly exceeds the second candidate", () => {
    const input = fixture();
    input.validBallots = 500;
    input.againstAllVotes = 100;
    input.options = [
      { id: "a", votes: 350, registrationOrder: 0 },
      { id: "b", votes: 99, registrationOrder: 1 },
      { id: "c", votes: 0, registrationOrder: 2 },
    ];
    expect(resolve(input)).toMatchObject({ outcome: "elected", winnerIds: ["a"], vacancies: 1 });
    input.options[1].votes = 100;
    expect(resolve(input)).toMatchObject({ winnerIds: ["a", "b"], vacancies: 0 });
  });
  it("uses the amended quorum instead of the removed highest-candidate against-all veto", () => {
    const input = fixture();
    input.validBallots = 500;
    input.againstAllVotes = 300;
    input.options = [
      { id: "a", votes: 150, registrationOrder: 0 },
      { id: "b", votes: 100, registrationOrder: 1 },
      { id: "c", votes: 0, registrationOrder: 2 },
    ];
    expect(resolve(input)).toMatchObject({ outcome: "elected", winnerIds: ["a"], vacancies: 1 });
  });
  it("breaks equal candidate votes by registration order and leaves its input unchanged", () => {
    const input = fixture();
    input.options = [
      { id: "late", votes: 250, registrationOrder: 2 },
      { id: "early", votes: 250, registrationOrder: 1 },
      { id: "third", votes: 0, registrationOrder: 3 },
    ];
    const before = structuredClone(input);
    expect(resolve(input)).toMatchObject({ winnerIds: ["early", "late"] });
    expect(input).toEqual(before);
  });
  it("defers a single surviving nominee for additional nominations", () => {
    const input = fixture();
    input.options = [{ id: "only", votes: 250, registrationOrder: 0 }];
    expect(resolve(input)).toMatchObject({ outcome: "repeat", reason: "insufficient-nominees" });
  });
  it("defers two remaining nominees even when their votes reach quorum", () => {
    const input = fixture();
    input.options.pop();
    expect(resolve(input)).toMatchObject({ outcome: "repeat", reason: "insufficient-nominees" });
  });
  it("repeats invalidated, empty and zero-registration ballots", () => {
    expect(resolve({ ...fixture(), invalidated: true })).toMatchObject({
      outcome: "repeat",
      reason: "invalidated",
    });
    expect(
      resolve({ registeredVoters: 1000, validBallots: 250, againstAllVotes: 250, options: [] })
    ).toMatchObject({ outcome: "repeat", reason: "no-candidates" });
    expect(
      resolve({ registeredVoters: 0, validBallots: 0, againstAllVotes: 0, options: [] })
    ).toMatchObject({ outcome: "repeat", reason: "low-valid-turnout" });
  });
  it.each([
    "marks-inflated-turnout",
    "three-choices",
    "same-choice-twice",
    "missing-choice",
    "over-register",
    "against-all-overflow",
    "duplicate-nominee",
    "unsafe-count",
    "negative-count",
  ])("rejects %s", (reason) => {
    const input = fixture();
    if (reason === "marks-inflated-turnout") input.validBallots = 200;
    if (reason === "three-choices") input.options[2].votes = 121;
    if (reason === "same-choice-twice") {
      input.options[0].votes = 251;
      input.options[1].votes = 0;
      input.options[2].votes = 0;
    }
    if (reason === "missing-choice") input.options.forEach((row) => (row.votes = 0));
    if (reason === "over-register") input.registeredVoters = 249;
    if (reason === "against-all-overflow") input.againstAllVotes = 251;
    if (reason === "duplicate-nominee") input.options[1].id = "a";
    if (reason === "unsafe-count") input.options[0].votes = Number.MAX_SAFE_INTEGER + 1;
    if (reason === "negative-count") input.options[0].votes = -1;
    expect(() => resolve(input)).toThrow();
  });
  it("keeps arithmetic exact at safe-integer registration limits", () => {
    const registeredVoters = Number.MAX_SAFE_INTEGER;
    const validBallots = Math.ceil(registeredVoters / 4);
    expect(
      resolve({
        registeredVoters,
        validBallots,
        againstAllVotes: 0,
        options: [
          { id: "a", votes: validBallots, registrationOrder: 0 },
          { id: "b", votes: validBallots, registrationOrder: 1 },
          { id: "c", votes: 0, registrationOrder: 2 },
        ],
      })
    ).toMatchObject({ outcome: "elected", winnerIds: ["a", "b"] });
  });
});
