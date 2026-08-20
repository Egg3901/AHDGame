/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { WikiGuideScreenshot } from "./WikiGuideScreenshot";

describe("WikiGuideScreenshot", () => {
  it("renders an image for a valid name", () => {
    const { container } = render(<WikiGuideScreenshot name="dashboard" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/wiki-images/guides/dashboard.png");
  });

  it("renders nothing for an invalid name", () => {
    const { container } = render(<WikiGuideScreenshot name="../secret" />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("hides the image when it fails to load", () => {
    const { container } = render(<WikiGuideScreenshot data="elections" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector("img")).toBeNull();
  });
});
