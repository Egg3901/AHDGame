/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { ERA_CONFIGS } from "@/components/landing/eraThemes";
import { EraExplainerLink } from "./EraExplainerLink";

describe("EraExplainerLink", () => {
  it("links the 1991 lander to the 1991 explainer on the studio site, in a new tab", () => {
    const { getByRole } = render(<EraExplainerLink explainer={ERA_CONFIGS["1991"].explainer} />);
    const link = getByRole("link", { name: /What's new in the 1991 world/ });
    expect(link.getAttribute("href")).toBe("https://lakesidegames.net/ahd-1991/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders nothing for an era without an explainer", () => {
    expect(ERA_CONFIGS["1953"].explainer).toBeUndefined();
    const { container } = render(<EraExplainerLink explainer={ERA_CONFIGS["1953"].explainer} />);
    expect(container.innerHTML).toBe("");
  });

  it("uses the light-on-dark tone over the broadcast backdrop", () => {
    const { getByRole } = render(
      <EraExplainerLink explainer={ERA_CONFIGS["1991"].explainer} tone="onDark" />
    );
    expect(getByRole("link").className).toContain("text-white/80");
  });
});
