import { describe, it, expect } from "vitest";
import {
  effectiveGroupReceiving,
  scheduleGroupReceiving,
  canReceiveGroupSupply,
  type GroupOperator,
} from "./participation";
const member: GroupOperator = {
  id: "player",
  rootId: "group",
  ceoId: "ceo",
  userId: "user",
  operator: "player",
  vacant: false,
  stateOwned: false,
};
describe("group receiving participation", () => {
  it("defaults players out and NPPs in without committing output", () => {
    expect(effectiveGroupReceiving(member, undefined, 12)).toBe(false);
    expect(effectiveGroupReceiving({ ...member, operator: "npp" }, undefined, 12)).toBe(true);
    expect(
      canReceiveGroupSupply({ ...member, operator: "npp" }, undefined, "independent", 12)
    ).toBe(false);
  });
  it("applies opt in and opt out on the next turn", () => {
    const joined = scheduleGroupReceiving(member, undefined, true, 12);
    expect(effectiveGroupReceiving(member, joined, 12)).toBe(false);
    expect(effectiveGroupReceiving(member, joined, 13)).toBe(true);
    const left = scheduleGroupReceiving(member, joined, false, 15);
    expect(effectiveGroupReceiving(member, left, 15)).toBe(true);
    expect(effectiveGroupReceiving(member, left, 16)).toBe(false);
  });
  it("preserves the active value when a pending change is edited again", () => {
    const joined = scheduleGroupReceiving(member, undefined, true, 12);
    const cancelled = scheduleGroupReceiving(member, joined, false, 12);
    expect(effectiveGroupReceiving(member, cancelled, 12)).toBe(false);
    expect(effectiveGroupReceiving(member, cancelled, 13)).toBe(false);
  });
  it.each([
    { rootId: "new-group" },
    { ceoId: "new-ceo" },
    { userId: "new-user" },
    { vacant: true },
    { stateOwned: true },
  ])("revokes consent after lifecycle change %o", (change) => {
    const joined = scheduleGroupReceiving(member, undefined, true, 12);
    expect(effectiveGroupReceiving({ ...member, ...change }, joined, 20)).toBe(false);
  });
  it("retains preferences across policy changes without allocating under independence", () => {
    const joined = scheduleGroupReceiving(member, undefined, true, 12);
    expect(canReceiveGroupSupply(member, joined, "independent", 20)).toBe(false);
    expect(canReceiveGroupSupply(member, joined, "members", 20)).toBe(true);
  });
});
