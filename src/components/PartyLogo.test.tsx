/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PartyLogo } from "./PartyLogo";

describe("PartyLogo", () => {
  it("recovers from a prior image error when the logo source changes", () => {
    const { rerender } = render(
      <PartyLogo
        partyId="1"
        partyColor="#ff0000"
        logoUrl="/api/uploads/party-logos/us-1-old.png"
        countryId="US"
        logoAlt="Party logo"
      />
    );

    const firstImage = screen.getByAltText("Party logo");
    fireEvent.error(firstImage);

    expect(screen.queryByAltText("Party logo")).toBeNull();

    rerender(
      <PartyLogo
        partyId="1"
        partyColor="#ff0000"
        logoUrl="/api/uploads/party-logos/us-1-new.png"
        countryId="US"
        logoAlt="Party logo"
      />
    );

    const updatedImage = screen.getByAltText("Party logo");
    expect(updatedImage.getAttribute("src")).toContain("us-1-new.png");
  });
});
