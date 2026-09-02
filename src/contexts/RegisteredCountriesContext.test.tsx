/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  RegisteredCountriesProvider,
  useRegisteredCountries,
  useEnabledCountries,
  useActivePreset,
  useCountryDisplayName,
  getCountryDisplayNameWithOverrides,
} from "./RegisteredCountriesContext";
import type { CountryId } from "@/lib/constants/countries";

function RegisteredProbe() {
  return <span>registered:{useRegisteredCountries().join(",")}</span>;
}

function EnabledProbe() {
  return <span>enabled:{useEnabledCountries().join(",")}</span>;
}

function PresetProbe() {
  return <span>preset:{useActivePreset()}</span>;
}

function NameProbe({ id }: { id: CountryId }) {
  return <span>name:{useCountryDisplayName(id)}</span>;
}

describe("RegisteredCountriesContext", () => {
  it("provides the SSR-resolved registered set to client consumers", () => {
    render(
      <RegisteredCountriesProvider
        value={{ registered: ["US", "UK", "SCO"], enabled: ["US", "UK"], preset: "2019-default" }}
      >
        <RegisteredProbe />
      </RegisteredCountriesProvider>
    );
    expect(screen.getByText("registered:US,UK,SCO")).toBeTruthy();
  });

  it("exposes the narrower enabled set separately (player pickers gate on enablement)", () => {
    render(
      <RegisteredCountriesProvider
        value={{ registered: ["US", "UK", "SCO"], enabled: ["US", "UK"], preset: "2019-default" }}
      >
        <EnabledProbe />
      </RegisteredCountriesProvider>
    );
    // SCO is registered (surfaces in admin tooling) but NOT enabled (hidden from player switchers).
    expect(screen.getByText("enabled:US,UK")).toBeTruthy();
  });

  it("both hooks fall back to COUNTRY_ORDER with no provider", () => {
    render(
      <>
        <RegisteredProbe />
        <EnabledProbe />
      </>
    );
    expect(screen.getByText(/registered:US,UK/)).toBeTruthy();
    expect(screen.getByText(/enabled:US,UK/)).toBeTruthy();
  });

  it("exposes the SSR-resolved active preset (drives era-aware country names)", () => {
    render(
      <RegisteredCountriesProvider
        value={{ registered: ["US", "UK"], enabled: ["US", "UK"], preset: "1979-default" }}
      >
        <PresetProbe />
      </RegisteredCountriesProvider>
    );
    expect(screen.getByText("preset:1979-default")).toBeTruthy();
  });

  it("preset falls back to 2019-default with no provider", () => {
    render(<PresetProbe />);
    expect(screen.getByText("preset:2019-default")).toBeTruthy();
  });

  describe("runtime display overrides (ticket #1255)", () => {
    it("a hydrated override renames the country in client surfaces", () => {
      // The reunification write: DD survives the merge and is called Germany.
      render(
        <RegisteredCountriesProvider
          value={{
            registered: ["US", "DD"],
            enabled: ["US", "DD"],
            preset: "1953-default",
            displayOverrides: { DD: { name: "Germany", flagEmoji: "🇩🇪" } },
          }}
        >
          <NameProbe id="DD" />
        </RegisteredCountriesProvider>
      );
      expect(screen.getByText("name:Germany")).toBeTruthy();
    });

    it("an unrenamed country keeps its era alias", () => {
      // DE in 1953 renders as "West Germany" — the alias must survive the
      // override layer for every country no runtime event has touched.
      render(
        <RegisteredCountriesProvider
          value={{
            registered: ["US", "DE"],
            enabled: ["US", "DE"],
            preset: "1953-default",
            displayOverrides: {},
          }}
        >
          <NameProbe id="DE" />
        </RegisteredCountriesProvider>
      );
      expect(screen.getByText("name:West Germany")).toBeTruthy();
    });

    it("an empty override map (hydration missing) falls back to the compiled name", () => {
      render(<NameProbe id="DD" />);
      expect(screen.getByText("name:East Germany")).toBeTruthy();
    });

    it("the pure layering prefers the override over the era alias", () => {
      expect(
        getCountryDisplayNameWithOverrides("DD", "1953-default", { DD: { name: "Germany" } })
      ).toBe("Germany");
      // And without one, the era alias stands.
      expect(getCountryDisplayNameWithOverrides("DE", "1953-default", {})).toBe("West Germany");
    });
  });
});
