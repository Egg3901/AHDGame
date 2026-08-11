import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  decodeClusterCursor,
  encodeClusterCursor,
  isAltSignal,
  memberRole,
  redactEvidenceForModerator,
  redactEvidenceForRole,
} from "./_shared";

describe("isAltSignal", () => {
  it("accepts every registered signal type", () => {
    expect(isAltSignal("oauth_shared")).toBe(true);
    expect(isAltSignal("subnet_/24_share")).toBe(true);
  });

  it("rejects an unknown value", () => {
    expect(isAltSignal("not_a_real_signal")).toBe(false);
  });
});

describe("redactEvidenceForModerator", () => {
  it("replaces a masked fingerprint fragment with a generic placeholder", () => {
    const evidence = "Exact device fingerprint match (a1b2c3d4…, 2 shared hashes)";
    expect(redactEvidenceForModerator(evidence)).toBe(
      "Exact device fingerprint match ([fingerprint], 2 shared hashes)"
    );
  });

  it("replaces a masked IPv4 fragment with a generic placeholder", () => {
    const evidence = "Shared residential/mobile IP 12.34.56.xxx (+2 more)";
    expect(redactEvidenceForModerator(evidence)).toBe(
      "Shared residential/mobile IP [ip] (+2 more)"
    );
  });

  it("leaves evidence with no masked fragments untouched", () => {
    const evidence = "Shared Discord account link";
    expect(redactEvidenceForModerator(evidence)).toBe(evidence);
  });
});

describe("redactEvidenceForRole", () => {
  const evidence = "Shared residential/mobile IP 12.34.56.xxx";

  it("returns the evidence unredacted for admins", () => {
    expect(redactEvidenceForRole(evidence, true)).toBe(evidence);
  });

  it("redacts the evidence for non-admins", () => {
    expect(redactEvidenceForRole(evidence, false)).not.toContain("12.34.56.xxx");
  });
});

describe("cluster cursor encode/decode", () => {
  it("round-trips confidence + id", () => {
    const id = new ObjectId();
    const cursor = encodeClusterCursor(0.73, id);
    const decoded = decodeClusterCursor(cursor);
    expect(decoded).toEqual({ confidence: 0.73, id: id.toHexString() });
  });

  it("returns null when the decoded cursor has no confidence/id separator", () => {
    const noSeparator = Buffer.from("hello", "utf8").toString("base64url");
    expect(decodeClusterCursor(noSeparator)).toBeNull();
  });

  it("returns null when the id segment isn't a 24-hex ObjectId", () => {
    const badId = Buffer.from("0.5_not-an-object-id", "utf8").toString("base64url");
    expect(decodeClusterCursor(badId)).toBeNull();
  });
});

describe("memberRole", () => {
  const operator = new ObjectId();
  const burner = new ObjectId();
  const associate = new ObjectId();
  const roles = { operator, burners: [burner], associates: [associate] };

  it("identifies the operator", () => {
    expect(memberRole(operator.toString(), roles)).toBe("operator");
  });

  it("identifies a burner", () => {
    expect(memberRole(burner.toString(), roles)).toBe("burner");
  });

  it("falls back to associate for everyone else", () => {
    expect(memberRole(associate.toString(), roles)).toBe("associate");
    expect(memberRole(new ObjectId().toString(), roles)).toBe("associate");
  });
});
