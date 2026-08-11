/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Seal, Ring } from "./OrgPrimitives";
import { BUILTIN_ORG_IDENTITY } from "@/lib/constants/orgIdentity";

afterEach(() => cleanup());

describe("OrgPrimitives", () => {
  it("Seal renders the emblem image when the identity has a logo", () => {
    render(<Seal identity={BUILTIN_ORG_IDENTITY.UN} />);
    // Built-ins carry a real flag image; the glyph is only a fallback.
    expect(document.querySelector("img")).toBeTruthy();
  });

  it("Seal falls back to the glyph when there is no logo", () => {
    render(<Seal identity={{ ...BUILTIN_ORG_IDENTITY.UN, logoSrc: undefined, glyph: "ZZ" }} />);
    expect(screen.getByText("ZZ")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("Ring renders its clamped value and an accessible label", () => {
    render(<Ring value={88} label="influence" />);
    expect(screen.getByText("88")).toBeTruthy();
    expect(screen.getByRole("img", { name: /influence: 88/i })).toBeTruthy();
  });
});
