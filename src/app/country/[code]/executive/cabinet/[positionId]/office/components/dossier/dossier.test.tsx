/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SectionCard, Badge, Tile, Chop } from "./index";

afterEach(cleanup);

describe("dossier primitives", () => {
  it("SectionCard renders title, sub and children", () => {
    render(
      <SectionCard title="Policy" sub="standing">
        <p>body</p>
      </SectionCard>
    );
    expect(screen.getByText("Policy")).toBeTruthy();
    expect(screen.getByText("standing")).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });

  it("never lets the header action squeeze and wrap its label", () => {
    // A narrow screen used to compress the action until "+ Create command"
    // wrapped mid-phrase; the title truncates instead.
    const { container } = render(
      <SectionCard title="Theater commands" right={<button>+ Create command</button>}>
        <p>body</p>
      </SectionCard>
    );
    const action = screen.getByRole("button", { name: "+ Create command" });
    expect(action.parentElement?.className).toContain("shrink-0");
    expect(container.querySelector(".truncate")).toBeTruthy();
  });

  it("omits the action wrapper when no action is given", () => {
    const { container } = render(
      <SectionCard title="Policy">
        <p>body</p>
      </SectionCard>
    );
    expect(container.querySelectorAll(".shrink-0").length).toBe(0);
  });

  it("Tile shows label, value and sub", () => {
    render(<Tile label="Approval" value="47%" sub="national" />);
    expect(screen.getByText("Approval")).toBeTruthy();
    expect(screen.getByText("47%")).toBeTruthy();
  });

  it("Chop renders the seal image when provided, else the glyph", () => {
    const { rerender } = render(<Chop glyph="国" serif="cjk" />);
    expect(screen.getByText("国")).toBeTruthy();
    rerender(<Chop glyph="国" serif="cjk" sealImage="https://x/seal.png" />);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("Badge applies tone class", () => {
    render(<Badge tone="gov">Active</Badge>);
    expect(screen.getByText("Active").className).toContain("text-gov-soft");
  });
});
