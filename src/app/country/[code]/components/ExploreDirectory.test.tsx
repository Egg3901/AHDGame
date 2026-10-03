/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExploreDirectory, type DirectoryGroup } from "./ExploreDirectory";

const GROUPS: DirectoryGroup[] = [
  {
    label: "Politics",
    rows: [
      {
        label: "Elections",
        href: "/country/us/elections",
        available: true,
        figure: "3 live",
        figureTone: "warning",
      },
      { label: "Parties", href: "/country/us/parties", available: true, figure: "6 active" },
      { label: "Politicians", href: "/country/us/politicians", available: true },
    ],
  },
  {
    label: "Nation",
    rows: [{ label: "Archive", href: "/country/us/archive", available: false }],
  },
];

describe("ExploreDirectory", () => {
  it("renders each group as a plain heading over its links", () => {
    render(<ExploreDirectory groups={GROUPS} />);
    expect(screen.getByRole("heading", { name: "Politics" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Nation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Elections/ }).getAttribute("href")).toBe(
      "/country/us/elections"
    );
  });

  it("shows live figures in body type, without chevrons or monospace", () => {
    const { container } = render(<ExploreDirectory groups={GROUPS} />);
    const figure = screen.getByText("3 live");
    expect(figure.className).toContain("text-warning");
    expect(screen.getByText("6 active").className).toContain("text-muted");
    expect(container.querySelector(".font-mono")).toBeNull();
    expect(container.textContent).not.toContain("›");
  });

  it("reads Coming soon for an unavailable row and does not link it", () => {
    render(<ExploreDirectory groups={GROUPS} />);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Archive/ })).toBeNull();
  });
});
