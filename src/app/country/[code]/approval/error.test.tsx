/** @vitest-environment happy-dom */
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CountryError from "./error";
import { clearNetworkRetry } from "./routeErrorRecovery";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  capture: vi.fn(),
  pathname: "/country/us/approval",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      "error.networkRetryingTitle": "Reconnecting to the server",
      "error.networkRetryingDescription": "A network request was interrupted. Retrying once…",
      "error.networkFailureTitle": "Could not reach the server",
      "error.networkFailureDescription": "Your browser could not complete a request.",
    })[key] ?? key,
}));

vi.mock("@/lib/observability/sentryClientLazy", () => ({
  captureClientExceptionWithId: mocks.capture,
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href }, children),
  };
});

const route = "/country/us/approval";

function networkError(message = "network error"): Error {
  return new TypeError(message);
}

describe("country route transport recovery", () => {
  beforeEach(() => {
    clearNetworkRetry(route);
    mocks.refresh.mockClear();
    mocks.capture.mockReset().mockResolvedValue("test-event-id");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("automatically refreshes a transient RSC stream failure without reporting it", async () => {
    const reset = vi.fn();
    render(
      <StrictMode>
        <CountryError error={networkError()} reset={reset} />
      </StrictMode>
    );

    expect(screen.getByRole("status").textContent).toContain("Retrying once");
    expect(mocks.capture).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenCalledTimes(1);
    });

    cleanup();
    render(<CountryError error={networkError()} reset={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Could not reach the server" })).toBeTruthy();
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1));
  });

  it("shows persistent transport failures and refreshes when the player retries", async () => {
    const reset = vi.fn();
    const initial = render(<CountryError error={networkError("Load failed")} reset={reset} />);
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenCalledTimes(1);
    });

    initial.unmount();
    render(<CountryError error={networkError("Load failed")} reset={vi.fn()} />);
    await screen.findByRole("heading", { name: "Could not reach the server" });
    const retryButton = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retryButton);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1));
  });

  it("reports application TypeErrors without retrying them", async () => {
    const reset = vi.fn();
    render(<CountryError error={new TypeError("Cannot read properties of null")} reset={reset} />);

    expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("cancels its scheduled retry when the route unmounts", () => {
    vi.useFakeTimers();
    const reset = vi.fn();
    const view = render(<CountryError error={networkError()} reset={reset} />);
    expect(screen.getByRole("status")).toBeTruthy();

    view.unmount();
    vi.runOnlyPendingTimers();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("still reports an ordinary application error after a transient failure", () => {
    vi.useFakeTimers();
    const reset = vi.fn();
    const view = render(<CountryError error={networkError()} reset={reset} />);
    view.rerender(
      <CountryError error={new TypeError("Cannot read properties of null")} reset={reset} />
    );

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(mocks.capture).toHaveBeenCalledTimes(1);

    view.unmount();
    vi.runOnlyPendingTimers();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reports a second network error in the same boundary after consuming its retry", async () => {
    const reset = vi.fn();
    const view = render(<CountryError error={networkError()} reset={reset} />);

    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenCalledTimes(1);
    });

    view.rerender(<CountryError error={networkError("Load failed")} reset={reset} />);

    expect(await screen.findByRole("heading", { name: "Could not reach the server" })).toBeTruthy();
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
