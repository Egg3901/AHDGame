import { describe, expect, it } from "vitest";
import { resolveResetTarget } from "./resetTarget";

describe("reset database selection", () => {
  it("uses the runtime database override rather than the URI database", () => {
    expect(
      resolveResetTarget(
        { MONGODB_URI: "mongodb://localhost/uri_world", MONGODB_DB: "intended_world" },
        ["--expect-db=intended_world"]
      )
    ).toBe("intended_world");
  });
  it("rejects the URI target when a runtime override selects a different world", () => {
    expect(() =>
      resolveResetTarget(
        { MONGODB_URI: "mongodb://localhost/uri_world", MONGODB_DB: "intended_world" },
        ["--expect-db=uri_world"]
      )
    ).toThrow("mismatch");
  });
  it("accepts an explicitly checked URI database", () => {
    expect(
      resolveResetTarget({ MONGODB_URI: "mongodb://localhost/uri_world" }, [
        "--expect-db=uri_world",
      ])
    ).toBe("uri_world");
  });
  it("shares the runtime database alias and precedence", () => {
    expect(
      resolveResetTarget({ MONGODB_DB: "primary", MONGO_DB_NAME: "alias" }, ["--expect-db=primary"])
    ).toBe("primary");
    expect(resolveResetTarget({ MONGO_DB_NAME: "alias" }, ["--expect-db=alias"])).toBe("alias");
  });
  it("never silently accepts an unchecked default database", () => {
    expect(() => resolveResetTarget({}, [])).toThrow("--expect-db");
    expect(() => resolveResetTarget({}, ["--expect-db=test"])).toThrow("mismatch");
    expect(resolveResetTarget({}, ["--expect-db=a-house-divided"])).toBe("a-house-divided");
  });
  it.each([[], ["--expect-db="], ["--expect-db=one", "--expect-db=two"]].map((args) => ({ args })))(
    "rejects missing or ambiguous target assertions: %j",
    ({ args }) => {
      expect(() => resolveResetTarget({ MONGODB_DB: "one" }, args)).toThrow("--expect-db");
    }
  );
});
