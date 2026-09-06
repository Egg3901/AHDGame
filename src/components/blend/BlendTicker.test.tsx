/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlendTicker } from "./BlendTicker";

describe("BlendTicker", () => {
  it("renders the tag and every headline", () => {
    render(<BlendTicker tag="WIRE" items={["FIRST HEADLINE", "SECOND HEADLINE"]} />);
    expect(screen.getByText("WIRE")).toBeTruthy();
    expect(screen.getAllByText("FIRST HEADLINE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SECOND HEADLINE").length).toBeGreaterThan(0);
  });

  it("renders the headline list twice so the marquee loop is seamless", () => {
    // The track translates by -50%, so it must hold two identical copies of the
    // list or the loop jumps.
    render(<BlendTicker tag="WIRE" items={["ONLY HEADLINE"]} />);
    expect(screen.getAllByText("ONLY HEADLINE")).toHaveLength(2);
  });

  it("renders nothing at all when there are no events", () => {
    // An empty red tag bar with a blank strip beside it reads as a broken
    // widget; a race with no wire events yet should show no ticker.
    const { container } = render(<BlendTicker tag="WIRE" items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("applies the tag colour and ink passed by the screen", () => {
    // Primary uses a yellow RETURNS tag with dark ink; general/campaign use a
    // red tag with white ink.
    render(<BlendTicker tag="RETURNS" tagColor="#eab308" tagInk="#14141c" items={["X"]} />);
    const tag = screen.getByText("RETURNS");
    expect(tag.getAttribute("style")).toContain("#eab308");
    expect(tag.getAttribute("style")).toContain("#14141c");
  });

  it("marks the scrolling track as decorative for assistive tech", () => {
    // The duplicated copy would otherwise be read out twice.
    const { container } = render(<BlendTicker tag="WIRE" items={["A", "B"]} />);
    const copies = container.querySelectorAll('[aria-hidden="true"]');
    expect(copies.length).toBeGreaterThan(0);
  });
});
