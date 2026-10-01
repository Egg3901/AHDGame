import { describe, expect, it } from "vitest";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import {
  planRussianRegionalCouncilAppointments as appoint,
  planRussianRegionalCouncilDelegates as delegate,
} from "./regionalCouncilAppointments";
import { planRussianCouncilComposition } from "./councilComposition";
function input() {
  return {
    turn: 240,
    revision: 1,
    termYears: 4,
    profiles: [
      { ownerId: "npc-a", party: "1", name: "Existing profile A", eligible: true },
      { ownerId: "npc-b", party: "2", name: "Existing profile B", eligible: true },
    ],
    votesByRegion: Object.fromEntries(
      RUSSIAN_COUNCIL_SUBJECTS_1993.map(([, , region]) => [region, { "1": 60, "2": 40 }])
    ),
  };
}
describe("bounded regional NPC decisions", () => {
  it("creates all actual subject authority slots using existing groups without creating account identities", () => {
    const source = input();
    const result = appoint(source);
    expect(result.kind).toBe("appoint");
    if (result.kind !== "appoint") throw new Error("expected appointment");
    expect(result.authorities).toHaveLength(178);
    expect(new Set(result.authorities.map((row) => row.head.personId)).size).toBe(178);
    expect(new Set(result.authorities.map((row) => row.head.ownerId))).toEqual(new Set(["npc-a"]));
    expect(result.termEndTurn).toBe(432);
    expect(source.profiles).toHaveLength(2);
  });
  it("uses the supported available party and records failure when no legitimate nominee exists", () => {
    const source = input();
    source.profiles[0].eligible = false;
    const result = appoint(source);
    if (result.kind !== "appoint") throw new Error("expected appointment");
    expect(result.authorities.every((row) => row.head.party === "2")).toBe(true);
    source.profiles[1].eligible = false;
    expect(appoint(source)).toMatchObject({ kind: "wait", reason: "no-eligible-regional-nominee" });
  });
  it("waits for missing regional electoral evidence instead of inventing votes", () => {
    const source = input();
    delete source.votesByRegion.CEN;
    expect(appoint(source)).toMatchObject({
      kind: "wait",
      reason: "missing-regional-vote",
      region: "CEN",
    });
  });
  it("binds separate representatives to existing heads and their remaining terms", () => {
    const result = appoint(input());
    if (result.kind !== "appoint") throw new Error("expected appointment");
    const rows = delegate({
      turn: 400,
      authorities: result.authorities,
      profiles: input().profiles,
    });
    const composition = planRussianCouncilComposition({
      mode: "regionalDelegates",
      turn: 400,
      authorities: rows,
    });
    expect(composition.seats).toHaveLength(178);
    expect(composition.seats.every((row) => row.termEndTurn === 432)).toBe(true);
    expect(composition.seats.every((row) => row.personId !== row.authorityPersonId)).toBe(true);
    expect(delegate({ turn: 401, authorities: rows, profiles: input().profiles })).toEqual(rows);
  });
  it("never silently replaces a player head or appoints for an expired authority", () => {
    const result = appoint(input());
    if (result.kind !== "appoint") throw new Error("expected appointment");
    result.authorities[0].head.isNpc = false;
    const rows = delegate({
      turn: 400,
      authorities: result.authorities,
      profiles: input().profiles,
    });
    expect(rows[0].delegate).toBeUndefined();
    expect(
      delegate({ turn: 432, authorities: result.authorities, profiles: input().profiles }).every(
        (row) => !row.delegate
      )
    ).toBe(true);
  });
  it.each([0, 6, 1.5])("rejects unbounded regional term %s", (termYears) => {
    expect(() => appoint({ ...input(), termYears })).toThrow();
  });
});
