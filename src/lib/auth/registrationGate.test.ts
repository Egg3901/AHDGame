import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { assertRegistrationAllowed } from "./registrationGate";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("assertRegistrationAllowed", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    // Eagerly instantiate the mocks for the collections the gate touches.
    db.collection("gameConfig");
    db.collection("bannedIps");
    db.collection("users");
  });

  const setConfig = (cfg: Record<string, unknown>) => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ _id: "default", ...cfg });
  };
  const setBannedIp = (row: Record<string, unknown> | null) => {
    db.collectionMocks.bannedIps.findOne.mockResolvedValue(row);
  };
  const setUserCount = (n: number) => {
    db.collectionMocks.users.countDocuments.mockResolvedValue(n);
  };

  it("throws 403 when registration is closed", async () => {
    setConfig({ registrationEnabled: false });
    await expect(assertRegistrationAllowed(db as unknown as Db, "1.2.3.4")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows when clientIp is 'unknown' (non-matchable)", async () => {
    setConfig({ registrationEnabled: true });
    await expect(assertRegistrationAllowed(db as unknown as Db, "unknown")).resolves.toEqual({});
  });

  it("blocks a banned IP regardless of collision toggle", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: false });
    setBannedIp({ ip: "1.2.3.4", allowRegistration: false });
    await expect(assertRegistrationAllowed(db as unknown as Db, "1.2.3.4")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows collision when ipCollisionCheckEnabled is false", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: false });
    setBannedIp(null);
    setUserCount(1);
    await expect(assertRegistrationAllowed(db as unknown as Db, "1.2.3.4")).resolves.toEqual({});
  });

  it("allows when collision-check is on but no existing user", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(0);
    await expect(assertRegistrationAllowed(db as unknown as Db, "1.2.3.4")).resolves.toEqual({});
  });

  it("blocks when collision-check is on and an existing user matches", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(1);
    await expect(assertRegistrationAllowed(db as unknown as Db, "1.2.3.4")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("soft-allows on mobile when only IP collides (cgNAT mitigation)", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(2);
    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        device: "mobile",
      })
    ).resolves.toEqual({
      softAllow: {
        reason: "cgnat_mobile_ip",
        sharedIp: "1.2.3.4",
        existingCount: 2,
        device: "mobile",
      },
    });
  });

  it("soft-allows tablets on shared cgNAT IPs", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(5);
    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        device: "tablet",
      })
    ).resolves.toMatchObject({ softAllow: { reason: "cgnat_mobile_ip", device: "tablet" } });
  });

  it("hard-blocks desktops on shared IP even with the soft-allow path", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(1);
    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        device: "desktop",
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("hard-blocks on browser-signal collision even when device is mobile", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(0);
    db.collectionMocks.users.findOne.mockResolvedValueOnce({ _id: "existing-user" });

    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        device: "mobile",
        deviceKey: "device-shared",
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("respects manual allowance caps on mobile (admin override wins over soft-allow)", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp({ ip: "1.2.3.4", allowRegistration: true, maxAccounts: 3 });
    setUserCount(3);
    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        device: "mobile",
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("respects allowance cap: count < maxAccounts allows", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp({ ip: "1.2.3.4", allowRegistration: true, maxAccounts: 3 });
    setUserCount(2);
    await expect(assertRegistrationAllowed(db as unknown as Db, "1.2.3.4")).resolves.toEqual({});
  });

  it("respects allowance cap: count === maxAccounts blocks", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp({ ip: "1.2.3.4", allowRegistration: true, maxAccounts: 3 });
    setUserCount(3);
    await expect(assertRegistrationAllowed(db as unknown as Db, "1.2.3.4")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("normalizes IPv4-mapped IPv6 before lookup", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp({ ip: "1.2.3.4", allowRegistration: false });
    await expect(
      assertRegistrationAllowed(db as unknown as Db, "::ffff:1.2.3.4")
    ).rejects.toMatchObject({ status: 403 });
    expect(db.collectionMocks.bannedIps.findOne).toHaveBeenCalledWith({ ip: "1.2.3.4" });
  });

  it("counts legacy mapped IPv4 registration rows when collision-check is on", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(1);

    await expect(assertRegistrationAllowed(db as unknown as Db, "1.2.3.4")).rejects.toMatchObject({
      status: 403,
    });
    expect(db.collectionMocks.users.countDocuments).toHaveBeenCalledWith({
      registrationIp: { $in: ["1.2.3.4", "::ffff:1.2.3.4", "::FFFF:1.2.3.4"] },
    });
  });

  it("blocks exact browser fingerprint reuse when collision-check is on", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(0);
    db.collectionMocks.users.findOne.mockResolvedValueOnce({ _id: "existing-user" });

    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        fingerprint: "fp-shared",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(db.collectionMocks.users.findOne).toHaveBeenCalledWith(
      {
        $or: [
          { registrationFingerprint: { $in: ["fp-shared"] } },
          { lastFingerprint: { $in: ["fp-shared"] } },
          { fingerprintHistory: { $in: ["fp-shared"] } },
        ],
      },
      { projection: { _id: 1 } }
    );
  });

  it("matches legacy 16-char truncated fingerprints against the full incoming hash", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(0);
    db.collectionMocks.users.findOne.mockResolvedValueOnce({ _id: "legacy-user" });

    const fullHash = "0123456789abcdef".repeat(4); // 64-char SHA-256
    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        fingerprint: fullHash,
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(db.collectionMocks.users.findOne).toHaveBeenCalledWith(
      {
        $or: [
          { registrationFingerprint: { $in: [fullHash, fullHash.slice(0, 16)] } },
          { lastFingerprint: { $in: [fullHash, fullHash.slice(0, 16)] } },
          { fingerprintHistory: { $in: [fullHash, fullHash.slice(0, 16)] } },
        ],
      },
      { projection: { _id: 1 } }
    );
  });

  it("blocks shared tracking cookie reuse when collision-check is on", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(0);
    db.collectionMocks.users.findOne.mockResolvedValueOnce({ _id: "existing-user" });

    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        trackingId: "track-shared",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(db.collectionMocks.users.findOne).toHaveBeenCalledWith(
      {
        $or: [{ trackingId: "track-shared" }],
      },
      { projection: { _id: 1 } }
    );
  });

  it("blocks shared device key reuse when collision-check is on", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(0);
    db.collectionMocks.users.findOne.mockResolvedValueOnce({ _id: "existing-user" });

    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "1.2.3.4",
        deviceKey: "device-shared",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(db.collectionMocks.users.findOne).toHaveBeenCalledWith(
      {
        $or: [{ deviceKey: "device-shared" }],
      },
      { projection: { _id: 1 } }
    );
  });

  it("allows exact browser reuse checks to be skipped when the signals are absent", async () => {
    setConfig({ registrationEnabled: true, ipCollisionCheckEnabled: true });
    setBannedIp(null);
    setUserCount(0);

    await expect(
      assertRegistrationAllowed(db as unknown as Db, {
        clientIp: "unknown",
      })
    ).resolves.toEqual({});
    expect(db.collectionMocks.users.findOne).not.toHaveBeenCalled();
  });
});
