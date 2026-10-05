import { describe, expect, it } from "vitest";
import {
  assertFixtureDatabaseName,
  assertSafeMongoTarget,
  normalizeMongoUri,
  uniqueFixtureDatabaseName,
} from "./publicHealthVerticalSliceMongo2026-09-20";

describe("public-health Mongo harness safety", () => {
  it("requires the test URI and rejects the live URI", () => {
    expect(() => assertSafeMongoTarget({})).toThrow(/MONGODB_URI is required/);
    expect(() =>
      assertSafeMongoTarget({ MONGODB_URI: "mongodb://test/", MONGODB_URI_LIVE: "mongodb://test" })
    ).toThrow(/refusing to run/);
    expect(assertSafeMongoTarget({ MONGODB_URI: "mongodb://fixture" })).toBe("mongodb://fixture");
  });

  it("normalizes only harmless trailing separators", () => {
    expect(normalizeMongoUri(" mongodb://fixture/// ")).toBe("mongodb://fixture");
  });

  it("allows cleanup only for the unique fixture prefix", () => {
    expect(() => assertFixtureDatabaseName("ahd_public_health_slice_1_2_abcd1234")).not.toThrow();
    expect(() => assertFixtureDatabaseName("production")).toThrow(/refusing to operate/);
  });

  it("keeps generated fixture database names within MongoDB's 38-byte limit", () => {
    const name = uniqueFixtureDatabaseName();
    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(38);
    expect(() => assertFixtureDatabaseName(name)).not.toThrow();
  });
});
