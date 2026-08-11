import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ALWAYS_PUBLIC_API_PREFIXES,
  ALWAYS_PUBLIC_API_PATHS,
  isPublicApiReadBypassPath,
  getCachedPublicViewingMode,
  invalidatePublicViewingCache,
} from "./publicViewing";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("isPublicApiReadBypassPath", () => {
  it("bypasses every always-public prefix and its subtree", () => {
    for (const prefix of ALWAYS_PUBLIC_API_PREFIXES) {
      expect(isPublicApiReadBypassPath(prefix)).toBe(true);
      expect(isPublicApiReadBypassPath(`${prefix}anything`)).toBe(true);
      expect(isPublicApiReadBypassPath(`${prefix}a/b/c`)).toBe(true);
    }
  });

  it("bypasses every always-public exact path", () => {
    for (const path of ALWAYS_PUBLIC_API_PATHS) {
      expect(isPublicApiReadBypassPath(path)).toBe(true);
    }
  });

  it("gates the internal page-serving read routes", () => {
    expect(isPublicApiReadBypassPath("/api/corporations")).toBe(false);
    expect(isPublicApiReadBypassPath("/api/map/overview")).toBe(false);
    expect(isPublicApiReadBypassPath("/api/news/wire")).toBe(false);
    expect(isPublicApiReadBypassPath("/api/country/us/parties")).toBe(false);
    expect(isPublicApiReadBypassPath("/api/world/metrics")).toBe(false);
  });

  it("does not bypass a path that merely shares a prefix string with an allowlisted name", () => {
    // "/api/auth/" is allowlisted; "/api/authx" must NOT bypass.
    expect(isPublicApiReadBypassPath("/api/authx")).toBe(false);
    // Exact allowlist entries must not match siblings that extend the name.
    expect(isPublicApiReadBypassPath("/api/health-secrets")).toBe(false);
  });
});

describe("getCachedPublicViewingMode", () => {
  let db: MockDb;

  beforeEach(async () => {
    invalidatePublicViewingCache();
    delete process.env.PUBLIC_VIEWING_MODE;
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  afterEach(() => {
    invalidatePublicViewingCache();
    delete process.env.PUBLIC_VIEWING_MODE;
  });

  it("defaults to enabled when the config field is absent", async () => {
    db.collectionMocks["gameConfig"] = db.collection("gameConfig") as never;
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue(null);
    expect(await getCachedPublicViewingMode()).toBe(true);
  });

  it("stays enabled for an explicit true", async () => {
    db.collection("gameConfig");
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue({ publicViewingMode: true });
    expect(await getCachedPublicViewingMode()).toBe(true);
  });

  it("engages the gate only for an explicit false", async () => {
    db.collection("gameConfig");
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue({ publicViewingMode: false });
    expect(await getCachedPublicViewingMode()).toBe(false);
  });

  it("honors the PUBLIC_VIEWING_MODE env override without touching the DB", async () => {
    process.env.PUBLIC_VIEWING_MODE = "false";
    db.collection("gameConfig");
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue({ publicViewingMode: true });
    expect(await getCachedPublicViewingMode()).toBe(false);
    expect(db.collectionMocks["gameConfig"]!.findOne).not.toHaveBeenCalled();
  });

  it("caches the DB read until invalidated", async () => {
    db.collection("gameConfig");
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue({ publicViewingMode: false });

    expect(await getCachedPublicViewingMode()).toBe(false);
    expect(await getCachedPublicViewingMode()).toBe(false);
    expect(db.collectionMocks["gameConfig"]!.findOne).toHaveBeenCalledTimes(1);

    invalidatePublicViewingCache();
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue({ publicViewingMode: true });
    expect(await getCachedPublicViewingMode()).toBe(true);
    expect(db.collectionMocks["gameConfig"]!.findOne).toHaveBeenCalledTimes(2);
  });
});
