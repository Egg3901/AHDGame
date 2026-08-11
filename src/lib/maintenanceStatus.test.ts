import { describe, it, expect } from "vitest";
import {
  isMaintenanceBypassPath,
  MAINTENANCE_PUBLIC_PATHS,
  MAINTENANCE_BYPASS_PREFIXES,
  enableMaintenanceMode,
  normalizeMaintenanceMode,
} from "./maintenanceStatus";
import { createMockDb } from "@/lib/test-utils/mockDb";

describe("normalizeMaintenanceMode", () => {
  it("passes through the tri-state string values unchanged", () => {
    expect(normalizeMaintenanceMode("off")).toBe("off");
    expect(normalizeMaintenanceMode("partial")).toBe("partial");
    expect(normalizeMaintenanceMode("full")).toBe("full");
  });

  it("maps the legacy boolean true to full", () => {
    expect(normalizeMaintenanceMode(true)).toBe("full");
  });

  it("maps the legacy boolean false, and absent, to off", () => {
    expect(normalizeMaintenanceMode(false)).toBe("off");
    expect(normalizeMaintenanceMode(undefined)).toBe("off");
  });
});

describe("isMaintenanceBypassPath", () => {
  it.each(MAINTENANCE_PUBLIC_PATHS)("returns true for public path %s", (path) => {
    expect(isMaintenanceBypassPath(path)).toBe(true);
  });

  it("returns true for every bypass prefix and its subtree", () => {
    for (const prefix of MAINTENANCE_BYPASS_PREFIXES) {
      expect(isMaintenanceBypassPath(prefix)).toBe(true);
      expect(isMaintenanceBypassPath(`${prefix}/anything`)).toBe(true);
      expect(isMaintenanceBypassPath(`${prefix}/a/b/c`)).toBe(true);
    }
  });

  it("returns false for gated player paths", () => {
    expect(isMaintenanceBypassPath("/world")).toBe(false);
    expect(isMaintenanceBypassPath("/profile")).toBe(false);
    expect(isMaintenanceBypassPath("/admin")).toBe(false);
    expect(isMaintenanceBypassPath("/register")).toBe(false);
    expect(isMaintenanceBypassPath("/country/us/legislature")).toBe(false);
  });

  it("keeps character history reachable so past Wrapped recaps stay re-viewable", () => {
    // A player between iterations has no active character; /maintenance only
    // launches their newest recap, so these two must survive the wall for the
    // older ones to be reachable at all.
    expect(isMaintenanceBypassPath("/settings")).toBe(true);
    expect(isMaintenanceBypassPath("/retired/507f1f77bcf86cd799439011")).toBe(true);
  });

  it("still gates character creation while maintenance is on", () => {
    // Re-viewing history is allowed; starting a new run is not.
    expect(isMaintenanceBypassPath("/create-character")).toBe(false);
    expect(isMaintenanceBypassPath("/create-imperial-character")).toBe(false);
  });

  it("does not bypass paths that merely share a prefix string with a bypass prefix", () => {
    // Prefixes match `p` or `p/...` only — a substring must not open the wall.
    expect(isMaintenanceBypassPath("/settingsomething")).toBe(false);
    expect(isMaintenanceBypassPath("/retired-characters-export")).toBe(false);
    expect(isMaintenanceBypassPath("/maintenanceX")).toBe(false);
  });

  it("does not bypass paths that merely share a prefix string with a public path", () => {
    // "/login" is public; "/loginsomething" must NOT bypass.
    expect(isMaintenanceBypassPath("/loginsomething")).toBe(false);
    // Same goes for the root: subpaths of "/" would all match if we used
    // startsWith, so PUBLIC_PATHS uses exact-match equality. Verify.
    expect(isMaintenanceBypassPath("/anything")).toBe(false);
  });
});

describe("enableMaintenanceMode", () => {
  it("upserts the maintenance fields on gameConfig._id='default'", async () => {
    const db = createMockDb();
    await enableMaintenanceMode(db as never, {
      reason: "Game reset — fresh world being prepared.",
      enabledBy: "CLI",
    });
    const updateOne = db.collectionMocks["gameConfig"]!.updateOne;
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "default" });
    const setPayload = (update as { $set: Record<string, unknown> }).$set;
    expect(setPayload.maintenanceMode).toBe("full");
    expect(setPayload.maintenanceReason).toBe("Game reset — fresh world being prepared.");
    expect(setPayload.maintenanceEnabledBy).toBe("CLI");
    expect(typeof setPayload.maintenanceEnabledAt).toBe("string");
    // Empty expectedEnd is the documented "unspecified" sentinel.
    expect(setPayload.maintenanceExpectedEnd).toBe("");
    expect(opts).toEqual({ upsert: true });
  });

  it("forwards a caller-supplied expectedEnd ISO timestamp", async () => {
    const db = createMockDb();
    const futureIso = new Date(Date.now() + 60_000).toISOString();
    await enableMaintenanceMode(db as never, {
      reason: "Scheduled reset",
      enabledBy: "admin1",
      expectedEnd: futureIso,
    });
    const updateOne = db.collectionMocks["gameConfig"]!.updateOne;
    const [, update] = updateOne.mock.calls[0];
    const setPayload = (update as { $set: Record<string, unknown> }).$set;
    expect(setPayload.maintenanceExpectedEnd).toBe(futureIso);
  });
});
