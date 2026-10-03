import { describe, expect, it } from "vitest";
import { HU_1991_CONSTITUENCIES } from "../data/electoralDistricts1991";
import { chooseHu1991PlayerDistrict } from "./playerFiling1991";
const input = { personId: "player", regionId: "HU_BUD", partyId: "1", otherFilings: [] };
describe("Hungarian player constituency choices", () => {
  it("uses the modern chamber's frozen district set without restoring old districts", () => {
    const modern = {
      ...input,
      districts: [{ id: "HU_BUD:1", regionId: "HU_BUD" }],
      allowedDistrictIds: ["HU_BUD:1"],
    };
    expect(chooseHu1991PlayerDistrict(modern)).toEqual({
      allowed: true,
      constituencyId: "HU_BUD:1",
    });
    expect(
      chooseHu1991PlayerDistrict({ ...modern, requestedId: HU_1991_CONSTITUENCIES[0].id })
    ).toMatchObject({ allowed: false, reason: "outside-region" });
  });
  it("retains one explicit choice in the player's region", () => {
    expect(
      chooseHu1991PlayerDistrict({ ...input, requestedId: HU_1991_CONSTITUENCIES[0].id })
    ).toEqual({ allowed: true, constituencyId: HU_1991_CONSTITUENCIES[0].id });
  });
  it("rejects foreign districts and missing residence", () => {
    expect(chooseHu1991PlayerDistrict({ ...input, regionId: "foreign" })).toMatchObject({
      allowed: false,
      reason: "invalid-residence",
    });
    expect(
      chooseHu1991PlayerDistrict({ ...input, requestedId: "HU-constituency-02-01" })
    ).toMatchObject({ allowed: false, reason: "outside-region" });
  });
  it("assigns an available party slot deterministically and refuses a full region", () => {
    const first = chooseHu1991PlayerDistrict(input);
    if (!first.allowed) throw new Error("Fixture region has available districts");
    const next = chooseHu1991PlayerDistrict({
      ...input,
      otherFilings: [{ personId: "other", partyId: "1", constituencyId: first.constituencyId }],
    });
    expect(next.allowed).toBe(true);
    if (next.allowed) expect(next.constituencyId).not.toBe(first.constituencyId);
    expect(
      chooseHu1991PlayerDistrict({
        ...input,
        otherFilings: HU_1991_CONSTITUENCIES.filter((row) => row.regionId === "HU_BUD").map(
          (row) => ({ personId: row.id, partyId: "1", constituencyId: row.id })
        ),
      })
    ).toMatchObject({ allowed: false, reason: "party-slot-full" });
  });
  it("allows different parties and independent people to contest the same constituency", () => {
    const requestedId = HU_1991_CONSTITUENCIES[0].id;
    const otherFilings = [{ personId: "other", partyId: "1", constituencyId: requestedId }];
    expect(chooseHu1991PlayerDistrict({ ...input, requestedId, otherFilings })).toMatchObject({
      allowed: false,
      reason: "party-slot-full",
    });
    expect(
      chooseHu1991PlayerDistrict({ ...input, partyId: "2", requestedId, otherFilings })
    ).toMatchObject({ allowed: true });
    expect(
      chooseHu1991PlayerDistrict({
        ...input,
        partyId: "independent",
        requestedId,
        otherFilings: [{ personId: "other", partyId: "independent", constituencyId: requestedId }],
      })
    ).toMatchObject({ allowed: true });
  });
});
