import { describe, expect, it } from "vitest";
import { resolveCountryContext, toCountryId } from "@/lib/navigation/countryContext";
import {
  clearPageCountryOverrideForOwner,
  getCurrentPageCountryOverride,
  setPageCountryOverrideForOwner,
} from "./useCountryContext";

describe("toCountryId", () => {
  it("normalizes mixed-case country codes", () => {
    expect(toCountryId("uk")).toBe("UK");
    expect(toCountryId("Us")).toBe("US");
  });

  it("rejects unknown values", () => {
    expect(toCountryId("GB")).toBeNull();
    expect(toCountryId(null)).toBeNull();
  });
});

describe("resolveCountryContext", () => {
  it("prefers explicit query-country over other sources", () => {
    expect(
      resolveCountryContext({
        pathname: "/corporation/37/sector/abc",
        queryCountryId: "us",
        homeCountryId: "UK",
        initialPageCountry: "UK",
      })
    ).toMatchObject({ pageCountry: "US", userCountry: "UK", isUKContext: false });
  });

  it("uses the server-resolved page country for global pages", () => {
    expect(
      resolveCountryContext({
        pathname: "/corporation/37/sector/abc",
        homeCountryId: "UK",
        initialPageCountry: "JP",
      })
    ).toMatchObject({ pageCountry: "JP", userCountry: "UK", isUKContext: false });
  });

  it("falls back to the viewer country when no page context exists", () => {
    expect(
      resolveCountryContext({
        pathname: "/corporation/37/sector/abc",
        homeCountryId: "UK",
      })
    ).toMatchObject({ pageCountry: "UK", userCountry: "UK", isUKContext: true });
  });

  it("keeps explicit country routes ahead of a server-provided fallback", () => {
    expect(
      resolveCountryContext({
        pathname: "/country/de/metrics",
        homeCountryId: "UK",
        initialPageCountry: "JP",
      })
    ).toMatchObject({ pageCountry: "DE", userCountry: "UK", isUKContext: false });
  });
});

describe("page country override registry", () => {
  it("keeps the most recently published override active", () => {
    const registry = new Map<string, "UK" | "JP">();

    expect(setPageCountryOverrideForOwner(registry, "layout", "UK")).toBe("UK");
    expect(setPageCountryOverrideForOwner(registry, "page", "JP")).toBe("JP");
    expect(getCurrentPageCountryOverride(registry)).toBe("JP");
  });

  it("restores the parent override when a nested publisher unmounts", () => {
    const registry = new Map<string, "UK" | "JP">();

    setPageCountryOverrideForOwner(registry, "layout", "UK");
    setPageCountryOverrideForOwner(registry, "page", "JP");

    expect(clearPageCountryOverrideForOwner(registry, "page")).toBe("UK");
    expect(getCurrentPageCountryOverride(registry)).toBe("UK");
  });

  it("removes the override entirely when the last publisher clears", () => {
    const registry = new Map<string, "UK">();

    setPageCountryOverrideForOwner(registry, "layout", "UK");

    expect(clearPageCountryOverrideForOwner(registry, "layout")).toBeNull();
    expect(getCurrentPageCountryOverride(registry)).toBeNull();
  });
});
