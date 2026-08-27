import { describe, expect, it } from "vitest";
import { actingAppointmentsEnabled } from "./actingEligibility";

describe("actingAppointmentsEnabled", () => {
  it("is true for the US, which confirms cabinet picks in the Senate", () => {
    expect(actingAppointmentsEnabled("US")).toBe(true);
  });

  it("is false for NG: presidential, but it fills its cabinet directly", () => {
    expect(actingAppointmentsEnabled("NG")).toBe(false);
  });

  it("is false for presidential countries with no cabinet at all", () => {
    expect(actingAppointmentsEnabled("BR")).toBe(false);
    expect(actingAppointmentsEnabled("FR")).toBe(false);
  });

  it("is false for parliamentary and one-party countries", () => {
    expect(actingAppointmentsEnabled("UK")).toBe(false);
    expect(actingAppointmentsEnabled("DE")).toBe(false);
    expect(actingAppointmentsEnabled("CN")).toBe(false);
  });
});
