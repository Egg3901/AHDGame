import { describe, expect, it } from "vitest";
import { bgListVacancyFixture } from "../listVacancies1991.testFixture";
import { planBg1991ListReplacements } from "./listVacancies1991";

function fixture() {
  const data = bgListVacancyFixture();
  const heldPersonIds = new Set(data.settled.mandates.map((row) => row.personId));
  return {
    ...data,
    heldPersonIds,
    replacements: [],
    heldPlayerOwnerIds: new Set<string>(),
    unavailablePersonIds: new Set<string>(),
  };
}
describe("Bulgarian statutory original-list succession", () => {
  it("does nothing for an intact400-seat chamber", () =>
    expect(planBg1991ListReplacements(fixture())).toEqual([]));
  it("selects the next nominee, preserving party, district and region", () => {
    const data = fixture(),
      slot = data.settled.mandates.find((row) => row.tier === "list")!;
    data.heldPersonIds.delete(slot.personId);
    const plan = planBg1991ListReplacements(data);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      slotId: slot.personId,
      previousPersonId: slot.personId,
      mandate: {
        partyId: slot.partyId,
        districtId: slot.districtId,
        regionId: slot.regionId,
        personId: data.nominations.lists[0].candidateIds.at(-2),
      },
    });
  });
  it("does not transfer a departed constituency mandate through a list", () => {
    const data = fixture();
    data.heldPersonIds.delete(data.settled.mandates[0].personId);
    expect(planBg1991ListReplacements(data)).toEqual([]);
  });
  it("advances a replacement chain without reusing a former deputy", () => {
    const data = fixture(),
      slot = data.settled.mandates.find((row) => row.tier === "list")!;
    data.heldPersonIds.delete(slot.personId);
    const first = planBg1991ListReplacements(data)[0];
    const next = planBg1991ListReplacements({
      ...data,
      replacements: [{ slotId: first.slotId, personId: first.mandate.personId }],
    });
    expect(next[0].mandate.personId).toBe(data.nominations.lists[0].candidateIds.at(-1));
    expect(next[0].previousPersonId).toBe(first.mandate.personId);
  });
  it("leaves an exhausted party list vacant", () => {
    const data = fixture(),
      slot = data.settled.mandates.find((row) => row.tier === "list")!;
    data.heldPersonIds.delete(slot.personId);
    data.nominations.lists[0].candidateIds.forEach((id) => data.unavailablePersonIds.add(id));
    expect(planBg1991ListReplacements(data)).toEqual([]);
  });
  it("fills multiple vacancies with distinct original people", () => {
    const data = fixture(),
      slots = data.settled.mandates.filter((row) => row.tier === "list").slice(0, 2);
    slots.forEach((row) => data.heldPersonIds.delete(row.personId));
    const plan = planBg1991ListReplacements(data);
    expect(plan).toHaveLength(2);
    expect(new Set(plan.map((row) => row.mandate.personId)).size).toBe(2);
  });
  it("skips a player already holding another mandate", () => {
    const data = fixture(),
      slot = data.settled.mandates.find((row) => row.tier === "list")!,
      person = data.nominations.people.find(
        (row) => row.id === data.nominations.lists[0].candidateIds.at(-2)
      )!;
    person.isNpc = false;
    person.candidateId = "player-campaign";
    data.heldPlayerOwnerIds.add(person.ownerId);
    data.heldPersonIds.delete(slot.personId);
    expect(planBg1991ListReplacements(data)[0].mandate.personId).toBe(
      data.nominations.lists[0].candidateIds.at(-1)
    );
  });
  it("fills an initially certified vacancy with its original party list", () => {
    const data = fixture(),
      slot = data.settled.mandates.find((row) => row.tier === "list")!;
    data.settled.mandates = data.settled.mandates.filter((row) => row !== slot);
    data.settled.vacancies.push({
      tier: "list",
      partyId: slot.partyId,
      districtId: slot.districtId,
    });
    data.heldPersonIds.delete(slot.personId);
    expect(planBg1991ListReplacements(data)[0]).toMatchObject({
      slotId: "initial-vacancy:0",
      previousPersonId: null,
      mandate: { personId: slot.personId },
    });
  });
  it.each(["unknown-slot", "direct-person", "foreign-list", "reused-person"])(
    "rejects%s history",
    (mode) => {
      const data = fixture(),
        slot = data.settled.mandates.find((row) => row.tier === "list")!;
      const personId =
        mode === "direct-person"
          ? data.settled.mandates[0].personId
          : mode === "foreign-list"
            ? data.nominations.lists[1].candidateIds.at(-1)!
            : mode === "reused-person"
              ? slot.personId
              : data.nominations.lists[0].candidateIds.at(-1)!;
      expect(() =>
        planBg1991ListReplacements({
          ...data,
          replacements: [{ slotId: mode === "unknown-slot" ? "forged" : slot.personId, personId }],
        })
      ).toThrow("history");
    }
  );
});
