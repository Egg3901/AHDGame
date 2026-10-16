import { describe, expect, it } from "vitest";
import { collectionScopeHash } from "./collectionDiscovery";

describe("collection selector scope fingerprints", () => {
  it("uses the same fingerprint for LF and Windows checkouts", () => {
    const source = "(name) => {\n  return db.collection(name).deleteMany({});\n}";
    expect(collectionScopeHash(source.replaceAll("\n", "\r\n"))).toBe(collectionScopeHash(source));
    expect(collectionScopeHash(source.replaceAll("\n", "\r"))).toBe(collectionScopeHash(source));
  });
  it("still detects code changes and literal escape changes", () => {
    const source = "(name) => db.collection(name).deleteMany({})";
    expect(collectionScopeHash(source.replace("deleteMany", "find"))).not.toBe(
      collectionScopeHash(source)
    );
    expect(collectionScopeHash('() => "\\r\\n"')).not.toBe(collectionScopeHash('() => "\\n"'));
  });
});
