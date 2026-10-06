/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AdminObservabilityTab } from "./AdminObservabilityTab";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminObservabilityTab", () => {
  it("surfaces an unavailable Sentry feed instead of claiming there are no issues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              configured: true,
              issues: [],
              error: "Sentry API returned 403",
            }),
            { status: 200 }
          )
      )
    );

    render(<AdminObservabilityTab />);

    await waitFor(() => expect(screen.getByText("Sentry API returned 403")).toBeTruthy());
    expect(screen.queryByText(/No issues in the last 24 hours/)).toBeNull();
  });
});
