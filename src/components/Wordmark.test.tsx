/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { Wordmark, WORDMARK, typedWordmarkFrame } from "./Wordmark";

describe("typedWordmarkFrame", () => {
  it("opens on an empty field with a blinking cursor", () => {
    expect(typedWordmarkFrame(0)).toEqual({ keys: 0, cursor: "blinking" });
    expect(typedWordmarkFrame(800)).toEqual({ keys: 0, cursor: "blinking" });
  });

  it("types a key at a time with the cursor held steady", () => {
    const first = typedWordmarkFrame(900);
    expect(first).toEqual({ keys: 1, cursor: "typing" });
    const later = typedWordmarkFrame(900 + 70 * 5);
    expect(later.keys).toBe(6);
    expect(later.cursor).toBe("typing");
  });

  it("finishes the name, blinks a little longer, then drops the cursor", () => {
    const typedAt = 900 + 70 * WORDMARK.length;
    expect(typedWordmarkFrame(typedAt)).toEqual({ keys: WORDMARK.length, cursor: "blinking" });
    expect(typedWordmarkFrame(typedAt + 2000)).toEqual({ keys: WORDMARK.length, cursor: "gone" });
  });
});

describe("Wordmark", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the name as before when not typed", () => {
    const { container } = render(<Wordmark className="x" />);
    expect(container.textContent).toBe(WORDMARK);
    expect(container.querySelector(".ahd-wordmark-cursor")).toBeNull();
  });

  it("starts typed on an empty field, keeps the full width and the full name for screen readers", () => {
    const { container } = render(<Wordmark typed />);
    expect(container.querySelector(".sr-only")?.textContent).toBe(WORDMARK);
    expect(container.querySelector(".ahd-wordmark-cursor")).not.toBeNull();
    expect(container.querySelector(".invisible")?.textContent).toBe(WORDMARK);
  });
});
