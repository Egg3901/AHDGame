import { describe, expect, it } from "vitest";
import { retainsDefaultPartyNameReservation } from "./defaultNameReservation";
describe("Default party name reservations", () => {
  it.each([
    ["1991-default", "none", true, false],
    ["1991-default", "none", false, true],
    ["1991-default", "default", true, true],
    ["1991-default", undefined, true, true],
    ["2019-default", "none", true, true],
    ["1953-default", "none", true, true],
    [undefined, undefined, true, true],
  ] as const)(
    "reserves names for %s / %s / player=%s: %s",
    (preset, startingPartiesMode, playerCountry, expected) => {
      expect(
        retainsDefaultPartyNameReservation({ preset, startingPartiesMode, playerCountry })
      ).toBe(expected);
    }
  );
});
