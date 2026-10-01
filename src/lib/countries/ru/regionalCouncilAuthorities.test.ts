import { describe, expect, it } from "vitest";
import { councilFormationRuntimeScenario as enacted } from "./testing/councilFormationRuntimeScenario";
import { materializeRussianRegionalAuthorities as settle } from "./regionalCouncilAuthorities";

describe("regional Council authority journal", () => {
  it("creates 178 distinct regional people with certified reasons and preserves accounts, Duma and first Council", async () => {
    const { mem, input } = await enacted();
    const finances = mem.collection("npps").docs.map((row) => [String(row._id), row.money]);
    const officials = JSON.stringify(mem.collection("electedOfficials").docs);
    expect(await settle(input)).toMatchObject({ kind: "settled", changed: 178 });
    const authorities = mem.collection("russianRegionalAuthorities").docs;
    expect(authorities).toHaveLength(178);
    expect(new Set(authorities.map((row) => row.head.personId)).size).toBe(178);
    expect(authorities[0]).toMatchObject({
      supportModel: "certified-duma-constituency-proxy",
      regionalTermModel: "bounded-four-year-default",
      sinceTurn: 237,
      termEndTurn: 429,
    });
    expect(mem.collection("npps").docs.map((row) => [String(row._id), row.money])).toEqual(
      finances
    );
    expect(JSON.stringify(mem.collection("electedOfficials").docs)).toBe(officials);
    expect(await settle({ ...input, turn: 238 })).toMatchObject({ kind: "unchanged", changed: 0 });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty("ruCouncilComposition");
  });
  it("requires the actual signed law, certified seating and complete vote evidence", async () => {
    const { mem, input } = await enacted();
    mem.collection("bills").docs[0].status = "failed";
    await expect(settle(input)).rejects.toThrow("signed bound law");
    mem.collection("bills").docs[0].status = "signed";
    mem.collection("russianDumaElectionResults").docs[0].seatedOnTurn = undefined;
    await expect(settle(input)).rejects.toThrow("actual seated Duma certificate");
    expect(mem.collection("russianRegionalAuthorities").docs).toHaveLength(0);
  });
  it("never creates regional nominees from incompatible national office groups", async () => {
    const { mem, input } = await enacted();
    const group = mem.collection("npps").docs.find((row) => row.name === "Regional group")!;
    group.currentOffice = { type: "primeMinister" };
    // Existing Council groups may be used, but never Duma or executive groups.
    const result = await settle(input);
    if (result.kind === "settled") {
      expect(
        mem
          .collection("russianRegionalAuthorities")
          .docs.every((row) => row.head.ownerId !== String(group._id))
      ).toBe(true);
      const dumaOwners = new Set(
        mem
          .collection("electedOfficials")
          .docs.filter((row) => row.officeType === "dumaDeputy")
          .map((row) => String(row.nppId))
      );
      expect(
        mem
          .collection("russianRegionalAuthorities")
          .docs.every((row) => !dumaOwners.has(row.head.ownerId))
      ).toBe(true);
    } else expect(result).toMatchObject({ kind: "wait", reason: "no-eligible-regional-nominee" });
  });
  it("renews expired NPC slots and leaves player authority awaiting a choice", async () => {
    const { mem, input } = await enacted();
    await settle(input);
    mem.collection("russianRegionalAuthorities").docs[0].head.isNpc = false;
    expect(await settle({ ...input, turn: 429 })).toMatchObject({ kind: "settled", changed: 177 });
    const rows = mem.collection("russianRegionalAuthorities").docs;
    expect(rows[0]).toMatchObject({ revision: 1, termEndTurn: 429 });
    expect(rows[1]).toMatchObject({ revision: 2, sinceTurn: 429, termEndTurn: 621 });
  });
  it("binds separate delegates to each regional head without fresh national terms", async () => {
    const { mem, input } = await enacted("regionalDelegates", 461);
    expect(await settle(input)).toMatchObject({ kind: "settled", changed: 178 });
    const rows = mem.collection("russianRegionalAuthorities").docs;
    expect(
      rows.every(
        (row) =>
          row.delegate.appointedByPersonId === row.head.personId &&
          row.delegate.personId !== row.head.personId
      )
    ).toBe(true);
    expect(rows.every((row) => row.termEndTurn === 653)).toBe(true);
  });
});
