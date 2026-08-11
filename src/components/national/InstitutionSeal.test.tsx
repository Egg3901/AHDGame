/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InstitutionSeal } from "./InstitutionSeal";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: any) => <img {...props} />,
}));

const SEAL = { src: "https://upload.wikimedia.org/x/330px-seal.png", alt: "Seal of the President" };

describe("InstitutionSeal", () => {
  it("renders the real seal image when one is provided", () => {
    render(
      <InstitutionSeal country="US" glyph="★" serif="mono" accent="#f5c542" sealImage={SEAL} />
    );
    const img = screen.getByAltText("Seal of the President");
    expect(img.getAttribute("src")).toContain("330px-seal.png");
  });

  it("falls back to the generated seal when no image is configured", () => {
    const { container } = render(
      <InstitutionSeal country="US" glyph="★" serif="mono" accent="#f5c542" sealImage={null} />
    );
    expect(screen.queryByAltText("Seal of the President")).toBeNull();
    // The generated NationalSeal is an inline <svg role="img">.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the generated seal if the remote image errors", () => {
    const { container } = render(
      <InstitutionSeal country="US" glyph="★" serif="mono" accent="#f5c542" sealImage={SEAL} />
    );
    fireEvent.error(screen.getByAltText("Seal of the President"));
    expect(screen.queryByAltText("Seal of the President")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
