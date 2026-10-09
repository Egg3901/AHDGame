/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LegislatureSeal } from "./LegislatureSeal";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: any) => <img {...props} />,
}));

describe("LegislatureSeal", () => {
  it("renders the real chamber seal when one is mapped", () => {
    render(<LegislatureSeal countryId="US" chamberKey="senate" />);
    const img = screen.getByAltText("Seal of the United States Senate");
    expect(img.getAttribute("src")).toContain("Seal_of_the_United_States_Senate.svg");
  });

  it("uses the generic chamber glyph for an unmapped chamber", () => {
    render(<LegislatureSeal countryId="FR" chamberKey="senat" chamberName="Senate" />);
    expect(screen.queryByRole("img", { name: "Senate" })).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("uses the generic glyph without a country, so state chambers never borrow a national seal", () => {
    render(<LegislatureSeal countryId={null} chamberKey="senate" chamberName="Senate" />);
    expect(screen.queryByAltText("Seal of the United States Senate")).toBeNull();
    expect(screen.getByRole("img", { name: "Senate" })).toBeTruthy();
  });

  it("falls back to the generic glyph if the remote image errors", () => {
    render(<LegislatureSeal countryId="US" chamberKey="house" chamberName="House" />);
    fireEvent.error(screen.getByAltText("Seal of the United States House of Representatives"));
    expect(screen.getByRole("img", { name: "House" })).toBeTruthy();
  });
});
