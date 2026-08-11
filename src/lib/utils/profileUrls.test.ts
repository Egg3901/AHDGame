// src/lib/utils/profileUrls.test.ts
import { describe, it, expect } from "vitest";
import {
  buildCharacterHref,
  buildNppHref,
  formatNppDisplayId,
  parseCharacterId,
  parseNppId,
} from "./profileUrls";
import { ObjectId } from "mongodb";

describe("buildCharacterHref", () => {
  it("uses sequentialId when available", () => {
    expect(buildCharacterHref({ sequentialId: 42 })).toBe("/character/42");
  });

  it("falls back to ObjectId string", () => {
    expect(buildCharacterHref({ _id: "6997925d0b93c46718d5ab9c" })).toBe(
      "/character/6997925d0b93c46718d5ab9c"
    );
  });

  it("handles ObjectId instance", () => {
    const oid = new ObjectId("6997925d0b93c46718d5ab9c");
    expect(buildCharacterHref({ _id: oid })).toBe("/character/6997925d0b93c46718d5ab9c");
  });
});

describe("buildNppHref", () => {
  it("uses sequentialId when available", () => {
    expect(buildNppHref({ sequentialId: 17 })).toBe("/politicians/npp/17");
  });

  it("falls back to ObjectId string", () => {
    expect(buildNppHref({ _id: "69a6ef990c2a1b5cbc09f832" })).toBe(
      "/politicians/npp/69a6ef990c2a1b5cbc09f832"
    );
  });
});

describe("formatNppDisplayId", () => {
  it("formats sequential ID with NPP- prefix", () => {
    expect(formatNppDisplayId(1)).toBe("NPP-1");
    expect(formatNppDisplayId(42)).toBe("NPP-42");
  });
});

describe("parseCharacterId", () => {
  it("parses numeric sequential ID", () => {
    expect(parseCharacterId("1")).toEqual({ type: "sequential", value: 1 });
    expect(parseCharacterId("42")).toEqual({ type: "sequential", value: 42 });
  });

  it("parses 24-char hex ObjectId", () => {
    expect(parseCharacterId("6997925d0b93c46718d5ab9c")).toEqual({
      type: "objectId",
      value: "6997925d0b93c46718d5ab9c",
    });
  });

  it("returns null for invalid ID", () => {
    expect(parseCharacterId("invalid")).toBeNull();
    expect(parseCharacterId("abc123")).toBeNull();
    expect(parseCharacterId("")).toBeNull();
  });
});

describe("parseNppId", () => {
  it("parses numeric sequential ID", () => {
    expect(parseNppId("1")).toEqual({ type: "sequential", value: 1 });
    expect(parseNppId("17")).toEqual({ type: "sequential", value: 17 });
  });

  it("parses 24-char hex ObjectId", () => {
    expect(parseNppId("69a6ef990c2a1b5cbc09f832")).toEqual({
      type: "objectId",
      value: "69a6ef990c2a1b5cbc09f832",
    });
  });

  it("returns null for invalid ID", () => {
    expect(parseNppId("NPP-1")).toBeNull(); // NPP- prefix not allowed in URL
    expect(parseNppId("invalid")).toBeNull();
  });
});
