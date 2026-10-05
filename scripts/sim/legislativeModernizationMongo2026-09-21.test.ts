import { describe, expect, it } from "vitest";
import {
  assertLegislativeFixtureDatabaseName,
  assertSafeLegislativeMongoTarget,
  legislativeFixtureDatabaseName,
} from "./legislativeModernizationMongo2026-09-21";

describe("legislative modernization Mongo harness safety", () => {
  it("requires the test URI and rejects a live URI match", () => {
    expect(() => assertSafeLegislativeMongoTarget({})).toThrow(/MONGODB_URI is required/);
    expect(() =>
      assertSafeLegislativeMongoTarget({
        MONGODB_URI: "mongodb://fixture/",
        MONGODB_URI_LIVE: "mongodb://fixture",
      })
    ).toThrow(/refusing to run/);
  });

  it("restricts cleanup to short unique fixture database names", () => {
    const name = legislativeFixtureDatabaseName();
    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(38);
    expect(() => assertLegislativeFixtureDatabaseName(name)).not.toThrow();
    expect(() => assertLegislativeFixtureDatabaseName("production")).toThrow(/refusing/);
  });
});
