import { describe, it, expect } from "vitest";
import { ApiError } from "./errors";
import { resolveCountry, isSameCountry, assertSameCountry } from "./sameCountry";

describe("resolveCountry", () => {
  it("returns the entity's countryId when present", () => {
    expect(resolveCountry({ countryId: "UK" })).toBe("UK");
  });

  it("falls back to 'US' when countryId is missing — matches existing legacy behavior", () => {
    expect(resolveCountry({})).toBe("US");
    expect(resolveCountry({ countryId: undefined })).toBe("US");
    expect(resolveCountry({ countryId: null })).toBe("US");
  });

  it("falls back to 'US' for null/undefined entities so callers don't have to null-check", () => {
    expect(resolveCountry(null)).toBe("US");
    expect(resolveCountry(undefined)).toBe("US");
  });
});

describe("isSameCountry", () => {
  it("returns true when both entities share a countryId", () => {
    expect(isSameCountry({ countryId: "UK" }, { countryId: "UK" })).toBe(true);
  });

  it("returns false when countries differ", () => {
    expect(isSameCountry({ countryId: "UK" }, { countryId: "US" })).toBe(false);
  });

  it("treats missing countryId as 'US' on both sides — legacy data interop", () => {
    expect(isSameCountry({}, { countryId: "US" })).toBe(true);
    expect(isSameCountry({ countryId: "US" }, {})).toBe(true);
    expect(isSameCountry({}, {})).toBe(true);
  });

  it("treats missing countryId as 'US' (so missing == UK is false)", () => {
    expect(isSameCountry({}, { countryId: "UK" })).toBe(false);
  });
});

describe("assertSameCountry", () => {
  it("does not throw when actor and target share a country", () => {
    expect(() => assertSameCountry({ countryId: "UK" }, { countryId: "UK" })).not.toThrow();
  });

  it("throws ApiError(400) when countries differ", () => {
    let captured: unknown;
    try {
      assertSameCountry({ countryId: "UK" }, { countryId: "US" });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(400);
    expect((captured as ApiError).code).toBe("BAD_REQUEST");
  });

  it("uses a generic default message that fits any political action", () => {
    try {
      assertSameCountry({ countryId: "UK" }, { countryId: "US" });
    } catch (error) {
      expect((error as ApiError).message).toMatch(/different countries/i);
    }
  });

  it("accepts a custom message for action-specific wording", () => {
    try {
      assertSameCountry(
        { countryId: "UK" },
        { countryId: "US" },
        {
          message: "You cannot wire funds to politicians from other countries",
        }
      );
    } catch (error) {
      expect((error as ApiError).message).toBe(
        "You cannot wire funds to politicians from other countries"
      );
    }
  });

  it("respects the legacy 'US' fallback on either side", () => {
    expect(() => assertSameCountry({}, { countryId: "US" })).not.toThrow();
    expect(() => assertSameCountry({ countryId: "US" }, {})).not.toThrow();
    expect(() => assertSameCountry({}, { countryId: "UK" })).toThrow(ApiError);
  });
});
