import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { isHexObjectIdString } from "./objectIdHex";
import { parseObjectId } from "./objectId";

describe("isHexObjectIdString", () => {
  it("returns true for valid 24-char hex", () => {
    expect(isHexObjectIdString("507f1f77bcf86cd799439011")).toBe(true);
    expect(isHexObjectIdString("507F1F77BCF86CD799439011")).toBe(true);
  });

  it("returns false for wrong length or non-hex", () => {
    expect(isHexObjectIdString("abc123")).toBe(false);
    expect(isHexObjectIdString("507f1f77bcf86cd79943901z")).toBe(false);
  });
});

describe("parseObjectId", () => {
  it("returns ObjectId for valid 24-char hex string", () => {
    const valid = "507f1f77bcf86cd799439011";
    const result = parseObjectId(valid);
    expect(result).toBeInstanceOf(ObjectId);
    expect(result?.toString()).toBe(valid);
  });

  it("returns null for null", () => {
    expect(parseObjectId(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseObjectId(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseObjectId("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseObjectId("   ")).toBeNull();
  });

  it("returns null for invalid hex (too short)", () => {
    expect(parseObjectId("abc123")).toBeNull();
  });

  it("returns null for invalid hex (non-hex chars)", () => {
    expect(parseObjectId("507f1f77bcf86cd79943901z")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseObjectId(123 as unknown as string)).toBeNull();
  });
});
