/**
 * @vitest-environment happy-dom
 *
 * The countdown is a dated promo, so the thing worth pinning is the expiry:
 * after the deadline it must render nothing and report inactive, because that
 * same signal un-pauses the globe's idle crisis showcase.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render as rtlRender, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CrtCountdown, useCrtCountdown, CRT_COUNTDOWN_DEADLINE_MS } from "./CrtCountdown";
import enAuth from "../../../messages/en/auth.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enAuth}>
      {ui}
    </NextIntlClientProvider>
  );
}

function Harness() {
  const remaining = useCrtCountdown();
  return (
    <div>
      <span data-testid="active">{remaining ? "yes" : "no"}</span>
      <CrtCountdown remaining={remaining} />
    </div>
  );
}

describe("CrtCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the remaining time while the deadline is ahead", () => {
    // 1 day, 2 hours, 3 minutes, 4 seconds out.
    vi.setSystemTime(CRT_COUNTDOWN_DEADLINE_MS - ((26 * 60 + 3) * 60 + 4) * 1000);
    const { getByTestId, getByRole } = render(<Harness />);
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(getByTestId("active").textContent).toBe("yes");
    expect(getByRole("timer").textContent).toBe("1d 2h 3m 4s remaining");
  });

  it("degrades the signal as the deadline closes in", () => {
    const level = (msOut: number) => {
      vi.setSystemTime(CRT_COUNTDOWN_DEADLINE_MS - msOut);
      const { container, unmount } = render(<Harness />);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      const value = container.querySelector("[data-glitch]")?.getAttribute("data-glitch");
      unmount();
      return value;
    };

    expect(level(12 * 60 * 60_000)).toBe("0");
    expect(level(3 * 60 * 60_000)).toBe("1");
    expect(level(30 * 60_000)).toBe("2");
    expect(level(5 * 60_000)).toBe("3");
    expect(level(30_000)).toBe("4");
  });

  it("renders nothing once the deadline passes", () => {
    vi.setSystemTime(CRT_COUNTDOWN_DEADLINE_MS - 2000);
    const { getByTestId, queryByRole } = render(<Harness />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(getByTestId("active").textContent).toBe("yes");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(getByTestId("active").textContent).toBe("no");
    expect(queryByRole("timer")).toBeNull();
  });
});
