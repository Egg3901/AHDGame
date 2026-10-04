/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, render } from "@testing-library/react";
import { BroadcastHeadline, YearOdometer } from "./BroadcastHero";

/** The digit each odometer window is showing, read from its strip's offset. */
function shownYear(container: HTMLElement): string {
  return [...container.querySelectorAll<HTMLElement>(".ahd-bc-odometer-strip")]
    .map((strip) => String(-parseFloat(strip.style.transform.replace("translateY(", "")) / 10))
    .join("");
}

describe("BroadcastHeadline", () => {
  it("picks the era year out of the headline and reads it as one word", () => {
    const { container } = render(
      <BroadcastHeadline text="A political simulation set in 1991." year={1991} />
    );
    const h1 = container.querySelector("h1")!;
    // The rolling digits are CSS, so the text is the sentence and nothing else.
    expect(h1.textContent).toBe("A political simulation set in 1991.");
    expect(h1.querySelector(".sr-only")?.textContent).toBe("1991");
    expect(h1.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(shownYear(container)).toBe("1991");
  });

  it("prints the headline plain when the year is not in it", () => {
    const { container } = render(<BroadcastHeadline text="The map just changed." year={1991} />);
    expect(container.querySelector(".ahd-bc-odometer")).toBeNull();
  });
});

describe("YearOdometer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads on the seed year, then rolls to the world's year", () => {
    vi.useFakeTimers();
    const { container } = render(<YearOdometer from={1991} to={1994} />);
    expect(shownYear(container)).toBe("1991");
    expect(container.querySelector(".sr-only")?.textContent).toBe("1994");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(shownYear(container)).toBe("1994");
  });

  it("carries across decades and centuries", () => {
    vi.useFakeTimers();
    const { container } = render(<YearOdometer from={1991} to={2003} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(shownYear(container)).toBe("2003");
  });

  it("stays put on a fresh world", () => {
    vi.useFakeTimers();
    const { container } = render(<YearOdometer from={1991} to={1991} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(shownYear(container)).toBe("1991");
  });
});
