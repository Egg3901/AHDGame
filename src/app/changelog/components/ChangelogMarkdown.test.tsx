/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangelogMarkdown } from "./ChangelogMarkdown";

describe("changelog screenshots", () => {
  it("renders a screenshot and visible caption outside a paragraph", () => {
    const { container } = render(
      <ChangelogMarkdown
        content={
          "Before the screenshot.\n\n![Demonstration market](/changelog/1.13.0/market-supply.png)\n\nAfter the screenshot."
        }
      />
    );
    const figure = container.querySelector("figure");
    expect(figure).not.toBeNull();
    expect(figure?.closest("p")).toBeNull();
    expect(screen.getByRole("img", { name: "Demonstration market" })).toBeTruthy();
    expect(figure?.querySelector("figcaption")?.textContent).toBe("Demonstration market");
    expect(screen.getByText("Before the screenshot.").tagName).toBe("P");
    expect(screen.getByText("After the screenshot.").tagName).toBe("P");
  });
});
