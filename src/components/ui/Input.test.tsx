/**
 * @vitest-environment happy-dom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./Input";

describe("Input", () => {
  it("renders a textbox that forwards aria-label and placeholder", () => {
    render(<Input aria-label="Amount" placeholder="0" />);
    const el = screen.getByRole("textbox", { name: "Amount" });
    expect(el).toBeTruthy();
    expect(el).toHaveProperty("placeholder", "0");
  });

  it("uses 16px text so iOS Safari does not zoom on focus (ticket #1114)", () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByRole("textbox", { name: "Name" }).className.split(/\s+/)).toContain(
      "text-base"
    );
  });

  it("does not use transition-all (animating every property janks the caret on mobile)", () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByRole("textbox", { name: "Name" }).className).not.toMatch(
      /\btransition-all\b/
    );
  });
});
