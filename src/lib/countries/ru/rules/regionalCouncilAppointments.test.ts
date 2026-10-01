import { describe, expect, it } from "vitest";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import {
  planRussianRegionalCouncilAppointments as appoint,
  planRussianRegionalCouncilDelegates as delegate,
  planRussianRegionalCouncilRenewals as renew,
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
  it("renews expired NPC authorities but preserves a player's pending regional choice", () => {
    const source = input(),
      appointed = appoint(source);
    if (appointed.kind !== "appoint") throw new Error("expected appointment");
    appointed.authorities[0].head.isNpc = false;
    const result = renew({ ...source, turn: 432, authorities: appointed.authorities });
    if (result.kind !== "renew") throw new Error("expected renewal");
    expect(result.changes).toHaveLength(177);
    expect(result.changes.every((row) => row.revision === 2 && row.termEndTurn === 624)).toBe(true);
    expect(
      result.changes.some(
        (row) =>
          row.subjectId === appointed.authorities[0].subjectId &&
          row.branch === appointed.authorities[0].branch
      )
    ).toBe(false);
  });
  it("replaces an unavailable NPC without extending the regional term or keeping its delegate", () => {
    const source = input(),
      appointed = appoint(source);
    if (appointed.kind !== "appoint") throw new Error("expected appointment");
    const authorities = delegate({ ...source, authorities: appointed.authorities });
    authorities[0].head.eligible = false;
    const result = renew({ ...source, turn: 300, authorities });
    if (result.kind !== "renew") throw new Error("expected renewal");
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ revision: 2, sinceTurn: 300, termEndTurn: 432 });
    expect(result.changes[0].delegate).toBeUndefined();
    expect(result.changes[0].head.personId).not.toBe(authorities[0].head.personId);
    expect(authorities[0].revision).toBe(1);
  });
  it("keeps still-serving authorities intact and waits when electoral support is missing", () => {
    const source = input(),
      appointed = appoint(source);
    if (appointed.kind !== "appoint") throw new Error("expected appointment");
    expect(renew({ ...source, turn: 300, authorities: appointed.authorities })).toMatchObject({
      kind: "renew",
      changes: [],
    });
    delete source.votesByRegion.CEN;
    expect(renew({ ...source, turn: 432, authorities: appointed.authorities })).toMatchObject({
      kind: "wait",
      reason: "missing-regional-vote",
    });
  });
  it("replaces an unavailable NPC delegate with a new appointment identity while preserving its head and deadline", () => {
    const source = input(),
      result = appoint(source);
    if (result.kind !== "appoint") throw new Error("expected appointment");
    const rows = delegate({ ...source, authorities: result.authorities });
    rows[0].delegate!.eligible = false;
    const next = delegate({ ...source, turn: 300, authorities: rows });
    expect(next[0].head).toEqual(rows[0].head);
    expect(next[0].termEndTurn).toBe(432);
    expect(next[0].delegate!.personId).not.toBe(rows[0].delegate!.personId);
    expect(next[0].delegate).toMatchObject({ appointmentRevision: 2, appointedOnTurn: 300 });
    rows[0].delegate!.isNpc = false;
    expect(delegate({ ...source, turn: 300, authorities: rows })[0].delegate).toEqual(
      rows[0].delegate
    );
  });
});
