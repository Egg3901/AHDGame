import { describe, expect, it } from "vitest";
import { resolveJusticeOfficeNavEntry } from "./justiceOfficeNavEntry";

describe("resolveJusticeOfficeNavEntry", () => {
  it("returns null when the viewer holds no court seat", () => {
    expect(resolveJusticeOfficeNavEntry(null)).toBeNull();
    expect(resolveJusticeOfficeNavEntry(undefined)).toBeNull();
  });

  it("lowercases the country code and keeps the seat number", () => {
    expect(resolveJusticeOfficeNavEntry({ countryId: "US", seatNumber: 4 })).toEqual({
      countryCode: "us",
      seatNumber: 4,
    });
  });
});
