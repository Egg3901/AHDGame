/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewingAsControl } from "./ViewingAsControl";

describe("ViewingAsControl", () => {
  it("renders a link per role with the active one highlighted", () => {
    render(<ViewingAsControl active="pm" hrefFor={(r) => `?as=${r}`} />);
    expect(screen.getByRole("link", { name: /Prime Minister/i }).getAttribute("href")).toBe(
      "?as=pm"
    );
    expect(screen.getByRole("link", { name: /^Auto$/i }).getAttribute("href")).toBe("?as=auto");
    expect(screen.getByRole("link", { name: /Prime Minister/i }).getAttribute("aria-current")).toBe(
      "true"
    );
  });
});
