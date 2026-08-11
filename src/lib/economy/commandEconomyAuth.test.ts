import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  canOperateGosbank,
  canOperateGosplan,
  canAppointSoeDirector,
  isSoeDirector,
  type CommandEconomyRoles,
} from "./commandEconomyAuth";

const NONE: CommandEconomyRoles = {
  isHeadOfGovernment: false,
  isPlanner: false,
  isBankChair: false,
};

describe("command-economy role decisions", () => {
  it("Gosbank levers: only the bank chair or head of government", () => {
    expect(canOperateGosbank(NONE)).toBe(false);
    expect(canOperateGosbank({ ...NONE, isBankChair: true })).toBe(true);
    expect(canOperateGosbank({ ...NONE, isHeadOfGovernment: true })).toBe(true);
    // The planner alone cannot drive state credit.
    expect(canOperateGosbank({ ...NONE, isPlanner: true })).toBe(false);
  });

  it("Gosplan levers: only the planner or head of government", () => {
    expect(canOperateGosplan(NONE)).toBe(false);
    expect(canOperateGosplan({ ...NONE, isPlanner: true })).toBe(true);
    expect(canOperateGosplan({ ...NONE, isHeadOfGovernment: true })).toBe(true);
    // The bank chair alone cannot set the national plan.
    expect(canOperateGosplan({ ...NONE, isBankChair: true })).toBe(false);
  });

  it("director appointment: planner or head of government", () => {
    expect(canAppointSoeDirector(NONE)).toBe(false);
    expect(canAppointSoeDirector({ ...NONE, isPlanner: true })).toBe(true);
    expect(canAppointSoeDirector({ ...NONE, isHeadOfGovernment: true })).toBe(true);
    expect(canAppointSoeDirector({ ...NONE, isBankChair: true })).toBe(false);
  });

  it("isSoeDirector matches only the seated character", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    expect(isSoeDirector(a, a)).toBe(true);
    expect(isSoeDirector(a, b)).toBe(false);
    // A vacant seat is never anyone's.
    expect(isSoeDirector(null, a)).toBe(false);
    expect(isSoeDirector(a, null)).toBe(false);
  });
});
