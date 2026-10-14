import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { computeIntakeStatus, loadIntakeStatus } from "./intakeStatus";
import { createMockDb } from "@/lib/test-utils/mockDb";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("computeIntakeStatus", () => {
  it("is fully open for a normal world", () => {
    expect(computeIntakeStatus({ maintenanceMode: "off", registrationEnabled: true })).toEqual({
      registration: { open: true, reason: null },
      characterCreation: { open: true, reason: null },
      maintenanceMode: "off",
      expectedEnd: null,
    });
  });

  it("treats a missing config and missing flags as open", () => {
    expect(computeIntakeStatus(null).registration.open).toBe(true);
    expect(computeIntakeStatus({}).characterCreation.open).toBe(true);
  });

  it("closes only registration when the registration switch is off", () => {
    const status = computeIntakeStatus({ maintenanceMode: "off", registrationEnabled: false });
    expect(status.registration).toEqual({ open: false, reason: "registration_closed" });
    expect(status.characterCreation).toEqual({ open: true, reason: null });
  });

  it.each(["partial", "full"] as const)("closes both during %s maintenance", (mode) => {
    const status = computeIntakeStatus({ maintenanceMode: mode, registrationEnabled: true });
    expect(status.registration).toEqual({ open: false, reason: "maintenance" });
    expect(status.characterCreation).toEqual({ open: false, reason: "maintenance" });
    expect(status.maintenanceMode).toBe(mode);
  });

  it("reports maintenance, not the registration switch, when both are closed", () => {
    const status = computeIntakeStatus({ maintenanceMode: "full", registrationEnabled: false });
    expect(status.registration.reason).toBe("maintenance");
  });

  it("maps the legacy boolean maintenance flag to full", () => {
    expect(
      computeIntakeStatus({ maintenanceMode: true as unknown as "full" }).maintenanceMode
    ).toBe("full");
  });

  it("passes a valid expected end through only while maintenance is on", () => {
    const end = "2026-10-20T16:00:00.000Z";
    expect(
      computeIntakeStatus({ maintenanceMode: "full", maintenanceExpectedEnd: end }).expectedEnd
    ).toBe(end);
    expect(
      computeIntakeStatus({ maintenanceMode: "off", maintenanceExpectedEnd: end }).expectedEnd
    ).toBeNull();
    expect(
      computeIntakeStatus({ maintenanceMode: "full", maintenanceExpectedEnd: "soon" }).expectedEnd
    ).toBeNull();
  });

  it("is always open in singleplayer", () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    const status = computeIntakeStatus({ maintenanceMode: "full", registrationEnabled: false });
    expect(status.registration.open).toBe(true);
    expect(status.characterCreation.open).toBe(true);
  });
});

describe("loadIntakeStatus", () => {
  it("reads the gate fields from gameConfig", async () => {
    const db = createMockDb();
    db.collection("gameConfig");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      maintenanceMode: "partial",
    });
    const status = await loadIntakeStatus(db as unknown as Db);
    expect(status.characterCreation).toEqual({ open: false, reason: "maintenance" });
    expect(db.collectionMocks.gameConfig.findOne).toHaveBeenCalledWith(
      { _id: "default" },
      expect.objectContaining({
        projection: expect.objectContaining({ maintenanceMode: 1, registrationEnabled: 1 }),
      })
    );
  });
});
