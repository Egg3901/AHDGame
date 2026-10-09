import { describe, expect, it } from "vitest";
import { planAbsentRegistrationHeal } from "./absentRegistrationHeal";
import { registrationPresenceKey } from "./registrationPresence";

describe("absent-party registration heal", () => {
  const rows = [
    {
      _id: "SCO_1",
      countryId: "UK",
      stateId: "SCO",
      partyId: "1",
      registration: 10,
      organization: 20,
    },
    {
      _id: "SCO_2",
      countryId: "UK",
      stateId: "SCO",
      partyId: "2",
      registration: 0.75,
      organization: 0,
    },
    {
      _id: "SCO_3",
      countryId: "UK",
      stateId: "SCO",
      partyId: "3",
      registration: 1.25,
      organization: 4,
    },
  ];
  const pools = [
    { _id: "UK_SCO", countryId: "UK", stateId: "SCO", independent: 80, unregistered: 8 },
  ];
  const presence = new Set([registrationPresenceKey("UK", "1", "SCO")]);
  it("returns only absent registration to Independent, even if absent parties retain Org", () => {
    const plan = planAbsentRegistrationHeal(rows, pools, presence);
    expect(plan.transfers.map((t) => t.row.partyId)).toEqual(["2", "3"]);
    expect(plan.poolChanges[0].amount).toBe(2);
    expect(plan.blocked).toEqual([]);
    expect(plan.transfers.reduce((s, t) => s + t.amount, 0)).toBe(plan.poolChanges[0].amount);
    expect(rows[1].registration).toBe(0.75);
    expect(pools[0].unregistered).toBe(8);
  });
  it("is idempotent after the transfer", () => {
    const healed = rows.map((r) => ({ ...r, registration: r.partyId === "1" ? 10 : 0 }));
    expect(
      planAbsentRegistrationHeal(healed, [{ ...pools[0], independent: 82 }], presence).transfers
    ).toEqual([]);
  });
  it.each([
    { badPools: [] },
    { badPools: [{ ...pools[0], independent: -1 }] },
    { badPools: [{ ...pools[0], independent: NaN }] },
    { badPools: [{ ...pools[0], independent: 81 }] },
    { badPools: [pools[0], pools[0]] },
  ])("blocks invalid or missing pools", ({ badPools }) => {
    const plan = planAbsentRegistrationHeal(rows, badPools, presence);
    expect(plan.transfers).toEqual([]);
    expect(plan.blocked).toHaveLength(1);
  });
  it("does not confuse the same party ID in another country", () => {
    const plan = planAbsentRegistrationHeal(
      rows,
      pools,
      new Set([registrationPresenceKey("US", "1", "SCO")])
    );
    expect(plan.poolChanges[0].amount).toBe(12);
  });
});
