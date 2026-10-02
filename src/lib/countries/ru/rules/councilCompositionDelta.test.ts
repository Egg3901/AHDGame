import { describe, expect, it } from "vitest";
import {
  planRussianCouncilCompositionDelta as delta,
  type RussianRegionalCouncilSeat as Seat,
} from "./councilCompositionDelta";
function seat(personId = "regional-head"): Seat {
  return {
    personId,
    ownerId: "existing-group",
    isNpc: true,
    name: "Regional head",
    party: "1",
    eligible: true,
    subjectId: "RU-council-1",
    regionId: "CEN",
    branch: "executive",
    authorityRevision: 1,
    authorityPersonId: personId,
    termEndTurn: 429,
  };
}
describe("regional Council mandate deltas", () => {
  it("preserves held party defections and leaves unchanged memberships untouched", () => {
    const original = seat(),
      held = { ...original, party: "2" };
    expect(
      delta({
        desired: [original],
        previous: [original],
        held: [held],
        endedPersonIds: [],
        newLaw: false,
      })
    ).toMatchObject({ seated: [held], insert: [], retire: [], seatsByParty: { "2": 1 } });
  });
  it("does not recreate an ended mandate on replay", () => {
    const original = seat();
    const input = {
      desired: [original],
      previous: [original],
      held: [],
      endedPersonIds: [],
      newLaw: false,
    };
    const first = delta(input);
    expect(first).toMatchObject({ seated: [], insert: [], endedPersonIds: [original.personId] });
    expect(delta({ ...input, previous: [], endedPersonIds: first.endedPersonIds })).toMatchObject({
      seated: [],
      insert: [],
    });
  });
  it("replaces an authority with its actual new person and records retirement", () => {
    const original = seat(),
      next = { ...seat("new-head"), authorityRevision: 2 };
    expect(
      delta({
        desired: [next],
        previous: [original],
        held: [original],
        endedPersonIds: [],
        newLaw: false,
      })
    ).toMatchObject({
      insert: [next],
      retire: [original],
      seated: [next],
      endedPersonIds: [original.personId],
    });
  });
  it("rejects an unproven incumbent and silently changed remaining terms", () => {
    const original = seat();
    expect(() =>
      delta({
        desired: [original],
        previous: [],
        held: [original],
        endedPersonIds: [],
        newLaw: false,
      })
    ).toThrow("predecessor");
    expect(() =>
      delta({
        desired: [{ ...original, termEndTurn: 500 }],
        previous: [original],
        held: [original],
        endedPersonIds: [],
        newLaw: false,
      })
    ).toThrow("silently redefined");
  });
  it("allows lawful vacancies without reducing the full 90-member majority", () => {
    const result = delta({
      desired: [],
      previous: [seat()],
      held: [seat()],
      endedPersonIds: [],
      newLaw: false,
    });
    expect(result).toMatchObject({ viable: false, vacancies: 178, retire: [seat()] });
  });
});
