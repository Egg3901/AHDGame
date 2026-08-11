import { describe, it, expect } from "vitest";
import { orgHref, resolveOrgBySegment } from "./orgRouting";

describe("orgHref", () => {
  it("lowercases the id for the URL", () => {
    expect(orgHref({ id: "EU" })).toBe("/world/international-organizations/eu");
    expect(orgHref({ id: "east-asia-pact" })).toBe(
      "/world/international-organizations/east-asia-pact"
    );
  });
});

describe("resolveOrgBySegment", () => {
  const orgs = [{ id: "EU" }, { id: "NATO" }, { id: "east-asia-pact" }];
  it("matches case-insensitively", () => {
    expect(resolveOrgBySegment(orgs, "eu")?.id).toBe("EU");
    expect(resolveOrgBySegment(orgs, "EU")?.id).toBe("EU");
    expect(resolveOrgBySegment(orgs, "east-asia-pact")?.id).toBe("east-asia-pact");
  });
  it("returns undefined for an unknown segment", () => {
    expect(resolveOrgBySegment(orgs, "nope")).toBeUndefined();
  });
});
