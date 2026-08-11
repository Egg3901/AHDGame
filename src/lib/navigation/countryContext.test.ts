import { describe, it, expect } from "vitest";
import { resolveCountryContext, toCountryId } from "./countryContext";

describe("toCountryId", () => {
  it("accepts 2- and 3-letter country codes (incl. seceded nations)", () => {
    expect(toCountryId("us")).toBe("US");
    expect(toCountryId("UK")).toBe("UK");
    expect(toCountryId("sco")).toBe("SCO");
    expect(toCountryId("wal")).toBe("WAL");
  });

  it("rejects unknown / partial codes", () => {
    expect(toCountryId("sc")).toBeNull(); // not a country — must not partial-match SCO
    expect(toCountryId("xx")).toBeNull();
    expect(toCountryId(null)).toBeNull();
  });
});

describe("resolveCountryContext — pageCountry from the route", () => {
  const home = "WAL";

  it("resolves 3-letter seceded-nation routes (regression: matched only 2 chars → home)", () => {
    expect(
      resolveCountryContext({ pathname: "/country/sco/legislature", homeCountryId: home })
        .pageCountry
    ).toBe("SCO");
    expect(
      resolveCountryContext({ pathname: "/country/wal", homeCountryId: home }).pageCountry
    ).toBe("WAL");
    expect(
      resolveCountryContext({ pathname: "/country/sco", homeCountryId: home }).pageCountry
    ).toBe("SCO");
  });

  it("still resolves 2-letter country routes", () => {
    expect(
      resolveCountryContext({ pathname: "/country/us", homeCountryId: home }).pageCountry
    ).toBe("US");
    expect(
      resolveCountryContext({ pathname: "/country/jp/executive", homeCountryId: home }).pageCountry
    ).toBe("JP");
  });

  it("falls back to the home nation off a country route", () => {
    expect(resolveCountryContext({ pathname: "/dashboard", homeCountryId: home }).pageCountry).toBe(
      "WAL"
    );
  });

  it("honors an explicit ?country query over the path", () => {
    expect(
      resolveCountryContext({
        pathname: "/country/sco",
        queryCountryId: "wal",
        homeCountryId: home,
      }).pageCountry
    ).toBe("WAL");
  });
});
