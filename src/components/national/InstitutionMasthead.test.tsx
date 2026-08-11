/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InstitutionMasthead } from "./InstitutionMasthead";
import { getExecutiveIdentity } from "@/lib/constants/institutionIdentity";

describe("InstitutionMasthead", () => {
  it("renders registry, title, chips, and the right slot", () => {
    render(
      <InstitutionMasthead
        countryId="US"
        identity={getExecutiveIdentity("US")}
        chips={<span>Whitmore Administration</span>}
        rightSlot={<span>52%</span>}
      />
    );
    expect(screen.getByText("Executive Office of the President")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /The White House/ })).toBeTruthy();
    expect(screen.getByText("Whitmore Administration")).toBeTruthy();
    expect(screen.getByText("52%")).toBeTruthy();
  });

  it("shows the English subtitle for CJK identities", () => {
    render(<InstitutionMasthead countryId="CN" identity={getExecutiveIdentity("CN")} />);
    expect(screen.getByText("国务院")).toBeTruthy();
    expect(screen.getByText(/State Council & Government/)).toBeTruthy();
  });

  it("renders the hero photo region only when an image is provided", () => {
    const { container, rerender } = render(
      <InstitutionMasthead countryId="US" identity={getExecutiveIdentity("US")} />
    );
    expect(container.querySelector("img")).toBeNull();
    rerender(
      <InstitutionMasthead
        countryId="US"
        identity={getExecutiveIdentity("US")}
        heroImage={{ src: "/api/images/hero/white-house", alt: "The White House" }}
      />
    );
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("renders a fused bottom strip when provided", () => {
    render(
      <InstitutionMasthead
        countryId="US"
        identity={getExecutiveIdentity("US")}
        strip={<div data-testid="strip">tiles</div>}
      />
    );
    expect(screen.getByTestId("strip")).toBeTruthy();
  });
});
