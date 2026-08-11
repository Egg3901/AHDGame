/**
 * @vitest-environment happy-dom
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageErrorBoundary } from "./PageErrorBoundary";

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/observability/sentryClientLazy", () => ({
  captureClientException: captureException,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("PageErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureException.mockClear();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("captures caught render errors with Sentry context", () => {
    const renderError = new Error("render failed");

    function ThrowingChild(): ReactNode {
      throw renderError;
    }

    render(
      <PageErrorBoundary pageName="Bill page">
        <ThrowingChild />
      </PageErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(captureException).toHaveBeenCalledWith(renderError, {
      extra: { pageName: "Bill page" },
    });
  });
});
