import { describe, expect, it } from "vitest";
import { DEFAULT_MONGODB_DB_NAME, extractMongoDbNameFromUri, resolveMongoDbName } from "./mongodb";

describe("extractMongoDbNameFromUri", () => {
  it("reads the database name from mongodb+srv uris", () => {
    expect(
      extractMongoDbNameFromUri(
        "mongodb+srv://user:pass@cluster.example.net/a-house-divided-sandbox?retryWrites=true&w=majority"
      )
    ).toBe("a-house-divided-sandbox");
  });

  it("decodes escaped database names", () => {
    expect(extractMongoDbNameFromUri("mongodb://localhost:27017/a-house-divided%2Dsandbox")).toBe(
      "a-house-divided-sandbox"
    );
  });

  it("returns undefined when the uri does not include a database", () => {
    expect(extractMongoDbNameFromUri("mongodb://localhost:27017")).toBeUndefined();
    expect(
      extractMongoDbNameFromUri("mongodb://localhost:27017/?retryWrites=true")
    ).toBeUndefined();
  });
});

describe("resolveMongoDbName", () => {
  it("prefers the explicit MONGODB_DB override", () => {
    expect(
      resolveMongoDbName({
        MONGODB_URI: "mongodb://localhost:27017/a-house-divided",
        MONGODB_DB: "a-house-divided-sandbox",
      })
    ).toBe("a-house-divided-sandbox");
  });

  it("accepts the legacy MONGO_DB_NAME override", () => {
    expect(
      resolveMongoDbName({
        MONGODB_URI: "mongodb://localhost:27017/a-house-divided",
        MONGO_DB_NAME: "a-house-divided-sandbox",
      })
    ).toBe("a-house-divided-sandbox");
  });

  it("falls back to the database embedded in the uri", () => {
    expect(
      resolveMongoDbName({
        MONGODB_URI:
          "mongodb+srv://user:pass@cluster.example.net/a-house-divided-sandbox?retryWrites=true&w=majority",
      })
    ).toBe("a-house-divided-sandbox");
  });

  it("uses the historical default when no database is configured", () => {
    expect(resolveMongoDbName({ MONGODB_URI: "mongodb://localhost:27017" })).toBe(
      DEFAULT_MONGODB_DB_NAME
    );
  });
});
