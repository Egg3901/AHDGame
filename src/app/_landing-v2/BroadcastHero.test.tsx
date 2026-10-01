/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, render } from "@testing-library/react";
import { BroadcastHeadline, BroadcastKicker, BroadcastTicker, YearOdometer } from "./BroadcastHero";
import { ERA_CONFIGS } from "@/components/landing/eraThemes";

const broadcast = ERA_CONFIGS["1991"].broadcast!;

describe("BroadcastTicker", () => {
  it("reads the crawl once and hides the copy that makes the loop seamless", () => {
    const { container } = render(
      <BroadcastTicker label={broadcast.tickerLabel} items={broadcast.ticker} />
    );
    const runs = container.querySelectorAll("ul");
    expect(runs).toHaveLength(2);
    expect(runs[0].getAttribute("aria-hidden")).toBeNull();
    expect(runs[1].getAttribute("aria-hidden")).toBe("true");
    expect(runs[0].querySelectorAll("li")).toHaveLength(broadcast.ticker.length);
    expect(runs[0].textContent).toBe(runs[1].textContent);
  });

  it("paces the crawl by length, so a longer year does not read faster", () => {
    const { container } = render(<BroadcastTicker label="1991" items={broadcast.ticker} />);
    const track = container.querySelector<HTMLElement>(".ahd-bc-crawl")!;
    const duration = parseFloat(track.style.getPropertyValue("--ahd-bc-crawl-dur"));
    const characters = broadcast.ticker.reduce((n, i) => n + i.date.length + i.text.length, 0);
    expect(duration).toBe(Math.max(40, Math.round(characters * 0.1)));
  });
});

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

describe("BroadcastKicker", () => {
  it("shows the kicker and its dateline", () => {
    const { container } = render(
      <BroadcastKicker kicker={broadcast.kicker} dateline={broadcast.dateline} />
    );
    expect(container.textContent).toContain(broadcast.kicker);
    expect(container.textContent).toContain(broadcast.dateline);
  });
});
