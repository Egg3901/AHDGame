import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  inferWhipIssuerRole,
  resolveWhipIssuerRole,
  resolveWhipIssuerRoleKey,
  whipIssuerRoleLabel,
} from "./issuerRole";

describe("inferWhipIssuerRole", () => {
  it("prefers chair over vice-chair and admin", () => {
    expect(inferWhipIssuerRole(true, true)).toBe("chair");
  });

  it("stamps vice-chair when the issuer is not chair", () => {
    expect(inferWhipIssuerRole(false, true)).toBe("viceChair");
  });

  it("stamps admin only for the admin-override path", () => {
    expect(inferWhipIssuerRole(false, false)).toBe("admin");
  });
});

describe("whipIssuerRoleLabel", () => {
  it("labels chamber-leader roles instead of collapsing them to Admin", () => {
    expect(whipIssuerRoleLabel("majorityLeader")).toBe("Majority Leader");
    expect(whipIssuerRoleLabel("speaker")).toBe("Speaker");
    expect(whipIssuerRoleLabel("admin")).toBe("Admin");
  });

  it("omits unknown or missing roles", () => {
    expect(whipIssuerRoleLabel(undefined)).toBeUndefined();
    expect(whipIssuerRoleLabel("not-a-role")).toBeUndefined();
  });
});

describe("resolveWhipIssuerRole", () => {
  const chairId = new ObjectId();
  const viceChairId = new ObjectId();
  const leadership = { chairId, viceChairId };

  it("uses the stamped role, including chamber leaders", () => {
    expect(
      resolveWhipIssuerRole(
        { issuedByRole: "majorityWhip", issuedByCharacterId: chairId },
        leadership
      )
    ).toBe("Majority Whip");
  });

  it("infers Chair from the issuing org's chair, not a parent national party", () => {
    expect(resolveWhipIssuerRole({ issuedByCharacterId: chairId }, leadership)).toBe("Chair");
    expect(resolveWhipIssuerRoleKey({ issuedByCharacterId: chairId }, leadership)).toBe("chair");
  });

  it("infers Vice Chair from the issuing org", () => {
    expect(resolveWhipIssuerRole({ issuedByCharacterId: viceChairId }, leadership)).toBe(
      "Vice Chair"
    );
  });

  it("does not label unmatched issuers as Admin", () => {
    expect(
      resolveWhipIssuerRole({ issuedByCharacterId: new ObjectId() }, leadership)
    ).toBeUndefined();
    expect(
      resolveWhipIssuerRole({ issuedByCharacterId: chairId }, { chairId: null })
    ).toBeUndefined();
  });

  it("still labels a stamped admin override as Admin", () => {
    expect(
      resolveWhipIssuerRole(
        { issuedByRole: "admin", issuedByCharacterId: new ObjectId() },
        leadership
      )
    ).toBe("Admin");
  });
});
