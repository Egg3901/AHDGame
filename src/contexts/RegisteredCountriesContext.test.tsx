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
} from "./RegisteredCountriesContext";

function RegisteredProbe() {
  return <span>registered:{useRegisteredCountries().join(",")}</span>;
}

function EnabledProbe() {
  return <span>enabled:{useEnabledCountries().join(",")}</span>;
}

function PresetProbe() {
  return <span>preset:{useActivePreset()}</span>;
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
});
