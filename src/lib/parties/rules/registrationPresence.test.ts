import { describe, expect, it } from "vitest";
import { buildRegistrationPresence, registrationPresenceKey as key } from "./registrationPresence";

describe("live registration presence", () => {
  const regions = [
    { countryId: "UK", stateId: "SCO" },
    { countryId: "US", stateId: "CA" },
  ];
  it("accepts players, active NPPs and regional officials, including zero-Org newcomers", () => {
    const result = buildRegistrationPresence(
      regions,
      [{ countryId: "UK", party: "1", homeState: "SCO" }],
      [{ countryId: "UK", party: "2", homeState: "SCO" }],
      [{ countryId: "UK", party: "3", state: "SCO" }]
    );
    expect([...result].sort()).toEqual([
      key("UK", "1", "SCO"),
      key("UK", "2", "SCO"),
      key("UK", "3", "SCO"),
    ]);
  });
  it("rejects retired NPPs, national offices, independents and foreign-country collisions", () => {
    expect(
      buildRegistrationPresence(
        regions,
        [
          { countryId: "US", party: "1", homeState: "SCO" },
          { countryId: "UK", party: "independent", homeState: "SCO" },
        ],
        [{ countryId: "UK", party: "1", homeState: "SCO", retiredAt: "retired" }],
        [{ countryId: "UK", party: "1" }]
      ).size
    ).toBe(0);
  });
  it("supports unambiguous legacy country omissions but fails closed on ambiguous regions", () => {
    expect(
      buildRegistrationPresence(regions, [{ party: "1", homeState: "SCO" }], [], []).has(
        key("UK", "1", "SCO")
      )
    ).toBe(true);
    expect(
      buildRegistrationPresence(
        [...regions, { countryId: "US", stateId: "SCO" }],
        [{ party: "1", homeState: "SCO" }],
        [],
        []
      ).size
    ).toBe(0);
  });
});
